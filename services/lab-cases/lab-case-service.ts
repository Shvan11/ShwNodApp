/**
 * Lab-case-service — the transactional layer for `lab_cases` stage transitions.
 *
 * Every mutation here writes the header row AND a `lab_case_events` row in one
 * `withPgTransaction`, guarded by `WHERE status = $from` / `FOR UPDATE` row locks
 * (clones approval-service.ts / appointment-queries.ts#updatePresent).
 *
 * Error-message-prefix convention (route bridge — see appointment.routes.ts:217):
 *   '[INVALID_STATE_TRANSITION] …' → the route replies 400 with
 *     `details.code = 'INVALID_STATE_TRANSITION'` (the client's
 *     `isInvalidStateTransition` silent-reload predicate).
 *   '[CONFLICT] …'  → the route replies 409.
 *   '[NOT_FOUND] …' → the route replies 404.
 *   anything else   → 500.
 * Thrown INSIDE withPgTransaction, so the transaction rolls back and no orphan
 * `lab_case_events` row lands on a rejected transition.
 */
import { sql, type Transaction } from 'kysely';
import { withPgTransaction, type Database } from '../database/kysely.js';
import { getWorkItemPrefill, COLS } from '../database/queries/lab-case-queries.js';
import { assertRemakeTarget } from './remake-guard.js';
import {
  LAB_STAGES,
  LAB_STAGE_META,
  type LabStage,
  type LabCaseRow,
  type CreateLabCaseBody,
  type AdvanceLabCaseBody,
  type RemakeLabCaseBody,
  type HoldLabCaseBody,
  type ResumeLabCaseBody,
  type CancelLabCaseBody,
} from '../../shared/contracts/lab-case.contract.js';

// Narrow session-only interface — mirrors approval-service.ts's WithSession.
type WithSession = { session?: { username?: string } | null };

const actingUser = (req: WithSession): string => req.session?.username ?? 'unknown';

/**
 * Append one row to the case's audit trail.
 *
 * Every mutation below used to hand-write its own `INSERT INTO lab_case_events`,
 * and the seven copies had already drifted into four different column lists — the
 * exact seam where a field quietly stops being recorded. One insert, one column
 * list, optional fields omitted rather than spelled out per call site.
 */
async function insertEvent(
  trx: Transaction<Database>,
  event: {
    labCaseId: number;
    eventType: 'stage_change' | 'remake' | 'hold' | 'resume' | 'cancel';
    fromStatus?: string | null;
    toStatus?: string | null;
    occurredAt?: string | null;
    note?: string | null;
    createdBy: string;
  }
): Promise<void> {
  await sql`
    INSERT INTO lab_case_events
      (lab_case_id, event_type, from_status, to_status, occurred_at, note, created_by)
    VALUES
      (${event.labCaseId}, ${event.eventType}, ${event.fromStatus ?? null}, ${event.toStatus ?? null},
       COALESCE(${event.occurredAt ?? null}, LOCALTIMESTAMP), ${event.note ?? null}, ${event.createdBy})
  `.execute(trx);
}

/**
 * Row-lock the case and 404 if it isn't there. Without this an UPDATE that matches
 * nothing is ambiguous: no such case, or the case is in the wrong state?
 */
async function assertCaseExists(trx: Transaction<Database>, id: number): Promise<void> {
  const row = await trx
    .selectFrom('lab_cases')
    .select(['id'])
    .where('id', '=', id)
    .forUpdate()
    .executeTakeFirst();
  if (!row) throw new Error('[NOT_FOUND] Lab case');
}

/**
 * Walk backward from `fromStatus` to the nearest earlier `location==='lab'`
 * stage — the case's last at-lab checkpoint before it reached `fromStatus`.
 * Returns `null` when `fromStatus` is (or precedes) the first stage, i.e.
 * there is no earlier lab stage to send the case back to.
 */
