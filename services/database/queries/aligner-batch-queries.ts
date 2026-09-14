/**
 * Aligner BATCH database queries — the `aligner_batches` table.
 *
 * Split out of aligner-queries.ts (S2/C4). All write paths are transactional TS
 * (`createBatch` / `updateBatch` / `updateBatchStatus` / `deleteBatch`);
 * `resequenceBatches()` renumbers by the existing batch_sequence — see its doc comment.
 *
 * Batch writes adjust only `aligner_sets.remaining_{upper,lower}_aligners`. NB
 * `remaining_*` means NOT-YET-BATCHED (consumed at batch creation) — never derive
 * "delivered" from total − remaining; use the per-batch delivered sums.
 */
import { sql } from 'kysely';
import { getKysely, withPgTransaction } from '../kysely.js';
import { toDateOnly } from '../../../utils/date.js';
import { log } from '../../../utils/logger.js';
import { toIntOr, type PgTransaction } from './aligner-shared.js';
import {
  insertBatchAutoAnnouncement,
  deleteBatchAutoAnnouncement,
} from './announcement-queries.js';

type AlignerBatch = {
  aligner_batch_id: number;
  aligner_set_id: number;
  batch_sequence: number;
  upper_aligner_count: number;
  lower_aligner_count: number;
  upper_aligner_start_sequence: number | null;
  upper_aligner_end_sequence: number | null;
  lower_aligner_start_sequence: number | null;
  lower_aligner_end_sequence: number | null;
  creation_date: Date;
  manufacture_date: string | null;
  delivered_to_patient_date: string | null;
  days: number | null;
  validity_period: number | null;
  batch_expiry_date: string | null;
  notes: string | null;
  is_active: boolean;
  is_last: boolean;
  has_upper_template: boolean;
  has_lower_template: boolean;
};

interface BatchData {
  aligner_set_id: number;
  upper_aligner_count?: number;
  lower_aligner_count?: number;
  // NOTE: manufacture_date and delivered_to_patient_date are managed via updateBatchStatus()
  days?: number | null;
  notes?: string | null;
  is_active?: boolean;
  has_upper_template?: boolean;
  has_lower_template?: boolean;
  is_last?: boolean;
  // NOTE the write surface stops here. batch_sequence and the four upper/lower
  // start/end sequences are DERIVED (createBatch computes them from MAX() over the
  // set; resequenceSet recomputes them on change), batch_expiry_date and
  // validity_period are generated columns, and AlignersInBatch is a retired
  // SQL-Server-era name. They were declared here (and enumerated in the contract)
  // but never read, so the API accepted them and silently dropped them.
}

// Full replace (every editable column is written unconditionally). `aligner_set_id`
// stays REQUIRED: it identifies the owning set and is rejected if it differs from
// the stored value — a batch cannot be moved between sets.
type BatchUpdateData = BatchData;

interface DeactivatedBatchInfo {
  deactivatedBatch: {
    batchId: number;
    batchSequence: number;
  };
}

/**
 * Parsed result from batch status update
 */
export interface UpdateBatchStatusResult {
  batchId: number;
  batchSequence: number;
  setId: number;
  action: string;
  success: boolean;
  message: string;
  wasActivated: boolean;
  wasAlreadyActive: boolean;
  wasAlreadyManufactured: boolean;
  wasAlreadyDelivered: boolean;
  previouslyActiveBatchSequence: number | null;
}

// ==============================
// ALIGNER BATCHES QUERIES
// ==============================

/**
 * Get batches for a specific aligner set
 */
