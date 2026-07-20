/**
 * Approval-service — the stateful layer that operates on `approval_requests` rows.
 *
 * Public API:
 *   enqueueApproval  — Hold tier: store a pending approval; supersede any older
 *                      pending row for the same target+action (conflict policy).
 *   approve          — Admin approves: atomic claim → stale/missing check → apply.
 *   reject           — Admin rejects: mark rejected, store reviewer note.
 *   recordNotice     — Notify tier: record an informational notice for a same-day
 *                      money mutation that already applied. No-op for admin callers.
 *   acknowledge      — Admin clears a notice from the bell.
 *   listApprovals    — Admin reads pending (or any status).
 *   listHistory      — Admin reads completed/resolved rows.
 *   listMine         — Requester reads their own rows.
 */

import { sql, type Transaction } from 'kysely';
import { getKysely, withPgTransaction, type Database } from '../database/kysely.js';
import { normalizeRole, ROLES } from '../../shared/auth/roles.js';
import { log } from '../../utils/logger.js';
import { APPROVAL_ACTIONS, type ApprovalActionDef } from './approval-actions.js';
import type { ApprovalActionType, ApprovalStatus } from '../../shared/contracts/approvals.contract.js';

// Narrow session-only interface — the service only reads req.session fields, so
// it accepts any Express Request<...> variant without needing the exact generic args.
type WithSession = { session?: { username?: string; userRole?: string } | null };

// ---------------------------------------------------------------------------
// Generic DB row type (used for SELECT results from approval_requests)
// ---------------------------------------------------------------------------

type ApprovalRow = {
  request_id: number;
  kind: 'approval' | 'notice';
  action_type: ApprovalActionType;
  target_table: string;
  target_id: number;
  person_id: number | null;
  payload: Record<string, unknown>;
  target_version: string | null;
  summary: string;
  requested_by: string;
  requested_at: Date;
  status: ApprovalStatus;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  review_note: string | null;
  // Present only on the list reads (LEFT JOIN patients); absent on RETURNING * rows.
  patient_name?: string | null;
};

// ---------------------------------------------------------------------------
// Person-id resolution
// ---------------------------------------------------------------------------