function defaultRemakeTarget(fromStatus: LabStage): LabStage | null {
  const idx = LAB_STAGES.indexOf(fromStatus);
  for (let i = idx - 1; i >= 0; i--) {
    if (LAB_STAGE_META[i]!.location === 'lab') return LAB_STAGES[i]!;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Create (Start Lab Flow) — reactivates a cancelled case for the same work item.
// ---------------------------------------------------------------------------

export async function createLabCase(body: CreateLabCaseBody, req: WithSession): Promise<LabCaseRow> {
  const createdBy = actingUser(req);
  const prefill = await getWorkItemPrefill(body.workItemId);
  if (!prefill) throw new Error('[NOT_FOUND] Work item');

  const labId = body.labId ?? prefill.lab_id ?? null;
  const material = body.material ?? prefill.material ?? null;
  const dueDate = body.dueDate || null;
  const sentOn = body.sentOn || null;
  const isRush = body.isRush ?? false;
  const note = body.note ?? null;

  return withPgTransaction(async (trx: Transaction<Database>) => {
    const existing = await trx
      .selectFrom('lab_cases')
      .select(['id', 'status'])
      .where('work_item_id', '=', body.workItemId)
      .forUpdate()
      .executeTakeFirst();

    if (existing && existing.status !== 'cancelled') {
      throw new Error('[CONFLICT] A lab case already exists for this work item');
    }

    let row: LabCaseRow;
    if (existing) {
      const res = await sql<LabCaseRow>`
        UPDATE lab_cases
        SET status = 'sent_to_lab', is_on_hold = false, lab_id = ${labId}, material = ${material},
            due_date = ${dueDate}, is_rush = ${isRush}, note = ${note},
            sent_at = COALESCE(${sentOn}, LOCALTIMESTAMP),
            -- Clear the ENTIRE delivery record. Clearing delivered_at alone left the
            -- previous cycle's delivered_by on a live case: a deliverer with no
            -- delivery time.
            delivered_at = NULL, delivered_by = NULL,
            remake_count = 0, created_by = ${createdBy},
            status_changed_at = LOCALTIMESTAMP
        WHERE id = ${existing.id}
        RETURNING ${COLS}
      `.execute(trx);
      row = res.rows[0]!;
    } else {
      const res = await sql<LabCaseRow>`
        INSERT INTO lab_cases
          (work_item_id, person_id, lab_id, material, status, due_date, is_rush, note, sent_at, created_by)
        VALUES
          (${body.workItemId}, ${prefill.person_id}, ${labId}, ${material}, 'sent_to_lab', ${dueDate},
           ${isRush}, ${note}, COALESCE(${sentOn}, LOCALTIMESTAMP), ${createdBy})
        RETURNING ${COLS}
      `.execute(trx);
      row = res.rows[0]!;
    }

    await insertEvent(trx, {
      labCaseId: row.id,
      eventType: 'stage_change',
      fromStatus: existing ? 'cancelled' : null,
      toStatus: 'sent_to_lab',
      note,
      createdBy,
    });

    return row;
  });
}

// ---------------------------------------------------------------------------
// Advance — lenient forward-skip (index(to) > index(from) only, no adjacency).
// ---------------------------------------------------------------------------

export async function advanceLabCase(id: number, body: AdvanceLabCaseBody, req: WithSession): Promise<LabCaseRow> {
  const createdBy = actingUser(req);

  // Guard-hygiene re-check (belt-and-suspenders over the z.enum(LAB_STAGES) boundary
  // check) — 'cancelled' is not in LAB_STAGES, so indexOf would be -1 for it.
  const fromIdx = LAB_STAGES.indexOf(body.fromStatus);
  const toIdx = LAB_STAGES.indexOf(body.toStatus);
  if (fromIdx === -1 || toIdx === -1 || toIdx <= fromIdx) {
    throw new Error('[INVALID_STATE_TRANSITION] toStatus must be a later stage than fromStatus');
  }

  const occurredAt = body.occurredAt || null;
  const isDelivered = body.toStatus === 'delivered';

  return withPgTransaction(async (trx: Transaction<Database>) => {
    // Row-lock + confirm the caller's observed fromStatus still holds.
    const pre = await trx
      .selectFrom('lab_cases')
      .select(['is_on_hold'])
      .where('id', '=', id)
      .where('status', '=', body.fromStatus)
      .forUpdate()
      .executeTakeFirst();
    if (!pre) {
      throw new Error('[INVALID_STATE_TRANSITION] This case has already moved past the expected stage');
    }
    const wasOnHold = pre.is_on_hold;

    const res = await sql<LabCaseRow>`
      UPDATE lab_cases
      SET status = ${body.toStatus},
          is_on_hold = false,
          status_changed_at = COALESCE(${occurredAt}, LOCALTIMESTAMP),
          delivered_at = CASE WHEN ${isDelivered} THEN COALESCE(${occurredAt}, LOCALTIMESTAMP) ELSE delivered_at END,
          delivered_by = CASE WHEN ${isDelivered} THEN ${createdBy} ELSE delivered_by END
      WHERE id = ${id} AND status = ${body.fromStatus}
      RETURNING ${COLS}
    `.execute(trx);
    const row = res.rows[0]!;

    await insertEvent(trx, {
      labCaseId: id,
      eventType: 'stage_change',
      fromStatus: body.fromStatus,
      toStatus: body.toStatus,
      occurredAt,
      note: body.note ?? null,
      createdBy,
    });

    // A case that physically moved is by definition no longer on hold.
    if (wasOnHold) {
      await insertEvent(trx, { labCaseId: id, eventType: 'resume', occurredAt, createdBy });
    }

    return row;
  });
}

// ---------------------------------------------------------------------------
// Remake / refuse — revert to an earlier at-lab stage, remake_count++.
// Accepts fromStatus='delivered' (the post-delivery warranty path) — the current
// status is read under a row lock, not supplied by the client, so there is no
// client-echoed fromStatus to validate.
// ---------------------------------------------------------------------------

export async function remakeLabCase(id: number, body: RemakeLabCaseBody, req: WithSession): Promise<LabCaseRow> {
  const createdBy = actingUser(req);
  const occurredAt = body.occurredAt || null;

  return withPgTransaction(async (trx: Transaction<Database>) => {
    const pre = await trx.selectFrom('lab_cases').select(['status']).where('id', '=', id).forUpdate().executeTakeFirst();
    if (!pre) throw new Error('[NOT_FOUND] Lab case');

    const fromStatus = pre.status;
    if (fromStatus === 'cancelled') {
      throw new Error('[INVALID_STATE_TRANSITION] Cannot remake a cancelled case');
    }

    let toStatus = body.returnToStatus;
    if (!toStatus) {
      const fallback = defaultRemakeTarget(fromStatus as LabStage);
      if (!fallback) {
        throw new Error('[INVALID_STATE_TRANSITION] No earlier at-lab stage to remake to — specify returnToStatus');
      }
      toStatus = fallback;
    }

    assertRemakeTarget(fromStatus, toStatus);

    const res = await sql<LabCaseRow>`
      UPDATE lab_cases
      SET status = ${toStatus},
          is_on_hold = false,
          remake_count = remake_count + 1,
          status_changed_at = COALESCE(${occurredAt}, LOCALTIMESTAMP)
      WHERE id = ${id}
      RETURNING ${COLS}
    `.execute(trx);
    const row = res.rows[0]!;

    await insertEvent(trx, {
      labCaseId: id,
      eventType: 'remake',
      fromStatus,
      toStatus,
      occurredAt,
      note: body.reason,
      createdBy,
    });

    return row;
  });
}

// ---------------------------------------------------------------------------
// Hold / resume — the is_on_hold overlay (the case keeps its stage).
// ---------------------------------------------------------------------------

export async function holdLabCase(id: number, body: HoldLabCaseBody, req: WithSession): Promise<LabCaseRow> {
  const createdBy = actingUser(req);
  return withPgTransaction(async (trx: Transaction<Database>) => {
    // Lock first so a missing case 404s instead of being reported as a bad state
    // transition — the client's silent-reload predicate fires on the latter and
    // would keep reloading a case that does not exist.
    await assertCaseExists(trx, id);

    const res = await sql<LabCaseRow>`
      UPDATE lab_cases SET is_on_hold = true
      WHERE id = ${id} AND status NOT IN ('delivered', 'cancelled')
      RETURNING ${COLS}
    `.execute(trx);
    if (res.rows.length === 0) {
      throw new Error('[INVALID_STATE_TRANSITION] Cannot hold a delivered or cancelled case');
    }
    const row = res.rows[0]!;
    await insertEvent(trx, { labCaseId: id, eventType: 'hold', note: body.note ?? null, createdBy });
    return row;
  });
}

export async function resumeLabCase(id: number, body: ResumeLabCaseBody, req: WithSession): Promise<LabCaseRow> {
  const createdBy = actingUser(req);
  return withPgTransaction(async (trx: Transaction<Database>) => {
    await assertCaseExists(trx, id);

    const res = await sql<LabCaseRow>`
      UPDATE lab_cases SET is_on_hold = false
      WHERE id = ${id} AND is_on_hold = true
      RETURNING ${COLS}
    `.execute(trx);
    if (res.rows.length === 0) {
      throw new Error('[INVALID_STATE_TRANSITION] Case is not currently on hold');
    }
    const row = res.rows[0]!;
    await insertEvent(trx, { labCaseId: id, eventType: 'resume', note: body.note ?? null, createdBy });
    return row;
  });
}

// ---------------------------------------------------------------------------
// Cancel — soft close (terminal, distinct from delete).
// ---------------------------------------------------------------------------

export async function cancelLabCase(id: number, body: CancelLabCaseBody, req: WithSession): Promise<LabCaseRow> {
  const createdBy = actingUser(req);
  return withPgTransaction(async (trx: Transaction<Database>) => {
    const pre = await trx.selectFrom('lab_cases').select(['status']).where('id', '=', id).forUpdate().executeTakeFirst();
    if (!pre) throw new Error('[NOT_FOUND] Lab case');
    if (pre.status === 'delivered' || pre.status === 'cancelled') {
      throw new Error('[INVALID_STATE_TRANSITION] Cannot cancel a delivered or already-cancelled case');
    }

    const res = await sql<LabCaseRow>`
      UPDATE lab_cases SET status = 'cancelled', is_on_hold = false, status_changed_at = LOCALTIMESTAMP
      WHERE id = ${id}
      RETURNING ${COLS}
    `.execute(trx);
    const row = res.rows[0]!;

    await insertEvent(trx, {
      labCaseId: id,
      eventType: 'cancel',
      fromStatus: pre.status,
      toStatus: 'cancelled',
      note: body.note ?? null,
      createdBy,
    });

    return row;
  });
}
