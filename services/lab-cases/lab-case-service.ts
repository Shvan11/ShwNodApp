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
            sent_at = COALESCE(${sentOn}, LOCALTIMESTAMP), delivered_at = NULL,
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

    await sql`
      INSERT INTO lab_case_events (lab_case_id, event_type, from_status, to_status, note, created_by)
      VALUES (${row.id}, 'stage_change', ${existing ? 'cancelled' : null}, 'sent_to_lab', ${note}, ${createdBy})
    `.execute(trx);

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

    await sql`
      INSERT INTO lab_case_events (lab_case_id, event_type, from_status, to_status, occurred_at, note, created_by)
      VALUES (${id}, 'stage_change', ${body.fromStatus}, ${body.toStatus}, COALESCE(${occurredAt}, LOCALTIMESTAMP), ${body.note ?? null}, ${createdBy})
    `.execute(trx);

    // A case that physically moved is by definition no longer on hold.
    if (wasOnHold) {
      await sql`
        INSERT INTO lab_case_events (lab_case_id, event_type, occurred_at, created_by)
        VALUES (${id}, 'resume', COALESCE(${occurredAt}, LOCALTIMESTAMP), ${createdBy})
      `.execute(trx);
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
    if (!(LAB_STAGES as readonly string[]).includes(toStatus)) {
      throw new Error('[INVALID_STATE_TRANSITION] Invalid returnToStatus');
    }

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

    await sql`
      INSERT INTO lab_case_events (lab_case_id, event_type, from_status, to_status, occurred_at, note, created_by)
      VALUES (${id}, 'remake', ${fromStatus}, ${toStatus}, COALESCE(${occurredAt}, LOCALTIMESTAMP), ${body.reason}, ${createdBy})
    `.execute(trx);

    return row;
  });
}

// ---------------------------------------------------------------------------
// Hold / resume — the is_on_hold overlay (the case keeps its stage).
// ---------------------------------------------------------------------------

export async function holdLabCase(id: number, body: HoldLabCaseBody, req: WithSession): Promise<LabCaseRow> {
  const createdBy = actingUser(req);
  return withPgTransaction(async (trx: Transaction<Database>) => {
    const res = await sql<LabCaseRow>`
      UPDATE lab_cases SET is_on_hold = true
      WHERE id = ${id} AND status NOT IN ('delivered', 'cancelled')
      RETURNING ${COLS}
    `.execute(trx);
    if (res.rows.length === 0) {
      throw new Error('[INVALID_STATE_TRANSITION] Cannot hold a delivered or cancelled case');
    }
    const row = res.rows[0]!;
    await sql`
      INSERT INTO lab_case_events (lab_case_id, event_type, note, created_by)
      VALUES (${id}, 'hold', ${body.note ?? null}, ${createdBy})
    `.execute(trx);
    return row;
  });
}

export async function resumeLabCase(id: number, body: ResumeLabCaseBody, req: WithSession): Promise<LabCaseRow> {
  const createdBy = actingUser(req);
  return withPgTransaction(async (trx: Transaction<Database>) => {
    const res = await sql<LabCaseRow>`
      UPDATE lab_cases SET is_on_hold = false
      WHERE id = ${id} AND is_on_hold = true
      RETURNING ${COLS}
    `.execute(trx);
    if (res.rows.length === 0) {
      throw new Error('[INVALID_STATE_TRANSITION] Case is not currently on hold');
    }
    const row = res.rows[0]!;
    await sql`
      INSERT INTO lab_case_events (lab_case_id, event_type, note, created_by)
      VALUES (${id}, 'resume', ${body.note ?? null}, ${createdBy})
    `.execute(trx);
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

    await sql`
      INSERT INTO lab_case_events (lab_case_id, event_type, from_status, to_status, note, created_by)
      VALUES (${id}, 'cancel', ${pre.status}, 'cancelled', ${body.note ?? null}, ${createdBy})
    `.execute(trx);

    return row;
  });
}