/** Read an explicit person id off the payload (`person_id` or `personId`), if any. */
function payloadPersonId(payload: Record<string, unknown>): number | null {
  const raw = payload.person_id ?? payload.personId;
  const n = Number(raw);
  return raw != null && Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Resolve the patient this action relates to. Prefers an explicit id in the
 * payload (delete-notice routes capture it before the row is gone), else queries
 * the live target row via the action's `resolvePersonId`. Never throws.
 */
export async function resolveApprovalPersonId(
  actionType: ApprovalActionType,
  targetId: number,
  payload: Record<string, unknown> = {}
): Promise<number | null> {
  const fromPayload = payloadPersonId(payload);
  if (fromPayload != null) return fromPayload;
  const action = APPROVAL_ACTIONS[actionType];
  if (!action?.resolvePersonId) return null;
  return action.resolvePersonId(targetId).catch(() => null);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check if the target row still exists in the DB. */
async function targetExists(
  trx: Transaction<Database>,
  targetTable: string,
  pkColumn: string,
  targetId: number
): Promise<boolean> {
  const res = await sql<{ exists: boolean }>`
    SELECT EXISTS (
      SELECT 1 FROM ${sql.table(targetTable)} WHERE ${sql.ref(pkColumn)} = ${targetId}
    ) AS "exists"
  `.execute(trx);
  return !!res.rows[0]?.exists;
}

/** Fetch the live version of the target row for stale-detection. */
async function liveVersion(
  trx: Transaction<Database>,
  targetTable: string,
  pkColumn: string,
  targetId: number
): Promise<string | null> {
  const res = await sql<{ updated_at: Date | null }>`
    SELECT updated_at FROM ${sql.table(targetTable)} WHERE ${sql.ref(pkColumn)} = ${targetId} LIMIT 1
  `.execute(trx);
  const row = res.rows[0];
  if (!row?.updated_at) return null;
  return row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at);
}

// ---------------------------------------------------------------------------
// Enqueue an approval hold
// ---------------------------------------------------------------------------

/**
 * Store `payload` as a pending `kind='approval'` row. If an older pending row for the
 * same `(action_type, target_id)` already exists, mark it stale first (conflict
 * policy: only the latest hold is live).
 */
export async function enqueueApproval(
  actionType: ApprovalActionType,
  payload: Record<string, unknown>,
  req: WithSession
): Promise<{ requestId: number }> {
  const action = APPROVAL_ACTIONS[actionType];
  if (!action) throw new Error(`Unknown action_type: ${actionType}`);

  const requestedBy = req.session?.username ?? 'unknown';
  const targetId = action.getTargetId(payload);
  const personId = await resolveApprovalPersonId(actionType, targetId, payload);
  const summary = action.summarize(payload);
  const targetVersion = await action.getVersion(targetId).catch(() => null);

  const db = getKysely();

  // Supersede any existing pending row for the same target+action.
  await sql`
    UPDATE approval_requests
    SET status = 'stale', review_note = 'Superseded by a newer request'
    WHERE action_type = ${actionType}
      AND target_id   = ${targetId}
      AND status      = 'pending'
  `.execute(db);

  const res = await sql<{ request_id: number }>`
    INSERT INTO approval_requests
      (kind, action_type, target_table, target_id, person_id, payload,
       target_version, summary, requested_by, status)
    VALUES
      ('approval', ${actionType}, ${action.targetTable}, ${targetId}, ${personId},
       ${JSON.stringify(payload)}::jsonb, ${targetVersion}, ${summary}, ${requestedBy}, 'pending')
    RETURNING request_id
  `.execute(db);

  const requestId = res.rows[0]!.request_id;
  log.info('Approval enqueued', { actionType, targetId, requestedBy, requestId });
  return { requestId };
}

// ---------------------------------------------------------------------------
// Approve a hold
// ---------------------------------------------------------------------------

export type ApproveResult =
  | { status: 'approved'; row: ApprovalRow }
  | { status: 'conflict' }       // already reviewed (double-click / two admins)
  | { status: 'missing'; row: ApprovalRow }  // target no longer exists
  | { status: 'stale'; row: ApprovalRow };   // target changed since enqueue

export async function approve(
  requestId: number,
  req: WithSession
): Promise<ApproveResult> {
  const reviewedBy = req.session?.username ?? 'unknown';
  const db = getKysely();

  // Phase 1: Atomic claim + integrity checks in a transaction.
  // The claim commits BEFORE apply() runs so a trx-commit failure cannot
  // leave the row stuck at 'pending' while the write side-effect has already landed.
  type Phase1 =
    | { status: 'conflict' }
    | { status: 'missing'; row: ApprovalRow }
    | { status: 'stale'; row: ApprovalRow }
    | { status: 'claimed'; row: ApprovalRow; action: ApprovalActionDef };

  const phase1 = await withPgTransaction(async (trx): Promise<Phase1> => {
    // 1. Atomic claim — only succeeds if still pending.
    const claimRes = await sql<ApprovalRow>`
      UPDATE approval_requests
      SET status = 'approved', reviewed_by = ${reviewedBy}, reviewed_at = LOCALTIMESTAMP
      WHERE request_id = ${requestId} AND status = 'pending'
      RETURNING *
    `.execute(trx);

    if (claimRes.rows.length === 0) {
      return { status: 'conflict' };
    }

    const row = claimRes.rows[0]!;
    const action = APPROVAL_ACTIONS[row.action_type as ApprovalActionType];
    if (!action) {
      await sql`
        UPDATE approval_requests SET status='failed', review_note='Unknown action_type'
        WHERE request_id=${requestId}
      `.execute(trx);
      return { status: 'missing', row };
    }

    const targetId = action.getTargetId(row.payload);

    // 2. Check target still exists.
    const exists = await targetExists(trx, action.targetTable, action.pkColumn, targetId);
    if (!exists) {
      await sql`
        UPDATE approval_requests
        SET status='failed', review_note='Target no longer exists'
        WHERE request_id=${requestId}
      `.execute(trx);
      return { status: 'missing', row: { ...row, status: 'failed', review_note: 'Target no longer exists' } };
    }

    // 3. Stale check — compare stored version with current row version.
    if (row.target_version) {
      const current = await liveVersion(trx, action.targetTable, action.pkColumn, targetId);
      if (current && current !== row.target_version) {
        await sql`
          UPDATE approval_requests
          SET status='stale', review_note='Target changed since request was submitted'
          WHERE request_id=${requestId}
        `.execute(trx);
        return { status: 'stale', row: { ...row, status: 'stale', review_note: 'Target changed since request was submitted' } };
      }
    }

    return { status: 'claimed', row, action };
  });

  if (phase1.status !== 'claimed') return phase1;

  // Phase 2: Apply after the claim has committed. A failure here cannot cause
  // double-apply because the row is already 'approved' in the DB.
  const { row, action } = phase1;
  try {
    await action.apply(row.payload);
    return { status: 'approved', row: { ...row, status: 'approved', reviewed_by: reviewedBy } };
  } catch (err) {
    log.error('Approval apply() failed', { requestId, error: (err as Error).message });
    await sql`
      UPDATE approval_requests
      SET status='failed',
          review_note=${`Apply error: ${(err as Error).message}`}
      WHERE request_id=${requestId}
    `.execute(db);
    return { status: 'missing', row: { ...row, status: 'failed' } };
  }
}

// ---------------------------------------------------------------------------
// Reject a hold
// ---------------------------------------------------------------------------

export async function reject(
  requestId: number,
  note: string | undefined,
  req: WithSession
): Promise<ApprovalRow | null> {
  const reviewedBy = req.session?.username ?? 'unknown';
  const db = getKysely();
  const res = await sql<ApprovalRow>`
    UPDATE approval_requests
    SET status = 'rejected', reviewed_by = ${reviewedBy}, reviewed_at = LOCALTIMESTAMP,
        review_note = ${note ?? null}
    WHERE request_id = ${requestId} AND status = 'pending'
    RETURNING *
  `.execute(db);
  return res.rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Record a notice (same-day money mutation — FYI to admin)
// ---------------------------------------------------------------------------

// Idempotency window: suppress duplicate notices within the same minute per
// (action_type + target_id + requested_by) to absorb CSRF auto-retry pairs.
const NOTICE_DEDUP_MINUTES = 1;

export async function recordNotice(
  actionType: ApprovalActionType,
  payload: Record<string, unknown>,
  req: WithSession
): Promise<void> {
  // Self-guard: never create a notice for an admin's own actions.
  if (normalizeRole(req.session?.userRole) === ROLES.ADMIN) return;

  const action = APPROVAL_ACTIONS[actionType];
  if (!action) return;

  const requestedBy = req.session?.username ?? 'unknown';
  const targetId = action.getTargetId(payload);
  const personId = await resolveApprovalPersonId(actionType, targetId, payload);
  const summary = action.summarize(payload);

  const db = getKysely();

  // Idempotency: skip if an identical notice was already written this minute.
  const dupeCheck = await sql<{ n: number }>`
    SELECT COUNT(*) AS n FROM approval_requests
    WHERE kind = 'notice'
      AND action_type = ${actionType}
      AND target_id   = ${targetId}
      AND requested_by= ${requestedBy}
      AND requested_at >= LOCALTIMESTAMP - INTERVAL '${sql.raw(String(NOTICE_DEDUP_MINUTES))} minutes'
  `.execute(db);
  if (Number(dupeCheck.rows[0]?.n ?? 0) > 0) return;

  await sql`
    INSERT INTO approval_requests
      (kind, action_type, target_table, target_id, person_id, payload, summary, requested_by, status)
    VALUES
      ('notice', ${actionType}, ${action.targetTable}, ${targetId}, ${personId},
       ${JSON.stringify(payload)}::jsonb, ${summary}, ${requestedBy}, 'pending')
  `.execute(db);
}

// ---------------------------------------------------------------------------
// Acknowledge a notice
// ---------------------------------------------------------------------------

export async function acknowledge(
  requestId: number,
  req: WithSession
): Promise<ApprovalRow | null> {
  const reviewedBy = req.session?.username ?? 'unknown';
  const db = getKysely();
  const res = await sql<ApprovalRow>`
    UPDATE approval_requests
    SET status = 'acknowledged', reviewed_by = ${reviewedBy}, reviewed_at = LOCALTIMESTAMP
    WHERE request_id = ${requestId} AND kind = 'notice' AND status = 'pending'
    RETURNING *
  `.execute(db);
  return res.rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Bulk operations
// ---------------------------------------------------------------------------

/**
 * Admin: approve every currently-pending hold, oldest first. Each row runs through
 * the same single-row `approve()` (atomic claim → stale/missing checks → apply), so a
 * row that changed or vanished since it was enqueued is skipped, never mis-applied.
 * One bad row is logged and skipped rather than aborting the batch. Returns how many
 * applied vs. were skipped.
 */
export async function approveAll(
  req: WithSession
): Promise<{ approved: number; skipped: number; total: number }> {
  const db = getKysely();
  const res = await sql<{ request_id: number }>`
    SELECT request_id FROM approval_requests
    WHERE kind = 'approval' AND status = 'pending'
    ORDER BY requested_at ASC
  `.execute(db);
  const ids = res.rows.map((r) => r.request_id);

  let approved = 0;
  for (const id of ids) {
    try {
      const result = await approve(id, req);
      if (result.status === 'approved') approved += 1;
    } catch (err) {
      log.error('approveAll: row failed', { requestId: id, error: (err as Error).message });
    }
  }
  return { approved, skipped: ids.length - approved, total: ids.length };
}

/**
 * Admin: acknowledge every currently-pending notice in one statement (clears the
 * FYI section of the bell). Returns how many rows were cleared.
 */
export async function acknowledgeAll(req: WithSession): Promise<{ cleared: number }> {
  const reviewedBy = req.session?.username ?? 'unknown';
  const db = getKysely();
  const res = await sql<{ request_id: number }>`
    UPDATE approval_requests
    SET status = 'acknowledged', reviewed_by = ${reviewedBy}, reviewed_at = LOCALTIMESTAMP
    WHERE kind = 'notice' AND status = 'pending'
    RETURNING request_id
  `.execute(db);
  return { cleared: res.rows.length };
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

/** Admin: list rows filtered by status (defaults to 'pending'). */
export async function listApprovals(status: ApprovalStatus = 'pending'): Promise<ApprovalRow[]> {
  const db = getKysely();
  const res = await sql<ApprovalRow>`
    SELECT ar.request_id, ar.kind, ar.action_type, ar.target_table, ar.target_id, ar.person_id,
           ar.summary, ar.requested_by, ar.requested_at, ar.status,
           ar.reviewed_by, ar.reviewed_at, ar.review_note,
           p.patient_name
    FROM approval_requests ar
    LEFT JOIN patients p ON p.person_id = ar.person_id
    WHERE ar.status = ${status}
    ORDER BY ar.requested_at DESC
    LIMIT 200
  `.execute(db);
  return res.rows;
}

/** Admin: all non-pending rows newest first (audit trail). */
export async function listHistory(): Promise<ApprovalRow[]> {
  const db = getKysely();
  const res = await sql<ApprovalRow>`
    SELECT ar.request_id, ar.kind, ar.action_type, ar.target_table, ar.target_id, ar.person_id,
           ar.summary, ar.requested_by, ar.requested_at, ar.status,
           ar.reviewed_by, ar.reviewed_at, ar.review_note,
           p.patient_name
    FROM approval_requests ar
    LEFT JOIN patients p ON p.person_id = ar.person_id
    WHERE ar.status <> 'pending'
    ORDER BY ar.requested_at DESC
    LIMIT 500
  `.execute(db);
  return res.rows;
}

/** Requester: their own rows (all statuses). */
export async function listMine(username: string): Promise<ApprovalRow[]> {
  const db = getKysely();
  const res = await sql<ApprovalRow>`
    SELECT ar.request_id, ar.kind, ar.action_type, ar.target_table, ar.target_id, ar.person_id,
           ar.summary, ar.requested_by, ar.requested_at, ar.status,
           ar.reviewed_by, ar.reviewed_at, ar.review_note,
           p.patient_name
    FROM approval_requests ar
    LEFT JOIN patients p ON p.person_id = ar.person_id
    WHERE ar.requested_by = ${username}
    ORDER BY ar.requested_at DESC
    LIMIT 200
  `.execute(db);
  return res.rows;
}
