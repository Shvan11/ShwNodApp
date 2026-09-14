/**
 * Aligner SET database queries — the `aligner_sets` table.
 *
 * Split out of aligner-queries.ts (S2/C4). A set is one aligner treatment plan on a
 * work; batches (aligner-batch-queries.ts), notes (aligner-note-queries.ts) and
 * payments (aligner-payment-queries.ts) all hang off it.
 *
 * NB `remaining_{upper,lower}_aligners` means NOT-YET-BATCHED (consumed at batch
 * creation) — never derive "delivered" from total − remaining; use the per-batch
 * delivered sums.
 *
 * `getAllAlignerSets` and `getAlignerSetsByWorkId` assemble their joins inline —
 * there are no DB views behind them.
 */
import { sql } from 'kysely';
import { getKysely, withPgTransaction } from '../kysely.js';
import { log } from '../../../utils/logger.js';
import { toIntOr } from './aligner-shared.js';

type AlignerSet = {
  aligner_set_id: number;
  work_id: number;
  set_sequence: number | null;
  type: string | null;
  upper_aligners_count: number;
  lower_aligners_count: number;
  remaining_upper_aligners: number;
  remaining_lower_aligners: number;
  creation_date: string | null;
  days: number | null;
  is_active: boolean;
  notes: string | null;
  folder_path: string | null;
  aligner_dr_id: number;
  set_url: string | null;
  set_pdf_url: string | null;
  set_video: string | null;
  set_cost: number | null;
  currency: string | null;
  archform_id: number | null;
};

type AlignerSetWithDetails = AlignerSet & {
  AlignerDoctorName: string | null;
  TotalBatches: number;
  DeliveredBatches: number;
  DeliveredAligners: number;
  TotalPaid: number | null;
  Balance: number | null;
  PaymentStatus: string | null;
  UnreadActivityCount: number;
};

type AlignerSetFromView = {
  person_id: number;
  patient_name: string;
  work_id: number;
  aligner_dr_id: number;
  aligner_set_id: number;
  set_sequence: number | null;
  SetIsActive: boolean;
  batch_sequence: number | null;
  delivered_to_patient_date: string | null;
  NextDueDate: string | null;
  NextAppointment: Date | null;
  notes: string | null;
  is_last: boolean | null;
  NextBatchPresent: boolean;
  LabStatus: string | null;
  doctor_name: string;
  WorkStatus: number | null;
};

interface AlignerSetData {
  work_id: number;
  set_sequence?: number | null;
  type?: string | null;
  upper_aligners_count?: number;
  lower_aligners_count?: number;
  days?: number | null;
  aligner_dr_id: number;
  set_url?: string | null;
  set_pdf_url?: string | null;
  set_video?: string | null;
  set_cost?: number | null;
  currency?: string | null;
  notes?: string | null;
  is_active?: boolean;
}

interface AlignerSetUpdateData {
  set_sequence?: number | null;
  type?: string | null;
  upper_aligners_count?: number;
  lower_aligners_count?: number;
  days?: number | null;
  aligner_dr_id?: number | null;
  set_url?: string | null;
  set_pdf_url?: string | null;
  set_video?: string | null;
  set_cost?: number | null;
  currency?: string | null;
  notes?: string | null;
  is_active?: boolean;
}

// AlignerPatient row shape is the shared contract's `alignerPatientRow` (imported
// above) — the single source of truth for the all/by-doctor/search endpoints.

// ==============================
// ALIGNER SETS QUERIES
// ==============================

/**
 * Get all aligner sets.
 *
 * FLAG (inlined view): the SQL Server `dbo.v_allsets` view does not exist in the PG
 * schema. Its logic is inlined here:
 *   - "latest batch" per set: ROW_NUMBER() OVER (PARTITION BY aligner_set_id
 *     ORDER BY active-first, batch_sequence DESC) = 1
 *   - NextDueDate: batch_expiry_date of the latest DELIVERED batch
 *   - NextBatchPresent: a manufactured-but-undelivered batch exists beyond the
 *     last delivered sequence
 *   - LabStatus: no_batches / in_lab / needs_mfg / all_delivered
 *   - the view itself filters type_of_work IN (19,20,21)
 * No ORDER BY beyond patient_name: AllSetsList sorts client-side, unconditionally.
 */