export async function getBatchesBySetId(setId: number): Promise<AlignerBatch[]> {
  try {
    const rows = await getKysely()
      .selectFrom('aligner_batches')
      .where('aligner_set_id', '=', setId)
      .select((eb) => [
        'aligner_batch_id',
        'aligner_set_id',
        'batch_sequence',
        'upper_aligner_count',
        'lower_aligner_count',
        'upper_aligner_start_sequence',
        'upper_aligner_end_sequence',
        'lower_aligner_start_sequence',
        'lower_aligner_end_sequence',
        eb.ref('creation_date').$castTo<Date>().as('creation_date'),
        'manufacture_date',
        'delivered_to_patient_date',
        'days',
        'validity_period',
        'batch_expiry_date',
        'notes',
        'is_active',
        'is_last',
        'has_upper_template',
        'has_lower_template',
      ])
      .orderBy('batch_sequence')
      .execute();

    return rows.map((r) => ({
      aligner_batch_id: r.aligner_batch_id,
      aligner_set_id: r.aligner_set_id,
      batch_sequence: r.batch_sequence,
      upper_aligner_count: r.upper_aligner_count,
      lower_aligner_count: r.lower_aligner_count,
      upper_aligner_start_sequence: r.upper_aligner_start_sequence,
      upper_aligner_end_sequence: r.upper_aligner_end_sequence,
      lower_aligner_start_sequence: r.lower_aligner_start_sequence,
      lower_aligner_end_sequence: r.lower_aligner_end_sequence,
      creation_date: r.creation_date,
      manufacture_date: r.manufacture_date,
      delivered_to_patient_date: r.delivered_to_patient_date,
      days: r.days,
      validity_period: r.validity_period,
      batch_expiry_date: r.batch_expiry_date,
      notes: r.notes,
      is_active: !!r.is_active,
      is_last: r.is_last,
      has_upper_template: r.has_upper_template,
      has_lower_template: r.has_lower_template,
    }));
  } catch (err) {
    log.error('Failed to get batches by set id', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Create a new aligner batch.
 * note: manufacture_date and delivered_to_patient_date are NOT set at creation —
 * they are set later via updateBatchStatus() (MANUFACTURE / DELIVER actions).
 */
export async function createBatch(batchData: BatchData): Promise<number | null> {
  const {
    aligner_set_id,
    upper_aligner_count,
    lower_aligner_count,
    days,
    notes,
    is_active,
    has_upper_template,
    has_lower_template,
    is_last,
  } = batchData;

  const upper = toIntOr(upper_aligner_count, 0);
  const lower = toIntOr(lower_aligner_count, 0);
  const hasU = has_upper_template ?? false;
  const hasL = has_lower_template ?? false;
  const isActive = is_active ?? false;
  const isLast = is_last ?? false;

  return withPgTransaction(async (trx) => {
    const existing = await trx
      .selectFrom('aligner_batches')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('aligner_set_id', '=', aligner_set_id)
      .executeTakeFirst();
    if (Number(existing?.n ?? 0) > 0 && (hasU || hasL)) {
      throw new Error('Template flag can only be set on the first batch in a set');
    }
    if (hasU && upper < 1) throw new Error('has_upper_template = 1 requires upper_aligner_count >= 1');
    if (hasL && lower < 1) throw new Error('has_lower_template = 1 requires lower_aligner_count >= 1');

    const set = await trx
      .selectFrom('aligner_sets')
      .select(['remaining_upper_aligners', 'remaining_lower_aligners'])
      .where('aligner_set_id', '=', aligner_set_id)
      .forUpdate()
      .executeTakeFirst();
    if (!set || set.remaining_upper_aligners == null) throw new Error('AlignerSet not found');
    const remU = set.remaining_upper_aligners;
    const remL = set.remaining_lower_aligners ?? 0;
    const upConsumed = upper - (hasU ? 1 : 0);
    const loConsumed = lower - (hasL ? 1 : 0);
    if (upConsumed > remU) throw new Error(`Cannot add aligner batch: requested upper aligners (${upConsumed}) exceed remaining count (${remU})`);
    if (loConsumed > remL) throw new Error(`Cannot add aligner batch: requested lower aligners (${loConsumed}) exceed remaining count (${remL})`);

    if (isActive) {
      await trx.updateTable('aligner_batches').set({ is_active: false }).where('aligner_set_id', '=', aligner_set_id).where('is_active', '=', true).execute();
    }

    const upperBase = hasU ? -1 : 0;
    const lowerBase = hasL ? -1 : 0;
    const agg = await sql<{ upperstart: number; lowerstart: number; batchseq: number }>`
      SELECT COALESCE(MAX("upper_aligner_end_sequence"), ${upperBase}) + 1 AS upperstart,
             COALESCE(MAX("lower_aligner_end_sequence"), ${lowerBase}) + 1 AS lowerstart,
             COALESCE(MAX("batch_sequence"), 0) + 1 AS batchseq
      FROM "aligner_batches" WHERE "aligner_set_id" = ${aligner_set_id}
    `.execute(trx);
    const a = agg.rows[0];

    const row = await trx
      .insertInto('aligner_batches')
      .values({
        aligner_set_id,
        upper_aligner_count: upper,
        lower_aligner_count: lower,
        manufacture_date: null,
        delivered_to_patient_date: null,
        days: toIntOr(days, null),
        notes: notes || null,
        is_active: isActive,
        is_last: isLast,
        batch_sequence: a.batchseq,
        upper_aligner_start_sequence: upper === 0 ? null : a.upperstart,
        lower_aligner_start_sequence: lower === 0 ? null : a.lowerstart,
        has_upper_template: hasU,
        has_lower_template: hasL,
      })
      .returning('aligner_batch_id')
      .executeTakeFirstOrThrow();

    await trx
      .updateTable('aligner_sets')
      .set({ remaining_upper_aligners: remU - upConsumed, remaining_lower_aligners: remL - loConsumed })
      .where('aligner_set_id', '=', aligner_set_id)
      .execute();

    return row.aligner_batch_id;
  });
}

/**
 * Recompute batch_sequence + Upper/lower_aligner_start_sequence for all batches in a set.
 *
 * Ordering is by the EXISTING (batch_sequence, aligner_batch_id) — a stable compaction that
 * preserves relative order and only closes gaps/recomputes starts. The SQL Server procs
 * ordered by manufacture_date, but under PG that key is a trap: NULLs sort LAST on ASC
 * (SQL Server sorted them FIRST), so an unmanufactured first batch would be reordered
 * BEHIND any manufactured later batch — dethroning a template batch and re-anchoring the
 * FIRST_VALUE(has_*_template) numbering on a batch with no template. Nothing that changes
 * manufacture_date triggers a resequence anyway (updateBatchStatus never calls this), so
 * the date carried no signal here — only the corruption risk.
 */
async function resequenceBatches(trx: PgTransaction, setId: number): Promise<void> {
  // Two-phase renumber: uq_batchsequence_alignersetid is NOT deferrable and PG
  // checks it per-row DURING the statement, so a direct shift (2→1, 3→2, …) can
  // hit 23505 if the heap yields the higher row first. Phase 1 parks every row
  // that must move on its (unique) negative target; phase 2 flips the parked
  // rows positive. Neither phase can collide: parked values are negative,
  // final values are only ever claimed after their previous holder was parked.
  await sql`
    WITH ordered AS (
      SELECT "aligner_batch_id", ROW_NUMBER() OVER (ORDER BY "batch_sequence", "aligner_batch_id") AS newseq
      FROM "aligner_batches" WHERE "aligner_set_id" = ${setId}
    )
    UPDATE "aligner_batches" b SET "batch_sequence" = -o.newseq
    FROM ordered o WHERE b."aligner_batch_id" = o."aligner_batch_id" AND b."batch_sequence" <> o.newseq
  `.execute(trx);
  await sql`
    UPDATE "aligner_batches" SET "batch_sequence" = -"batch_sequence"
    WHERE "aligner_set_id" = ${setId} AND "batch_sequence" < 0
  `.execute(trx);

  await sql`
    WITH ordered AS (
      SELECT "aligner_batch_id", "upper_aligner_count", "lower_aligner_count", "has_upper_template", "has_lower_template",
             ROW_NUMBER() OVER (ORDER BY "batch_sequence", "aligner_batch_id") AS rownum
      FROM "aligner_batches" WHERE "aligner_set_id" = ${setId}
    ),
    cumulative AS (
      SELECT "aligner_batch_id", "upper_aligner_count", "lower_aligner_count", rownum,
        COALESCE(SUM("upper_aligner_count") OVER (ORDER BY rownum ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS prevupper,
        COALESCE(SUM("lower_aligner_count") OVER (ORDER BY rownum ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS prevlower,
        FIRST_VALUE("has_upper_template") OVER (ORDER BY rownum) AS firsthasupper,
        FIRST_VALUE("has_lower_template") OVER (ORDER BY rownum) AS firsthaslower
      FROM ordered
    )
    UPDATE "aligner_batches" b SET
      "upper_aligner_start_sequence" = CASE WHEN c."upper_aligner_count" > 0 THEN c.prevupper + CASE WHEN c.firsthasupper THEN 0 ELSE 1 END ELSE NULL END,
      "lower_aligner_start_sequence" = CASE WHEN c."lower_aligner_count" > 0 THEN c.prevlower + CASE WHEN c.firsthaslower THEN 0 ELSE 1 END ELSE NULL END
    FROM cumulative c WHERE b."aligner_batch_id" = c."aligner_batch_id"
  `.execute(trx);
}

/**
 * Update an aligner batch.
 * NOTE: manufacture_date and delivered_to_patient_date are managed via updateBatchStatus().
 */
export async function updateBatch(
  batchId: number,
  batchData: BatchUpdateData
): Promise<DeactivatedBatchInfo | null> {
  const {
    aligner_set_id,
    upper_aligner_count,
    lower_aligner_count,
    notes,
    is_active,
    days,
    is_last,
    has_upper_template,
    has_lower_template,
  } = batchData;

  const upper = toIntOr(upper_aligner_count, 0);
  const lower = toIntOr(lower_aligner_count, 0);

  await withPgTransaction(async (trx) => {
    const old = await trx
      .selectFrom('aligner_batches')
      .select(['aligner_set_id', 'upper_aligner_count', 'lower_aligner_count', 'days', 'has_upper_template', 'has_lower_template', 'delivered_to_patient_date', 'batch_sequence'])
      .where('aligner_batch_id', '=', batchId)
      .executeTakeFirst();
    if (!old) throw new Error('Aligner batch not found');
    // aligner_set_id identifies the owning set, it is not editable — a batch cannot
    // be moved between sets. Required in the contract, so `undefined` (which never
    // equals the stored id) can no longer reach here from a partial body.
    if (aligner_set_id !== old.aligner_set_id) throw new Error('Cannot change aligner_set_id');

    const oldHasU = old.has_upper_template ?? false;
    const oldHasL = old.has_lower_template ?? false;
    const newHasU = has_upper_template ?? oldHasU;
    const newHasL = has_lower_template ?? oldHasL;

    if (newHasU || newHasL) {
      const earlier = await trx
        .selectFrom('aligner_batches')
        .select('aligner_batch_id')
        .where('aligner_set_id', '=', aligner_set_id)
        .where('aligner_batch_id', '<>', batchId)
        .where('batch_sequence', '<', old.batch_sequence)
        .executeTakeFirst();
      if (earlier) throw new Error('Template flag can only be set on the first batch in a set');
    }
    if (newHasU && upper < 1) throw new Error('has_upper_template = 1 requires upper_aligner_count >= 1');
    if (newHasL && lower < 1) throw new Error('has_lower_template = 1 requires lower_aligner_count >= 1');

    const set = await trx
      .selectFrom('aligner_sets')
      .select(['remaining_upper_aligners', 'remaining_lower_aligners'])
      .where('aligner_set_id', '=', aligner_set_id)
      .forUpdate()
      .executeTakeFirst();
    const remU = set?.remaining_upper_aligners ?? 0;
    const remL = set?.remaining_lower_aligners ?? 0;
    const oldUpConsumed = (old.upper_aligner_count ?? 0) - (oldHasU ? 1 : 0);
    const oldLoConsumed = (old.lower_aligner_count ?? 0) - (oldHasL ? 1 : 0);
    const newUpConsumed = upper - (newHasU ? 1 : 0);
    const newLoConsumed = lower - (newHasL ? 1 : 0);
    if (newUpConsumed > remU + oldUpConsumed) throw new Error(`Cannot update aligner batch: requested upper aligners (${newUpConsumed}) exceed available count (${remU + oldUpConsumed})`);
    if (newLoConsumed > remL + oldLoConsumed) throw new Error(`Cannot update aligner batch: requested lower aligners (${newLoConsumed}) exceed available count (${remL + oldLoConsumed})`);

    if (is_last === true) {
      await trx.updateTable('aligner_batches').set({ is_last: false }).where('aligner_set_id', '=', aligner_set_id).where('aligner_batch_id', '<>', batchId).where('is_last', '=', true).execute();
    }
    if (is_active === true) {
      if (!old.delivered_to_patient_date) throw new Error('Cannot set is_active: batch must be delivered first');
      await trx.updateTable('aligner_batches').set({ is_active: false }).where('aligner_set_id', '=', aligner_set_id).where('aligner_batch_id', '<>', batchId).where('is_active', '=', true).execute();
    }

    const countsChanged = upper !== (old.upper_aligner_count ?? 0) || lower !== (old.lower_aligner_count ?? 0);
    const templateChanged = newHasU !== oldHasU || newHasL !== oldHasL;
    const daysChanged = toIntOr(days, null) !== (old.days ?? null);

    // Renumbering guard: a count/template change resequences every LATER batch's
    // start sequences. If one of those is already manufactured/delivered, its
    // physical aligners carry printed labels the renumber would silently orphan —
    // refuse instead. (Message text is mapped to a 400 in AlignerBatchService's
    // mapBatchUpdateError — keep them in sync.)
    if (countsChanged || templateChanged) {
      const lockedLater = await trx
        .selectFrom('aligner_batches')
        .select('batch_sequence')
        .where('aligner_set_id', '=', aligner_set_id)
        .where('batch_sequence', '>', old.batch_sequence)
        .where((eb) => eb.or([
          eb('manufacture_date', 'is not', null),
          eb('delivered_to_patient_date', 'is not', null),
        ]))
        .orderBy('batch_sequence')
        .limit(1)
        .executeTakeFirst();
      if (lockedLater) {
        throw new Error(
          `Cannot change counts or template: batch #${lockedLater.batch_sequence} is already manufactured/delivered and would be renumbered. Undo its status first.`
        );
      }
    }

    await trx
      .updateTable('aligner_batches')
      .set({
        upper_aligner_count: upper,
        lower_aligner_count: lower,
        days: toIntOr(days, null),
        notes: notes || null,
        is_active: is_active ?? undefined,
        is_last: is_last ?? undefined,
        has_upper_template: newHasU,
        has_lower_template: newHasL,
      })
      .where('aligner_batch_id', '=', batchId)
      .execute();

    if (countsChanged || templateChanged) {
      await resequenceBatches(trx, aligner_set_id);
    }

    const upperDelta = newUpConsumed - oldUpConsumed;
    const lowerDelta = newLoConsumed - oldLoConsumed;
    if (upperDelta !== 0 || lowerDelta !== 0) {
      await trx
        .updateTable('aligner_sets')
        .set({ remaining_upper_aligners: remU - upperDelta, remaining_lower_aligners: remL - lowerDelta })
        .where('aligner_set_id', '=', aligner_set_id)
        .execute();
    }

    if (daysChanged) {
      await trx
        .insertInto('aligner_activity_flags')
        .values({
          aligner_set_id,
          activity_type: 'DaysChanged',
          activity_description: `days changed from ${old.days ?? 'not set'} to ${days ?? 'not set'}`,
          related_record_id: batchId,
        })
        .execute();
    }

  });

  // No result set → no deactivated-batch info.
  return null;
}

/**
 * Update batch status using consolidated stored procedure
 *
 * Actions:
 * - MANUFACTURE: Sets manufacture_date = targetDate, else the current date
 *                If @targetDate provided and already manufactured, updates date
 * - DELIVER: Sets delivered_to_patient_date = targetDate, else the current date
 *            batch_expiry_date is auto-computed from delivered_to_patient_date + (days * AlignerCount)
 *            If batch is latest (highest batch_sequence) AND not already active:
 *            - Deactivates other batches in the set
 *            - Activates this batch
 * - UNDO_MANUFACTURE: Clears manufacture_date (requires batch not yet delivered)
 * - UNDO_DELIVERY: Clears delivered_to_patient_date (batch_expiry_date auto-clears as computed)
 *
 * @param batchId - The batch id to update
 * @param action - The action to perform
 * @param targetDate - Optional date for backdating/correction. If null, uses the current date
 * @returns Result with operation info and activation status
 */
export async function updateBatchStatus(
  batchId: number,
  action: 'MANUFACTURE' | 'DELIVER' | 'UNDO_MANUFACTURE' | 'UNDO_DELIVERY',
  // `string` as well as `Date`: the routes receive a contract-pinned
  // 'YYYY-MM-DD' and must hand it straight to `toDateOnly`, whose pass-through
  // guard keeps it verbatim. Round-tripping it through `new Date()` first parses
  // it as UTC midnight, which the local getters below then shift back a day on
  // any negative-UTC-offset host — correct today only because TZ=Asia/Baghdad.
  targetDate?: Date | string | null
): Promise<UpdateBatchStatusResult> {
  const target = targetDate ? toDateOnly(targetDate) : null;

  return withPgTransaction(async (trx) => {
    const batch = await trx
      .selectFrom('aligner_batches')
      .select(['aligner_set_id', 'batch_sequence', 'manufacture_date', 'delivered_to_patient_date', 'is_active'])
      .where('aligner_batch_id', '=', batchId)
      .forUpdate()
      .executeTakeFirst();
    if (!batch) throw new Error('Aligner batch not found');

    const setId = batch.aligner_set_id;
    const batchSequence = batch.batch_sequence;
    const isCurrentlyActive = batch.is_active ?? false;
    const manufactured = !!batch.manufacture_date;
    const delivered = !!batch.delivered_to_patient_date;
    const today = toDateOnly(new Date());

    const base = {
      batchId, batchSequence, setId, action,
      success: true, wasActivated: false, wasAlreadyActive: isCurrentlyActive,
      wasAlreadyManufactured: false, wasAlreadyDelivered: false,
      previouslyActiveBatchSequence: null as number | null,
    };

    if (action === 'MANUFACTURE') {
      if (manufactured && target === null) {
        return { ...base, wasAlreadyManufactured: true, message: 'Batch already manufactured' };
      }
      const newManufactureDate = target ?? today;
      // A manufacture date later than an existing delivery date is nonsensical —
      // the batch can't be made after it was handed to the patient. (date columns
      // are 'YYYY-MM-DD' strings, so lexical compare == chronological compare.)
      if (batch.delivered_to_patient_date && newManufactureDate > batch.delivered_to_patient_date) {
        throw new Error('Cannot set manufacture date later than the delivery date');
      }
      await trx.updateTable('aligner_batches').set({ manufacture_date: newManufactureDate }).where('aligner_batch_id', '=', batchId).execute();
      // Portal banner: first-time manufacture only — a date correction must not re-announce.
      if (!manufactured) {
        await insertBatchAutoAnnouncement(trx, { batchId, setId, batchSequence, event: 'batch_manufactured' });
      }
      return { ...base, message: manufactured ? 'Manufacture date updated' : 'Batch marked as manufactured' };
    }

    if (action === 'DELIVER') {
      if (!manufactured) throw new Error('Cannot deliver: batch not yet manufactured');
      if (delivered && target === null) {
        return { ...base, wasAlreadyDelivered: true, message: 'Batch already delivered' };
      }
      const newDeliveryDate = target ?? today;
      // Delivery can't predate manufacture — you can't hand over a batch that
      // wasn't made yet. (manufacture_date is non-null here, enforced above.)
      if (batch.manufacture_date && newDeliveryDate < batch.manufacture_date) {
        throw new Error('Cannot deliver: delivery date cannot be earlier than the manufacture date');
      }
      await trx.updateTable('aligner_batches').set({ delivered_to_patient_date: newDeliveryDate }).where('aligner_batch_id', '=', batchId).execute();
      // Portal banner: first-time delivery only — a date correction must not re-announce.
      if (!delivered) {
        await insertBatchAutoAnnouncement(trx, { batchId, setId, batchSequence, event: 'batch_delivered' });
      }

      const maxSeq = await trx
        .selectFrom('aligner_batches')
        .select((eb) => eb.fn.max('batch_sequence').as('m'))
        .where('aligner_set_id', '=', setId)
        .executeTakeFirst();

      let wasActivated = false;
      let previouslyActiveBatchSequence: number | null = null;
      if (batchSequence === maxSeq?.m && !isCurrentlyActive) {
        const prev = await trx
          .selectFrom('aligner_batches')
          .select('batch_sequence')
          .where('aligner_set_id', '=', setId)
          .where('is_active', '=', true)
          .where('aligner_batch_id', '<>', batchId)
          .limit(1)
          .executeTakeFirst();
        previouslyActiveBatchSequence = prev?.batch_sequence ?? null;
        await trx.updateTable('aligner_batches').set({ is_active: false }).where('aligner_set_id', '=', setId).where('aligner_batch_id', '<>', batchId).where('is_active', '=', true).execute();
        await trx.updateTable('aligner_batches').set({ is_active: true }).where('aligner_batch_id', '=', batchId).execute();
        wasActivated = true;
      }      return { ...base, wasActivated, previouslyActiveBatchSequence, message: delivered ? 'Delivery date updated' : 'Batch marked as delivered' };
    }

    if (action === 'UNDO_MANUFACTURE') {
      if (delivered) throw new Error('Cannot undo manufacture: batch already delivered. Undo delivery first.');
      await trx.updateTable('aligner_batches').set({ manufacture_date: null }).where('aligner_batch_id', '=', batchId).execute();
      await deleteBatchAutoAnnouncement(trx, batchId, 'batch_manufactured');
      return { ...base, message: 'Manufacture undone' };
    }

    if (action === 'UNDO_DELIVERY') {
      await trx.updateTable('aligner_batches').set({ delivered_to_patient_date: null, is_active: false }).where('aligner_batch_id', '=', batchId).execute();
      await deleteBatchAutoAnnouncement(trx, batchId, 'batch_delivered');
      return { ...base, message: 'Delivery undone (batch deactivated)' };
    }

    throw new Error('Invalid action. Must be MANUFACTURE, DELIVER, UNDO_MANUFACTURE, or UNDO_DELIVERY');
  });
}

/**
 * Delete a batch (and resequence the survivors).
 */
export async function deleteBatch(batchId: number): Promise<void> {
  await withPgTransaction(async (trx) => {
    const batch = await trx
      .selectFrom('aligner_batches')
      .select(['aligner_set_id', 'batch_sequence', 'upper_aligner_count', 'lower_aligner_count', 'has_upper_template', 'has_lower_template'])
      .where('aligner_batch_id', '=', batchId)
      .executeTakeFirst();
    if (!batch) throw new Error('Aligner batch not found');

    // Renumbering guard — same rule as updateBatch: deleting a batch shifts every
    // later batch's sequence + starts; refuse while a later batch is already
    // manufactured/delivered (printed labels would be orphaned). Message text is
    // mapped to a 400 in AlignerBatchService — keep them in sync.
    const lockedLater = await trx
      .selectFrom('aligner_batches')
      .select('batch_sequence')
      .where('aligner_set_id', '=', batch.aligner_set_id)
      .where('batch_sequence', '>', batch.batch_sequence)
      .where((eb) => eb.or([
        eb('manufacture_date', 'is not', null),
        eb('delivered_to_patient_date', 'is not', null),
      ]))
      .orderBy('batch_sequence')
      .limit(1)
      .executeTakeFirst();
    if (lockedLater) {
      throw new Error(
        `Cannot delete this batch: batch #${lockedLater.batch_sequence} is already manufactured/delivered and would be renumbered. Undo its status first.`
      );
    }

    await trx.deleteFrom('aligner_batches').where('aligner_batch_id', '=', batchId).execute();

    const upperRestored = (batch.upper_aligner_count ?? 0) - (batch.has_upper_template ? 1 : 0);
    const lowerRestored = (batch.lower_aligner_count ?? 0) - (batch.has_lower_template ? 1 : 0);
    await sql`
      UPDATE "aligner_sets"
      SET "remaining_upper_aligners" = "remaining_upper_aligners" + ${upperRestored},
          "remaining_lower_aligners" = "remaining_lower_aligners" + ${lowerRestored}
      WHERE "aligner_set_id" = ${batch.aligner_set_id}
    `.execute(trx);

    await resequenceBatches(trx, batch.aligner_set_id);

  });
}