export async function getAllAlignerSets(): Promise<AlignerSetFromView[]> {
  try {
    const db = getKysely();

    const rows = await db
      .with('lb', (qb) =>
        qb
          .selectFrom('aligner_batches')
          .select((_eb) => [
            'aligner_set_id',
            'batch_sequence',
            'delivered_to_patient_date',
            'notes',
            'is_last',
            sql<number>`row_number() over (partition by "aligner_set_id" order by case when "is_active" = true then 0 else 1 end, "batch_sequence" desc)`.as(
              'RowNum'
            ),
          ])
      )
      .selectFrom('patients as p')
      .innerJoin('works as w', 'w.person_id', 'p.person_id')
      .innerJoin('aligner_sets as s', 'w.work_id', 's.work_id')
      .innerJoin('aligner_doctors as ad', 's.aligner_dr_id', 'ad.dr_id')
      .leftJoin('lb', (join) =>
        join.onRef('s.aligner_set_id', '=', 'lb.aligner_set_id').on('lb.RowNum', '=', 1)
      )
      .where((eb) =>
        eb.or([
          eb('w.type_of_work', '=', 19),
          eb('w.type_of_work', '=', 20),
          eb('w.type_of_work', '=', 21),
        ])
      )
      .select((eb) => [
        'w.person_id as person_id',
        'p.patient_name as patient_name',
        's.work_id as work_id',
        's.aligner_dr_id as aligner_dr_id',
        's.aligner_set_id as aligner_set_id',
        's.set_sequence as set_sequence',
        // `aligner_sets.is_active` is NULLable but aligner.contract.ts declares
        // `SetIsActive: z.boolean()` — default in SQL so the type is guaranteed.
        eb.fn.coalesce('s.is_active', sql<boolean>`false`).as('SetIsActive'),
        'lb.batch_sequence as batch_sequence',
        'lb.delivered_to_patient_date as delivered_to_patient_date',
        // NextDueDate: batch_expiry_date of the latest DELIVERED batch
        eb
          .selectFrom('aligner_batches as b')
          .whereRef('b.aligner_set_id', '=', 's.aligner_set_id')
          .where('b.delivered_to_patient_date', 'is not', null)
          .orderBy('b.batch_sequence', 'desc')
          .select('b.batch_expiry_date')
          .limit(1)
          .$castTo<string | null>()
          .as('NextDueDate'),
        // NextAppointment: earliest upcoming appointment for the patient (today included,
        // so the front desk sees "coming in today"). Served by ix_pid_all (person_id, app_date).
        eb
          .selectFrom('appointments as ap')
          .whereRef('ap.person_id', '=', 'w.person_id')
          .where('ap.app_date', '>=', sql<Date>`current_date`)
          .select((e) => e.fn.min('ap.app_date').as('next_app'))
          .$castTo<Date | null>()
          .as('NextAppointment'),
        'lb.notes as notes',
        'lb.is_last as is_last',
        // NextBatchPresent: a manufactured-but-undelivered batch beyond the last delivered seq?
        sql<boolean>`exists (
          select 1 from "aligner_batches" "ReadyBatch"
          where "ReadyBatch"."aligner_set_id" = ${eb.ref('s.aligner_set_id')}
            and "ReadyBatch"."manufacture_date" is not null
            and "ReadyBatch"."delivered_to_patient_date" is null
            and "ReadyBatch"."batch_sequence" > coalesce(
              (select max("b2"."batch_sequence") from "aligner_batches" "b2"
               where "b2"."aligner_set_id" = ${eb.ref('s.aligner_set_id')}
                 and "b2"."delivered_to_patient_date" is not null), 0)
        )`.as('NextBatchPresent'),
        // LabStatus
        sql<string>`case
          when not exists (select 1 from "aligner_batches" "b2" where "b2"."aligner_set_id" = ${eb.ref('s.aligner_set_id')}) then 'no_batches'
          when exists (select 1 from "aligner_batches" "b2" where "b2"."aligner_set_id" = ${eb.ref('s.aligner_set_id')} and "b2"."manufacture_date" is not null and "b2"."delivered_to_patient_date" is null) then 'in_lab'
          when exists (select 1 from "aligner_batches" "b2" where "b2"."aligner_set_id" = ${eb.ref('s.aligner_set_id')} and "b2"."manufacture_date" is null) then 'needs_mfg'
          else 'all_delivered' end`.as('LabStatus'),
        'ad.doctor_name as doctor_name',
        'w.status as WorkStatus',
      ])
      .orderBy('p.patient_name')
      .execute();

    return rows;
  } catch (err) {
    log.error('Failed to get all aligner sets', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Get aligner sets for a specific work id.
 *
 * Payment roll-up is joined inline — there is no DB view behind it.
 * Its TotalPaid/Balance/PaymentStatus logic is inlined as a per-set aggregate subquery.
 */
export async function getAlignerSetsByWorkId(workId: number): Promise<AlignerSetWithDetails[]> {
  try {
    const db = getKysely();

    const rows = await db
      .selectFrom('aligner_sets as s')
      .leftJoin('aligner_batches as b', 's.aligner_set_id', 'b.aligner_set_id')
      .leftJoin('aligner_doctors as ad', 's.aligner_dr_id', 'ad.dr_id')
      // Paid-to-date per set, computed ONCE here (was 4 correlated subqueries
      // re-summing invoices inline for TotalPaid/Balance/PaymentStatus).
      .leftJoin(
        (eb) =>
          eb
            .selectFrom('invoices as i')
            .select((e) => ['i.aligner_set_id', e.fn.sum('i.amount_paid').as('tp')])
            .groupBy('i.aligner_set_id')
            .as('ip'),
        (join) => join.onRef('ip.aligner_set_id', '=', 's.aligner_set_id')
      )
      .where('s.work_id', '=', workId)
      .groupBy([
        's.aligner_set_id',
        's.work_id',
        's.set_sequence',
        's.type',
        's.upper_aligners_count',
        's.lower_aligners_count',
        's.remaining_upper_aligners',
        's.remaining_lower_aligners',
        's.creation_date',
        's.days',
        's.is_active',
        's.notes',
        's.folder_path',
        's.aligner_dr_id',
        's.set_url',
        's.set_pdf_url',
        's.set_video',
        's.set_cost',
        's.currency',
        's.archform_id',
        'ad.doctor_name',
        'ip.tp',
      ])
      .select((eb) => [
        's.aligner_set_id',
        's.work_id',
        's.set_sequence',
        's.type',
        's.upper_aligners_count',
        's.lower_aligners_count',
        's.remaining_upper_aligners',
        's.remaining_lower_aligners',
        's.creation_date as creation_date',
        's.days',
        's.is_active',
        's.notes',
        's.folder_path',
        's.aligner_dr_id',
        's.set_url',
        's.set_pdf_url',
        's.set_video',
        eb.ref('s.set_cost').$castTo<number | null>().as('set_cost'),
        's.currency',
        's.archform_id',
        'ad.doctor_name as AlignerDoctorName',
        eb.fn.count('b.aligner_batch_id').as('TotalBatches'),
        eb.fn
          .sum(sql<number>`case when "b"."delivered_to_patient_date" is not null then 1 else 0 end`)
          .as('DeliveredBatches'),
        // Treatment aligners actually delivered to the patient, net of templates
        // (set upper/lower_aligners_count also exclude templates, so the progress
        // numerator and denominator stay consistent). NOT total-minus-remaining:
        // remaining_* is decremented when a batch is CREATED, not delivered.
        eb.fn
          .sum(
            sql<number>`case when "b"."delivered_to_patient_date" is not null
              then ("b"."upper_aligner_count" - case when "b"."has_upper_template" then 1 else 0 end)
                 + ("b"."lower_aligner_count" - case when "b"."has_lower_template" then 1 else 0 end)
              else 0 end`
          )
          .as('DeliveredAligners'),
        // vw_AlignerSetPayments inlined: TotalPaid / Balance / PaymentStatus.
        // All three derive from the single ip.tp paid-to-date join above.
        eb.fn.coalesce(eb.ref('ip.tp'), sql<number>`0`).$castTo<number | null>().as('TotalPaid'),
        sql<number | null>`(${eb.ref('s.set_cost')} - coalesce(${eb.ref('ip.tp')}, 0))`.as('Balance'),
        sql<string | null>`case
          when ${eb.ref('s.set_cost')} is null then 'No Cost Set'
          when coalesce(${eb.ref('ip.tp')}, 0) = 0 then 'Unpaid'
          when coalesce(${eb.ref('ip.tp')}, 0) < ${eb.ref('s.set_cost')} then 'Partial'
          when coalesce(${eb.ref('ip.tp')}, 0) >= ${eb.ref('s.set_cost')} then 'Paid'
          else 'Unknown' end`.as('PaymentStatus'),
        eb
          .selectFrom('aligner_notes as n')
          .whereRef('n.aligner_set_id', '=', 's.aligner_set_id')
          .where('n.note_type', '=', 'Doctor')
          .where('n.is_read', '=', false)
          .select((e) => e.fn.countAll().as('cnt'))
          .as('UnreadActivityCount'),
      ])
      .orderBy('s.set_sequence')
      .execute();

    return rows.map((r) => ({
      aligner_set_id: r.aligner_set_id,
      work_id: r.work_id,
      set_sequence: r.set_sequence,
      type: r.type,
      upper_aligners_count: r.upper_aligners_count ?? 0,
      lower_aligners_count: r.lower_aligners_count ?? 0,
      remaining_upper_aligners: r.remaining_upper_aligners ?? 0,
      remaining_lower_aligners: r.remaining_lower_aligners ?? 0,
      creation_date: r.creation_date,
      days: r.days,
      is_active: !!r.is_active,
      notes: r.notes,
      folder_path: r.folder_path,
      aligner_dr_id: r.aligner_dr_id,
      set_url: r.set_url,
      set_pdf_url: r.set_pdf_url,
      set_video: r.set_video,
      set_cost: r.set_cost,
      currency: r.currency,
      archform_id: r.archform_id,
      AlignerDoctorName: r.AlignerDoctorName,
      TotalBatches: Number(r.TotalBatches) || 0,
      DeliveredBatches: Number(r.DeliveredBatches) || 0,
      DeliveredAligners: Number(r.DeliveredAligners) || 0,
      TotalPaid: r.TotalPaid,
      Balance: r.Balance,
      PaymentStatus: r.PaymentStatus,
      UnreadActivityCount: Number(r.UnreadActivityCount) || 0,
    }));
  } catch (err) {
    log.error('Failed to get aligner sets by work id', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Get a single aligner set by id
 */
export async function getAlignerSetById(setId: number): Promise<AlignerSet | null> {
  try {
    const row = await getKysely()
      .selectFrom('aligner_sets')
      .where('aligner_set_id', '=', setId)
      .select((eb) => [
        'aligner_set_id',
        'work_id',
        'set_sequence',
        'type',
        'upper_aligners_count',
        'lower_aligners_count',
        'remaining_upper_aligners',
        'remaining_lower_aligners',
        'creation_date',
        'days',
        'is_active',
        'notes',
        'folder_path',
        'aligner_dr_id',
        'set_url',
        'set_pdf_url',
        'set_video',
        eb.ref('set_cost').$castTo<number | null>().as('set_cost'),
        'currency',
        'archform_id',
      ])
      .executeTakeFirst();

    if (!row) return null;

    return {
      aligner_set_id: row.aligner_set_id,
      work_id: row.work_id,
      set_sequence: row.set_sequence,
      type: row.type,
      upper_aligners_count: row.upper_aligners_count ?? 0,
      lower_aligners_count: row.lower_aligners_count ?? 0,
      remaining_upper_aligners: row.remaining_upper_aligners ?? 0,
      remaining_lower_aligners: row.remaining_lower_aligners ?? 0,
      creation_date: row.creation_date,
      days: row.days,
      is_active: !!row.is_active,
      notes: row.notes,
      folder_path: row.folder_path,
      aligner_dr_id: row.aligner_dr_id,
      set_url: row.set_url,
      set_pdf_url: row.set_pdf_url,
      set_video: row.set_video,
      set_cost: row.set_cost,
      currency: row.currency,
      archform_id: row.archform_id,
    };
  } catch (err) {
    log.error('Failed to get aligner set by id', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Create a new aligner set with business logic.
 * Deactivates other sets if creating an active set.
 *
 * NOTE (roll-up owned here, not by the DB): under the old engine, INSERT triggers on
 * `tblAlignerSets` maintain derived state (set_sequence allocation, work-total roll-up,
 * remaining-aligner seeding). Those triggers don't exist in PG. This translation seeds
 * RemainingUpper/LowerAligners = Upper/lower_aligners_count explicitly (as the original
 * INSERT did) and writes the provided set_sequence verbatim; any other trigger-maintained
 * column must be reconciled in the Phase-5 AlignerSetService write path.
 */
export async function createAlignerSet(setData: AlignerSetData): Promise<number> {
  const startTime = Date.now();
  const {
    work_id,
    set_sequence,
    type,
    upper_aligners_count,
    lower_aligners_count,
    days,
    aligner_dr_id,
    set_url,
    set_pdf_url,
    set_video,
    set_cost,
    currency,
    notes,
    is_active,
  } = setData;

  const isActive = is_active !== undefined ? is_active : true;
  const upper = toIntOr(upper_aligners_count, 0);
  const lower = toIntOr(lower_aligners_count, 0);

  try {
    return await withPgTransaction(async (trx) => {
      // Deactivate all other sets for this work if creating an active set
      if (isActive) {
        await trx
          .updateTable('aligner_sets')
          .set({ is_active: false })
          .where('work_id', '=', work_id)
          .where('is_active', '=', true)
          .execute();
      }

      const inserted = await trx
        .insertInto('aligner_sets')
        .values({
          work_id,
          set_sequence: set_sequence ?? null,
          type: type || null,
          upper_aligners_count: upper,
          lower_aligners_count: lower,
          remaining_upper_aligners: upper,
          remaining_lower_aligners: lower,
          days: toIntOr(days, null),
          aligner_dr_id,
          set_url: set_url || null,
          set_pdf_url: set_pdf_url || null,
          set_video: set_video || null,
          set_cost: set_cost ?? null,
          currency: currency || null,
          notes: notes || null,
          is_active: isActive,
          creation_date: sql`localtimestamp`,
        })
        .returning('aligner_set_id')
        .executeTakeFirstOrThrow();

      log.debug(`[DB QUERY TIMING] Total createAlignerSet() took: ${Date.now() - startTime}ms`);
      return inserted.aligner_set_id;
    });
  } catch (err) {
    log.error('Failed to create aligner set', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Update an aligner set.
 *
 * NOTE (roll-up owned here, not by the DB): writes `aligner_sets` directly; the old engine
 * UPDATE triggers maintaining derived state are absent in PG. The remaining-aligner
 * delta arithmetic below is preserved verbatim from the original statement.
 */
export async function updateAlignerSet(
  setId: number,
  setData: AlignerSetUpdateData
): Promise<void> {
  const {
    set_sequence,
    type,
    upper_aligners_count,
    lower_aligners_count,
    days,
    aligner_dr_id,
    set_url,
    set_pdf_url,
    set_video,
    set_cost,
    currency,
    notes,
    is_active,
  } = setData;

  try {
    await withPgTransaction(async (trx) => {
      // Lock the set row and re-read its live counts INSIDE the transaction: a
      // concurrent createBatch/updateBatch (which also FOR UPDATE the set) must not
      // change remaining_* between this validation and the delta update below, or
      // the invariant can be violated and remaining_* driven negative (TOCTOU).
      const currentSet = await trx
        .selectFrom('aligner_sets')
        .where('aligner_set_id', '=', setId)
        .select([
          'work_id',
          'upper_aligners_count',
          'lower_aligners_count',
          'remaining_upper_aligners',
          'remaining_lower_aligners',
        ])
        .forUpdate()
        .executeTakeFirst();
      if (!currentSet) {
        throw new Error(`Aligner set ${setId} not found`);
      }

      // Partial update: an omitted count means "unchanged" — default to the
      // current value so the remaining_* delta below is zero, never a wipe to 0.
      const newUpperCount = upper_aligners_count ?? currentSet.upper_aligners_count ?? 0;
      const newLowerCount = lower_aligners_count ?? currentSet.lower_aligners_count ?? 0;

      // How many aligners are already assigned to batches (total - remaining).
      const usedUpper =
        (currentSet.upper_aligners_count ?? 0) - (currentSet.remaining_upper_aligners ?? 0);
      const usedLower =
        (currentSet.lower_aligners_count ?? 0) - (currentSet.remaining_lower_aligners ?? 0);

      // Validate: new total cannot be less than what's already used in batches.
      if (newUpperCount < usedUpper) {
        throw new Error(
          `Cannot reduce upper aligners to ${newUpperCount}. ${usedUpper} are already assigned to batches.`
        );
      }
      if (newLowerCount < usedLower) {
        throw new Error(
          `Cannot reduce lower aligners to ${newLowerCount}. ${usedLower} are already assigned to batches.`
        );
      }

      // Activating this set implies deactivating any sibling — the partial unique
      // index ix_tblalignersets_oneactiveperwork allows one active set per work
      // (same convention as createAlignerSet and updateBatch).
      if (is_active === true) {
        await trx
          .updateTable('aligner_sets')
          .set({ is_active: false })
          .where('work_id', '=', currentSet.work_id)
          .where('aligner_set_id', '<>', setId)
          .where('is_active', '=', true)
          .execute();
      }

      // aligner_dr_id is NOT NULL. Only assign it when a real doctor id is supplied;
      // otherwise omit the column so the UPDATE leaves the existing value intact,
      // rather than binding NULL/'' — which throw 23502 / 22P02 under PG. (The old
      // SQL Server path silently bound NULL here: a latent bug PG now enforces.)
      const rawDrId = aligner_dr_id as number | string | null | undefined;
      const drId =
        rawDrId === null || rawDrId === undefined || rawDrId === ''
          ? undefined
          : Number(rawDrId);
      // Partial update: only fields present in the input are written. An absent
      // field must leave the column untouched — writing unconditional defaults
      // here is what used to wipe set_sequence/days/set_url/set_video/currency
      // to NULL (and flip archived sets active) on every edit.
      await trx
        .updateTable('aligner_sets')
        .set((eb) => ({
          remaining_upper_aligners: sql<number>`${eb.ref('remaining_upper_aligners')} + (${newUpperCount} - ${eb.ref('upper_aligners_count')})`,
          remaining_lower_aligners: sql<number>`${eb.ref('remaining_lower_aligners')} + (${newLowerCount} - ${eb.ref('lower_aligners_count')})`,
          upper_aligners_count: newUpperCount,
          lower_aligners_count: newLowerCount,
          ...(set_sequence !== undefined ? { set_sequence } : {}),
          ...(type !== undefined ? { type: type || null } : {}),
          ...(days !== undefined ? { days: toIntOr(days, null) } : {}),
          ...(drId !== undefined && Number.isFinite(drId)
            ? { aligner_dr_id: drId }
            : {}),
          ...(set_url !== undefined ? { set_url: set_url || null } : {}),
          ...(set_pdf_url !== undefined ? { set_pdf_url: set_pdf_url || null } : {}),
          ...(set_video !== undefined ? { set_video: set_video || null } : {}),
          ...(set_cost !== undefined ? { set_cost } : {}),
          ...(currency !== undefined ? { currency: currency || null } : {}),
          ...(notes !== undefined ? { notes: notes || null } : {}),
          ...(is_active !== undefined ? { is_active } : {}),
        }))
        .where('aligner_set_id', '=', setId)
        .execute();

    });
  } catch (err) {
    log.error('Failed to update aligner set', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Delete an aligner set together with its batches, atomically.
 *
 * Batches are deleted first (FK), then the set, in ONE transaction — previously
 * these were two separate transactions, so a failure/crash between them could
 * leave a set's batches gone while the set itself survived (half-deleted state).
 */
export async function deleteSetWithBatches(setId: number): Promise<void> {
  try {
    await withPgTransaction(async (trx) => {
      await trx.deleteFrom('aligner_batches').where('aligner_set_id', '=', setId).execute();
      await trx.deleteFrom('aligner_sets').where('aligner_set_id', '=', setId).execute();
    });
  } catch (err) {
    log.error('Failed to delete aligner set with batches', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}


/**
 * Does an aligner set exist?
 *
 * Lives here rather than with the notes it guards (it reads `aligner_sets`); the
 * note writes import it as their existence check.
 */
export async function alignerSetExists(setId: number): Promise<boolean> {
  try {
    const row = await getKysely()
      .selectFrom('aligner_sets')
      .select('aligner_set_id')
      .where('aligner_set_id', '=', setId)
      .executeTakeFirst();

    return !!row;
  } catch (err) {
    log.error('Failed to check if aligner set exists', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
