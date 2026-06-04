/**
 * Aligner-related database queries
 *
 * This module contains all SQL queries for aligner management including:
 * - Aligner doctors
 * - Aligner sets
 * - Aligner batches
 * - Aligner notes
 * - Aligner patients
 * - Aligner payments
 *
 * Migration Phase 4 + 5: all functions are typed Kysely (PostgreSQL) via `getKysely()` /
 * `withPgTransaction()`. The four batch stored procedures (usp_CreateAlignerBatch /
 * usp_UpdateAlignerBatch / usp_UpdateBatchStatus / usp_DeleteAlignerBatch) are reimplemented as
 * transactional TS write paths here (`createBatch` / `updateBatch` / `updateBatchStatus` /
 * `deleteBatch`); `resequenceBatches()` is the verbatim port of the procs' resequencing CTEs.
 * `createNote` folds in trg_AlignerNotes_DoctorActivity (Doctor-note → activity flag).
 *
 * The batch procs only adjust `tblAlignerSets.Remaining{Upper,Lower}Aligners`, which touches none
 * of the tblAlignerSets UPDATE triggers (they fire only on days/set_cost/currency/creation_date),
 * so no extra set-trigger cascade is needed here.
 *
 * Two SQL Server views are inlined (no PG equivalent): `v_allsets` → `getAllAlignerSets`;
 * `vw_AlignerSetPayments` → `getAlignerSetsByWorkId` + `getAlignerSetBalance`.
 *
 * FLAG (Phase 7 parity): `createAlignerSet`/`updateAlignerSet` preserve the inline set_sequence /
 * work-total / remaining-aligner logic carried over from Phase 4 (the tblAlignerSets INSERT-trigger
 * effects); verify against the SQL Server baseline.
 */
import { sql, type Transaction } from 'kysely';
import { getKysely, withPgTransaction, type Database } from '../kysely.js';

type PgTransaction = Transaction<Database>;
import { toDateOnly } from '../../../utils/date.js';
import { log } from '../../../utils/logger.js';

// ==============================
// TYPE DEFINITIONS
// ==============================

interface AlignerDoctor {
  dr_id: number;
  doctor_name: string;
  doctor_email: string | null;
  logo_path: string | null;
}

interface AlignerDoctorWithUnread extends AlignerDoctor {
  UnreadDoctorNotes: number;
  // Aliased properties for frontend compatibility
  id: number;
  name: string;
  logoPath: string | null;
}

interface DoctorData {
  doctor_name: string;
  doctor_email?: string | null;
  logo_path?: string | null;
}

interface AlignerSet {
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
}

interface AlignerSetWithDetails extends AlignerSet {
  AlignerDoctorName: string | null;
  TotalBatches: number;
  DeliveredBatches: number;
  TotalPaid: number | null;
  Balance: number | null;
  PaymentStatus: string | null;
  UnreadActivityCount: number;
}

interface AlignerSetFromView {
  person_id: number;
  patient_name: string;
  work_id: number;
  aligner_dr_id: number;
  aligner_set_id: number;
  set_sequence: number | null;
  SetIsActive: boolean;
  batch_sequence: number | null;
  creation_date: string | null;
  BatchCreationDate: Date | null;
  manufacture_date: string | null;
  delivered_to_patient_date: string | null;
  NextDueDate: string | null;
  notes: string | null;
  is_last: boolean | null;
  NextBatchPresent: string | null;
  LabStatus: string | null;
  doctor_name: string;
  WorkStatus: number | null;
  WorkStatusName: string | null;
}

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

interface AlignerPatient {
  person_id: number;
  first_name: string | null;
  last_name: string | null;
  patient_name: string;
  phone: string | null;
  workid: number;
  work_type: string;
  WorkTypeID: number;
  TotalSets?: number;
  ActiveSets?: number;
  UnreadDoctorNotes?: number;
  DateOfBirth?: Date | null;
  start_date?: Date | null;
}

interface AlignerBatch {
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
}

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
  batch_sequence?: number;
  AlignersInBatch?: number;
  upper_aligner_start_sequence?: number;
  upper_aligner_end_sequence?: number;
  lower_aligner_start_sequence?: number;
  lower_aligner_end_sequence?: number;
  // note: batch_expiry_date and validity_period are computed columns - cannot be set directly
}

interface BatchUpdateData extends Omit<BatchData, 'aligner_set_id'> {
  aligner_set_id?: number;
}

/**
 * Coerce a possibly-empty / string numeric input to an integer.
 *
 * Blank form fields arrive over JSON as `''`, which `??` does NOT catch —
 * passing `''` to an integer column throws PG `22P02`
 * (`invalid input syntax for type integer: ""`). Returns `fallback` for
 * null/undefined/empty/non-numeric values; otherwise the truncated integer.
 */
function toIntOr<T extends number | null>(value: unknown, fallback: T): number | T {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

interface AlignerNote {
  note_id: number;
  aligner_set_id: number;
  note_type: 'Lab' | 'Doctor';
  note_text: string;
  created_at: Date;
  is_edited: boolean;
  edited_at: Date | null;
  is_read: boolean;
  doctor_name: string;
}

interface AlignerPaymentData {
  workid: number;
  aligner_set_id: number | null;
  amount_paid: number | string;
  date_of_payment: Date | string;
  actual_amount?: number | null;
  actual_cur?: string | null;
  change?: number | null;
  usd_received?: number;
  iqd_received?: number;
  notes?: string;
}

interface AlignerSetBalance {
  aligner_set_id: number;
  set_cost: number | null;
  TotalPaid: number | null;
  Balance: number | null;
}

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
  wasAlreadyDelivered: boolean;
  previouslyActiveBatchSequence: number | null;
}

// ==============================
// ALIGNER DOCTORS QUERIES
// ==============================

/**
 * Get all aligner doctors with unread notes count
 */
export async function getDoctorsWithUnreadCounts(): Promise<AlignerDoctorWithUnread[]> {
  try {
    const rows = await getKysely()
      .selectFrom('aligner_doctors as ad')
      .select((eb) => [
        'ad.dr_id',
        'ad.doctor_name',
        'ad.logo_path',
        eb
          .selectFrom('aligner_notes as n')
          .innerJoin('aligner_sets as s', 'n.aligner_set_id', 's.aligner_set_id')
          .whereRef('s.aligner_dr_id', '=', 'ad.dr_id')
          .where('n.note_type', '=', 'Doctor')
          .where('n.is_read', '=', false)
          .select((e) => e.fn.countAll().as('cnt'))
          .as('UnreadDoctorNotes'),
      ])
      .distinct()
      .orderBy('ad.doctor_name')
      .execute();

    return rows.map((r) => ({
      dr_id: r.dr_id,
      doctor_name: r.doctor_name,
      doctor_email: null,
      logo_path: r.logo_path,
      UnreadDoctorNotes: Number(r.UnreadDoctorNotes) || 0,
      // Aliased properties for frontend compatibility (PrintQueueContext expects these)
      id: r.dr_id,
      name: r.doctor_name,
      logoPath: r.logo_path,
    }));
  } catch (err) {
    log.error('Failed to get doctors with unread counts', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Get all aligner doctors (simple list)
 */
export async function getAllDoctors(): Promise<AlignerDoctor[]> {
  try {
    return (await getKysely()
      .selectFrom('aligner_doctors')
      .select(['dr_id', 'doctor_name', 'doctor_email', 'logo_path'])
      .orderBy('doctor_name')
      .execute()) as AlignerDoctor[];
  } catch (err) {
    log.error('Failed to get all doctors', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Check if doctor email exists (excluding specific doctor)
 */
export async function isDoctorEmailTaken(
  email: string,
  excludeDrID: number | null = null
): Promise<boolean> {
  if (!email || email.trim() === '') {
    return false;
  }

  try {
    let q = getKysely()
      .selectFrom('aligner_doctors')
      .select('dr_id')
      // doctor_email is citext → case-insensitive comparison, matching Arabic_CI_AS.
      .where('doctor_email', '=', email.trim());

    if (excludeDrID) {
      q = q.where('dr_id', '!=', excludeDrID);
    }

    const row = await q.executeTakeFirst();
    return !!row;
  } catch (err) {
    log.error('Failed to check if doctor email is taken', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Get count of aligner sets for a doctor
 */
export async function getDoctorSetCount(drID: number): Promise<number> {
  try {
    const row = await getKysely()
      .selectFrom('aligner_sets')
      .where('aligner_dr_id', '=', drID)
      .select((eb) => eb.fn.countAll().as('SetCount'))
      .executeTakeFirst();

    return Number(row?.SetCount) || 0;
  } catch (err) {
    log.error('Failed to get doctor set count', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Create a new aligner doctor
 */
export async function createDoctor(doctorData: DoctorData): Promise<number | null> {
  const { doctor_name, doctor_email, logo_path } = doctorData;

  try {
    return await withPgTransaction(async (trx) => {
      const row = await trx
        .insertInto('aligner_doctors')
        .values({
          doctor_name: doctor_name.trim(),
          doctor_email: doctor_email && doctor_email.trim() !== '' ? doctor_email.trim() : null,
          logo_path: logo_path && logo_path.trim() !== '' ? logo_path.trim() : null,
        })
        .returning('dr_id')
        .executeTakeFirstOrThrow();

      return row.dr_id;
    });
  } catch (err) {
    log.error('Failed to create doctor', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Update an aligner doctor
 */
export async function updateDoctor(drID: number, doctorData: DoctorData): Promise<void> {
  const { doctor_name, doctor_email, logo_path } = doctorData;

  try {
    await withPgTransaction(async (trx) => {
      await trx
        .updateTable('aligner_doctors')
        .set({
          doctor_name: doctor_name.trim(),
          doctor_email: doctor_email && doctor_email.trim() !== '' ? doctor_email.trim() : null,
          logo_path: logo_path && logo_path.trim() !== '' ? logo_path.trim() : null,
        })
        .where('dr_id', '=', drID)
        .execute();

    });
  } catch (err) {
    log.error('Failed to update doctor', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Delete an aligner doctor
 */
export async function deleteDoctor(drID: number): Promise<void> {
  try {
    await withPgTransaction(async (trx) => {
      await trx.deleteFrom('aligner_doctors').where('dr_id', '=', drID).execute();
    });
  } catch (err) {
    log.error('Failed to delete doctor', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

// ==============================
// ALIGNER SETS QUERIES
// ==============================

/**
 * Get all aligner sets.
 *
 * FLAG (inlined view): the SQL Server `dbo.v_allsets` view does not exist in the PG
 * schema (views land in Phase 5). Its logic is inlined here:
 *   - "latest batch" per set: ROW_NUMBER() OVER (PARTITION BY aligner_set_id
 *     ORDER BY active-first, batch_sequence DESC) = 1
 *   - NextDueDate: batch_expiry_date of the latest DELIVERED batch
 *   - NextBatchPresent ('True'/'False'): a manufactured-but-undelivered batch exists
 *     beyond the last delivered sequence
 *   - LabStatus: no_batches / in_lab / needs_mfg / all_delivered
 *   - the view itself filters type_of_work IN (19,20,21)
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
            'aligner_batch_id',
            'batch_sequence',
            'creation_date',
            'manufacture_date',
            'delivered_to_patient_date',
            'batch_expiry_date',
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
      .leftJoin('work_statuses as ws', 'w.status', 'ws.status_id')
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
        's.is_active as SetIsActive',
        'lb.batch_sequence as batch_sequence',
        's.creation_date as creation_date',
        eb.ref('lb.creation_date').$castTo<Date | null>().as('BatchCreationDate'),
        'lb.manufacture_date as manufacture_date',
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
        'lb.notes as notes',
        'lb.is_last as is_last',
        // NextBatchPresent: a manufactured-but-undelivered batch beyond the last delivered seq?
        sql<string>`case when exists (
          select 1 from "aligner_batches" "ReadyBatch"
          where "ReadyBatch"."aligner_set_id" = ${eb.ref('s.aligner_set_id')}
            and "ReadyBatch"."manufacture_date" is not null
            and "ReadyBatch"."delivered_to_patient_date" is null
            and "ReadyBatch"."batch_sequence" > coalesce(
              (select max("b2"."batch_sequence") from "aligner_batches" "b2"
               where "b2"."aligner_set_id" = ${eb.ref('s.aligner_set_id')}
                 and "b2"."delivered_to_patient_date" is not null), 0)
        ) then 'True' else 'False' end`.as('NextBatchPresent'),
        // LabStatus
        sql<string>`case
          when not exists (select 1 from "aligner_batches" "b2" where "b2"."aligner_set_id" = ${eb.ref('s.aligner_set_id')}) then 'no_batches'
          when exists (select 1 from "aligner_batches" "b2" where "b2"."aligner_set_id" = ${eb.ref('s.aligner_set_id')} and "b2"."manufacture_date" is not null and "b2"."delivered_to_patient_date" is null) then 'in_lab'
          when exists (select 1 from "aligner_batches" "b2" where "b2"."aligner_set_id" = ${eb.ref('s.aligner_set_id')} and "b2"."manufacture_date" is null) then 'needs_mfg'
          else 'all_delivered' end`.as('LabStatus'),
        'ad.doctor_name as doctor_name',
        'w.status as WorkStatus',
        'ws.status_name as WorkStatusName',
      ])
      .orderBy(sql`case when "s"."is_active" = true then 0 else 1 end`)
      .orderBy(
        sql`case when (case when exists (
          select 1 from "aligner_batches" "ReadyBatch"
          where "ReadyBatch"."aligner_set_id" = "s"."aligner_set_id"
            and "ReadyBatch"."manufacture_date" is not null
            and "ReadyBatch"."delivered_to_patient_date" is null
            and "ReadyBatch"."batch_sequence" > coalesce(
              (select max("b2"."batch_sequence") from "aligner_batches" "b2"
               where "b2"."aligner_set_id" = "s"."aligner_set_id"
                 and "b2"."delivered_to_patient_date" is not null), 0)
        ) then 'True' else 'False' end) = 'False' then 0 else 1 end`
      )
      .orderBy(
        sql`(select b."batch_expiry_date" from "aligner_batches" b
          where b."aligner_set_id" = "s"."aligner_set_id" and b."delivered_to_patient_date" is not null
          order by b."batch_sequence" desc limit 1) asc`
      )
      .orderBy('p.patient_name')
      .execute();

    return rows as unknown as AlignerSetFromView[];
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
 * FLAG (inlined view): joins the `vw_AlignerSetPayments` view (absent from PG — Phase 5).
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
 * FLAG (Phase 5 / trigger-dependent): under SQL Server, INSERT triggers on
 * `tblAlignerSets` maintain derived state (set_sequence allocation, work-total roll-up,
 * remaining-aligner seeding). Those triggers don't exist in PG. This translation seeds
 * RemainingUpper/LowerAligners = Upper/lower_aligners_count explicitly (as the original
 * INSERT did) and writes the provided set_sequence verbatim; any other trigger-maintained
 * column must be reconciled in the Phase-5 AlignerService write path.
 */
export async function createAlignerSet(setData: AlignerSetData): Promise<number | null> {
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
 * FLAG (Phase 5 / trigger-dependent): writes `tblAlignerSets` directly; SQL Server
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

  const newUpperCount = upper_aligners_count ?? 0;
  const newLowerCount = lower_aligners_count ?? 0;

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

      // aligner_dr_id is NOT NULL. Only assign it when a real doctor id is supplied;
      // otherwise omit the column so the UPDATE leaves the existing value intact,
      // rather than binding NULL/'' — which throw 23502 / 22P02 under PG. (The old
      // SQL Server path silently bound NULL here: a latent bug PG now enforces.)
      const rawDrId = aligner_dr_id as number | string | null | undefined;
      const drId =
        rawDrId === null || rawDrId === undefined || rawDrId === ''
          ? undefined
          : Number(rawDrId);
      await trx
        .updateTable('aligner_sets')
        .set((eb) => ({
          set_sequence: set_sequence ?? null,
          type: type || null,
          remaining_upper_aligners: sql<number>`${eb.ref('remaining_upper_aligners')} + (${newUpperCount} - ${eb.ref('upper_aligners_count')})`,
          remaining_lower_aligners: sql<number>`${eb.ref('remaining_lower_aligners')} + (${newLowerCount} - ${eb.ref('lower_aligners_count')})`,
          upper_aligners_count: newUpperCount,
          lower_aligners_count: newLowerCount,
          days: toIntOr(days, null),
          ...(drId !== undefined && Number.isFinite(drId)
            ? { aligner_dr_id: drId }
            : {}),
          set_url: set_url || null,
          set_pdf_url: set_pdf_url || null,
          set_video: set_video || null,
          set_cost: set_cost ?? null,
          currency: currency || null,
          notes: notes || null,
          is_active: is_active !== undefined ? is_active : true,
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

// ==============================
// ALIGNER PATIENTS QUERIES
// ==============================

/**
 * Get all aligner patients (all doctors)
 */
export async function getAllAlignerPatients(): Promise<AlignerPatient[]> {
  try {
    const rows = await getKysely()
      .selectFrom('patients as p')
      .innerJoin('works as w', 'p.person_id', 'w.person_id')
      .innerJoin('work_types as wt', 'w.type_of_work', 'wt.id')
      .innerJoin('aligner_sets as s', 'w.work_id', 's.work_id')
      .where('wt.id', 'in', [19, 20, 21])
      .groupBy([
        'p.person_id',
        'p.first_name',
        'p.last_name',
        'p.patient_name',
        'p.phone',
        'w.work_id',
        'wt.work_type',
        'w.type_of_work',
      ])
      .select((eb) => [
        'p.person_id',
        'p.first_name',
        'p.last_name',
        'p.patient_name',
        'p.phone',
        'w.work_id',
        'wt.work_type',
        'w.type_of_work as WorkTypeID',
        eb.fn.count('s.aligner_set_id').distinct().as('TotalSets'),
        eb.fn
          .sum(sql<number>`case when "s"."is_active" = true then 1 else 0 end`)
          .as('ActiveSets'),
      ])
      .orderBy('p.patient_name')
      .orderBy('p.first_name')
      .orderBy('p.last_name')
      .distinct()
      .execute();

    return rows.map((r) => ({
      person_id: r.person_id,
      first_name: r.first_name,
      last_name: r.last_name,
      patient_name: r.patient_name,
      phone: r.phone,
      workid: r.work_id,
      work_type: r.work_type,
      WorkTypeID: r.WorkTypeID,
      TotalSets: Number(r.TotalSets) || 0,
      ActiveSets: Number(r.ActiveSets) || 0,
    }));
  } catch (err) {
    log.error('Failed to get all aligner patients', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Get aligner patients by doctor id
 */
export async function getAlignerPatientsByDoctor(doctorId: number): Promise<AlignerPatient[]> {
  try {
    const rows = await getKysely()
      .selectFrom('patients as p')
      .innerJoin('works as w', 'p.person_id', 'w.person_id')
      .innerJoin('work_types as wt', 'w.type_of_work', 'wt.id')
      .innerJoin('aligner_sets as s', 'w.work_id', 's.work_id')
      .where('wt.id', 'in', [19, 20, 21])
      .where('s.aligner_dr_id', '=', doctorId)
      .groupBy([
        'p.person_id',
        'p.first_name',
        'p.last_name',
        'p.patient_name',
        'p.phone',
        'w.work_id',
        'wt.work_type',
        'w.type_of_work',
      ])
      .select((eb) => [
        'p.person_id',
        'p.first_name',
        'p.last_name',
        'p.patient_name',
        'p.phone',
        'w.work_id',
        'wt.work_type',
        'w.type_of_work as WorkTypeID',
        eb.fn.count('s.aligner_set_id').distinct().as('TotalSets'),
        eb.fn
          .sum(sql<number>`case when "s"."is_active" = true then 1 else 0 end`)
          .as('ActiveSets'),
        eb
          .selectFrom('aligner_notes as n')
          .innerJoin('aligner_sets as sets', 'n.aligner_set_id', 'sets.aligner_set_id')
          .whereRef('sets.work_id', '=', 'w.work_id')
          .where('n.note_type', '=', 'Doctor')
          .where('n.is_read', '=', false)
          .select((e) => e.fn.countAll().as('cnt'))
          .as('UnreadDoctorNotes'),
      ])
      .orderBy('p.patient_name')
      .orderBy('p.first_name')
      .orderBy('p.last_name')
      .distinct()
      .execute();

    return rows.map((r) => ({
      person_id: r.person_id,
      first_name: r.first_name,
      last_name: r.last_name,
      patient_name: r.patient_name,
      phone: r.phone,
      workid: r.work_id,
      work_type: r.work_type,
      WorkTypeID: r.WorkTypeID,
      TotalSets: Number(r.TotalSets) || 0,
      ActiveSets: Number(r.ActiveSets) || 0,
      UnreadDoctorNotes: Number(r.UnreadDoctorNotes) || 0,
    }));
  } catch (err) {
    log.error('Failed to get aligner patients by doctor', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Search for aligner patients
 */
export async function searchAlignerPatients(
  searchTerm: string,
  doctorId: number | null = null
): Promise<AlignerPatient[]> {
  try {
    const like = `%${searchTerm}%`;

    let q = getKysely()
      .selectFrom('patients as p')
      .innerJoin('works as w', 'p.person_id', 'w.person_id')
      .innerJoin('work_types as wt', 'w.type_of_work', 'wt.id')
      .innerJoin('aligner_sets as s', 'w.work_id', 's.work_id')
      .where('wt.id', 'in', [19, 20, 21])
      .where((eb) =>
        eb.or([
          // citext columns → case-insensitive LIKE, matching Arabic_CI_AS.
          eb('p.first_name', 'like', like),
          eb('p.last_name', 'like', like),
          eb('p.patient_name', 'like', like),
          eb('p.phone', 'like', like),
          eb(sql<string>`${eb.ref('p.first_name')} || ' ' || ${eb.ref('p.last_name')}`, 'like', like),
        ])
      );

    if (doctorId && !isNaN(doctorId)) {
      q = q.where('s.aligner_dr_id', '=', doctorId);
    }

    const rows = await q
      .select([
        'p.person_id',
        'p.first_name',
        'p.last_name',
        'p.patient_name',
        'p.phone',
        'w.work_id as workid',
        'wt.work_type',
        'w.type_of_work as WorkTypeID',
      ])
      .distinct()
      .orderBy('p.first_name')
      .orderBy('p.last_name')
      .execute();

    return rows as AlignerPatient[];
  } catch (err) {
    log.error('Failed to search aligner patients', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
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
 * Create a new aligner batch using optimized stored procedure
 * note: manufacture_date and delivered_to_patient_date are not set during creation
 * They should be set via usp_UpdateBatchStatus (MANUFACTURE/DELIVER actions)
 *
 * Phase 5: reimplemented as a TS write path; still routes to the proc stub for now.
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
 * Recompute batch_sequence + Upper/lower_aligner_start_sequence for all batches in a set, ordered by
 * (manufacture_date, aligner_batch_id). Verbatim port of the resequencing CTEs in the delete/update procs.
 */
async function resequenceBatches(trx: PgTransaction, setId: number): Promise<void> {
  await sql`
    WITH ordered AS (
      SELECT "aligner_batch_id", ROW_NUMBER() OVER (ORDER BY "manufacture_date", "aligner_batch_id") AS newseq
      FROM "aligner_batches" WHERE "aligner_set_id" = ${setId}
    )
    UPDATE "aligner_batches" b SET "batch_sequence" = o.newseq
    FROM ordered o WHERE b."aligner_batch_id" = o."aligner_batch_id" AND b."batch_sequence" <> o.newseq
  `.execute(trx);

  await sql`
    WITH ordered AS (
      SELECT "aligner_batch_id", "upper_aligner_count", "lower_aligner_count", "has_upper_template", "has_lower_template",
             ROW_NUMBER() OVER (ORDER BY "manufacture_date", "aligner_batch_id") AS rownum
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
 * Update an aligner batch using optimized stored procedure
 * NOTE: manufacture_date and delivered_to_patient_date are managed via updateBatchStatus()
 *
 * Phase 5: reimplemented as a TS write path; still routes to the proc stub for now.
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

  // usp_UpdateAlignerBatch returned no result set → no deactivated-batch info.
  return null;
}

/**
 * Update batch status using consolidated stored procedure
 *
 * Actions:
 * - MANUFACTURE: Sets manufacture_date = @targetDate or GETDATE()
 *                If @targetDate provided and already manufactured, updates date
 * - DELIVER: Sets delivered_to_patient_date = @targetDate or GETDATE()
 *            batch_expiry_date is auto-computed from delivered_to_patient_date + (days * AlignerCount)
 *            If batch is latest (highest batch_sequence) AND not already active:
 *            - Deactivates other batches in the set
 *            - Activates this batch
 * - UNDO_MANUFACTURE: Clears manufacture_date (requires batch not yet delivered)
 * - UNDO_DELIVERY: Clears delivered_to_patient_date (batch_expiry_date auto-clears as computed)
 *
 * @param batchId - The batch id to update
 * @param action - The action to perform
 * @param targetDate - Optional date for backdating/correction. If null, uses GETDATE()
 * @returns Result with operation info and activation status
 *
 * Phase 5: reimplemented as a TS write path; still routes to the proc stub for now.
 */
export async function updateBatchStatus(
  batchId: number,
  action: 'MANUFACTURE' | 'DELIVER' | 'UNDO_MANUFACTURE' | 'UNDO_DELIVERY',
  targetDate?: Date | null
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
      wasAlreadyDelivered: false, previouslyActiveBatchSequence: null as number | null,
    };

    if (action === 'MANUFACTURE') {
      if (manufactured && target === null) {
        return { ...base, message: 'Batch already manufactured' };
      }
      await trx.updateTable('aligner_batches').set({ manufacture_date: target ?? today }).where('aligner_batch_id', '=', batchId).execute();      return { ...base, message: manufactured ? 'Manufacture date updated' : 'Batch marked as manufactured' };
    }

    if (action === 'DELIVER') {
      if (!manufactured) throw new Error('Cannot deliver: batch not yet manufactured');
      if (delivered && target === null) {
        return { ...base, wasAlreadyDelivered: true, message: 'Batch already delivered' };
      }
      await trx.updateTable('aligner_batches').set({ delivered_to_patient_date: target ?? today }).where('aligner_batch_id', '=', batchId).execute();

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
      await trx.updateTable('aligner_batches').set({ manufacture_date: null }).where('aligner_batch_id', '=', batchId).execute();      return { ...base, message: 'Manufacture undone' };
    }

    if (action === 'UNDO_DELIVERY') {
      await trx.updateTable('aligner_batches').set({ delivered_to_patient_date: null, is_active: false }).where('aligner_batch_id', '=', batchId).execute();      return { ...base, message: 'Delivery undone (batch deactivated)' };
    }

    throw new Error('Invalid action. Must be MANUFACTURE, DELIVER, UNDO_MANUFACTURE, or UNDO_DELIVERY');
  });
}

/**
 * Delete a batch using optimized stored procedure
 *
 * Phase 5: reimplemented as a TS write path; still routes to the proc stub for now.
 */
export async function deleteBatch(batchId: number): Promise<void> {
  await withPgTransaction(async (trx) => {
    const batch = await trx
      .selectFrom('aligner_batches')
      .select(['aligner_set_id', 'upper_aligner_count', 'lower_aligner_count', 'has_upper_template', 'has_lower_template'])
      .where('aligner_batch_id', '=', batchId)
      .executeTakeFirst();
    if (!batch) throw new Error('Aligner batch not found');

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

// ==============================
// ALIGNER NOTES QUERIES
// ==============================

/**
 * Get notes for an aligner set
 */
export async function getNotesBySetId(setId: number): Promise<AlignerNote[]> {
  try {
    const rows = await getKysely()
      .selectFrom('aligner_notes as n')
      .innerJoin('aligner_sets as s', 'n.aligner_set_id', 's.aligner_set_id')
      .innerJoin('aligner_doctors as d', 's.aligner_dr_id', 'd.dr_id')
      .where('n.aligner_set_id', '=', setId)
      .select((eb) => [
        'n.note_id',
        'n.aligner_set_id',
        'n.note_type',
        'n.note_text',
        eb.ref('n.created_at').$castTo<Date>().as('created_at'),
        'n.is_edited',
        eb.ref('n.edited_at').$castTo<Date | null>().as('edited_at'),
        'n.is_read',
        'd.doctor_name',
      ])
      .orderBy('n.created_at', 'desc')
      .execute();

    return rows.map((r) => ({
      note_id: r.note_id,
      aligner_set_id: r.aligner_set_id,
      note_type: r.note_type as 'Lab' | 'Doctor',
      note_text: r.note_text,
      created_at: r.created_at,
      is_edited: !!r.is_edited,
      edited_at: r.edited_at,
      is_read: r.is_read,
      doctor_name: r.doctor_name,
    }));
  } catch (err) {
    log.error('Failed to get notes by set id', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Check if aligner set exists
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

/**
 * Create a note
 *
 * FLAG (Phase 5 / trigger-dependent): SQL Server `trg_AlignerNotes_DoctorActivity` fires
 * on INSERT here to maintain doctor-activity flags. That trigger is absent in PG; this
 * statement is translated as the raw INSERT only.
 */
export async function createNote(
  setId: number,
  noteText: string,
  noteType: 'Lab' | 'Doctor' = 'Lab'
): Promise<number | null> {
  try {
    return await withPgTransaction(async (trx) => {
      const row = await trx
        .insertInto('aligner_notes')
        .values({
          aligner_set_id: setId,
          note_type: noteType,
          note_text: noteText.trim(),
        })
        .returning('note_id')
        .executeTakeFirstOrThrow();

      // trg_AlignerNotes_DoctorActivity: a Doctor note logs a "DoctorNote" activity flag.
      if (noteType === 'Doctor') {
        const doc = await trx
          .selectFrom('aligner_sets as s')
          .leftJoin('aligner_doctors as d', 'd.dr_id', 's.aligner_dr_id')
          .where('s.aligner_set_id', '=', setId)
          .select('d.doctor_name')
          .executeTakeFirst();
        await trx
          .insertInto('aligner_activity_flags')
          .values({
            aligner_set_id: setId,
            activity_type: 'DoctorNote',
            activity_description: `Dr. ${doc?.doctor_name ?? 'Unknown'} added a note`,
            related_record_id: row.note_id,
          })
          .execute();
      }

      return row.note_id;
    });
  } catch (err) {
    log.error('Failed to create note', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

interface NoteInfo {
  note_id: number;
  note_type: 'Lab' | 'Doctor';
}

/**
 * Check if note exists
 */
export async function getNoteById(noteId: number): Promise<NoteInfo | null> {
  try {
    const row = await getKysely()
      .selectFrom('aligner_notes')
      .select(['note_id', 'note_type'])
      .where('note_id', '=', noteId)
      .executeTakeFirst();

    if (!row) return null;
    return { note_id: row.note_id, note_type: row.note_type as 'Lab' | 'Doctor' };
  } catch (err) {
    log.error('Failed to get note by id', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Update a note
 */
export async function updateNote(noteId: number, noteText: string): Promise<void> {
  try {
    await withPgTransaction(async (trx) => {
      await trx
        .updateTable('aligner_notes')
        .set({ note_text: noteText.trim(), is_edited: true, edited_at: sql`localtimestamp` })
        .where('note_id', '=', noteId)
        .execute();
    });
  } catch (err) {
    log.error('Failed to update note', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Toggle note read status
 */
export async function toggleNoteReadStatus(noteId: number): Promise<void> {
  try {
    await withPgTransaction(async (trx) => {
      await trx
        .updateTable('aligner_notes')
        .set((eb) => ({
          is_read: sql<boolean>`case when ${eb.ref('is_read')} = true then false else true end`,
        }))
        .where('note_id', '=', noteId)
        .execute();
    });
  } catch (err) {
    log.error('Failed to toggle note read status', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Delete a note
 */
export async function deleteNote(noteId: number): Promise<void> {
  try {
    await withPgTransaction(async (trx) => {
      await trx.deleteFrom('aligner_notes').where('note_id', '=', noteId).execute();
    });
  } catch (err) {
    log.error('Failed to delete note', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Get note read status
 */
export async function getNoteReadStatus(noteId: number): Promise<boolean | null> {
  try {
    const row = await getKysely()
      .selectFrom('aligner_notes')
      .select('is_read')
      .where('note_id', '=', noteId)
      .executeTakeFirst();

    return row ? row.is_read : null;
  } catch (err) {
    log.error('Failed to get note read status', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

// ==============================
// ALIGNER PAYMENTS QUERIES
// ==============================

/**
 * Add payment for an aligner set
 *
 * FLAG (date-string): `tblInvoice.date_of_payment` is a PG `date` column; the value is
 * bound as a 'YYYY-MM-DD' string (via toDateOnly) wrapped in `sql<string>` so PG infers the
 * date type and the column isn't shifted by a UTC conversion (see CLAUDE.md date gotcha).
 * `amount_paid`/`actual_amount`/`change`/`usd_received`/`iqd_received` are plain integer columns.
 */
export async function createAlignerPayment(
  paymentData: AlignerPaymentData
): Promise<number | null> {
  const { workid, aligner_set_id, amount_paid, date_of_payment, actual_amount, actual_cur, change } =
    paymentData;

  // Determine USD vs IQD based on currency (default to USD for aligner payments)
  const currency = actual_cur || 'USD';
  const parsedAmount = typeof amount_paid === 'string' ? parseFloat(amount_paid) : amount_paid;
  const amount = Math.round(parsedAmount); // Round to integer for usd_received/iqd_received columns
  const usdReceived = currency === 'USD' ? amount : 0;
  const iqdReceived = currency === 'IQD' ? amount : 0;

  log.info('Creating aligner payment', {
    workid,
    aligner_set_id,
    amount_paid,
    currency,
    usdReceived,
    iqdReceived,
  });

  try {
    const dateStr = toDateOnly(new Date(date_of_payment as string));
    const paidAmount =
      typeof amount_paid === 'string' ? parseFloat(amount_paid) : amount_paid;

    const row = await getKysely()
      .insertInto('invoices')
      .values({
        work_id: workid,
        amount_paid: Math.round(paidAmount),
        date_of_payment: sql<string>`${dateStr}`,
        actual_amount: actual_amount ?? null,
        actual_cur: actual_cur || null,
        change: change ?? null,
        aligner_set_id: aligner_set_id || null,
        usd_received: usdReceived,
        iqd_received: iqdReceived,
      })
      .returning('invoice_id')
      .executeTakeFirstOrThrow();

    return row.invoice_id;
  } catch (err) {
    log.error('Failed to create aligner payment', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Get aligner set balance information for validation.
 *
 * FLAG (inlined view): `vw_AlignerSetPayments` is absent from the PG schema (Phase 5);
 * its set_cost / TotalPaid / Balance logic is inlined as a single aggregate query.
 */
export async function getAlignerSetBalance(alignerSetId: number): Promise<AlignerSetBalance | null> {
  try {
    const row = await getKysely()
      .selectFrom('aligner_sets as s')
      .leftJoin('invoices as i', 's.aligner_set_id', 'i.aligner_set_id')
      .where('s.aligner_set_id', '=', alignerSetId)
      .groupBy(['s.aligner_set_id', 's.set_cost'])
      .select((eb) => [
        's.aligner_set_id',
        eb.ref('s.set_cost').$castTo<number | null>().as('set_cost'),
        eb.fn.coalesce(eb.fn.sum('i.amount_paid'), sql<number>`0`).$castTo<number>().as('TotalPaid'),
        sql<number | null>`${eb.ref('s.set_cost')} - coalesce(sum(i."amount_paid"), 0)`.as('Balance'),
      ])
      .executeTakeFirst();

    if (!row) return null;
    return {
      aligner_set_id: row.aligner_set_id,
      set_cost: row.set_cost,
      TotalPaid: row.TotalPaid,
      Balance: row.Balance,
    };
  } catch (err) {
    log.error('Failed to get aligner set balance', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

// ==============================
// LABEL GENERATION QUERIES
// ==============================

/**
 * Get a single batch by id
 */
export async function getBatchById(batchId: number): Promise<AlignerBatch[]> {
  try {
    const rows = await getKysely()
      .selectFrom('aligner_batches')
      .where('aligner_batch_id', '=', batchId)
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
        'notes',
        'is_active',
        'is_last',
        'has_upper_template',
        'has_lower_template',
      ])
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
      validity_period: null,
      batch_expiry_date: null,
      notes: r.notes,
      is_active: !!r.is_active,
      is_last: r.is_last,
      has_upper_template: r.has_upper_template,
      has_lower_template: r.has_lower_template,
    }));
  } catch (err) {
    log.error('Failed to get batch by id', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

// ==============================
// ARCHFORM MATCHING QUERIES
// ==============================

export interface AlignerSetForMatch {
  aligner_set_id: number;
  work_id: number;
  person_id: number;
  archform_id: number | null;
  patient_name: string;
  set_sequence: number | null;
  doctor_name: string;
}

/**
 * Get all aligner sets with patient context for Archform matching
 */
export async function getSetsWithArchformIds(): Promise<AlignerSetForMatch[]> {
  try {
    const rows = await getKysely()
      .selectFrom('aligner_sets as s')
      .innerJoin('works as w', 's.work_id', 'w.work_id')
      .innerJoin('patients as p', 'w.person_id', 'p.person_id')
      .leftJoin('aligner_doctors as ad', 's.aligner_dr_id', 'ad.dr_id')
      .select((eb) => [
        's.aligner_set_id',
        's.work_id',
        'p.person_id',
        's.archform_id',
        'p.patient_name',
        'p.first_name',
        'p.last_name',
        's.set_sequence',
        eb.fn.coalesce('ad.doctor_name', sql<string>`''`).as('doctor_name'),
      ])
      .orderBy('p.patient_name')
      .execute();

    return rows as unknown as AlignerSetForMatch[];
  } catch (err) {
    log.error('Failed to get sets with archform ids', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Update the archform_id on an aligner set (set or clear)
 */
export async function updateArchformId(
  setId: number,
  archformId: number | null
): Promise<void> {
  try {
    await getKysely()
      .updateTable('aligner_sets')
      .set({ archform_id: archformId })
      .where('aligner_set_id', '=', setId)
      .execute();
  } catch (err) {
    log.error('Failed to update archform id', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Clear archform_id from all aligner sets that reference a given Archform patient.
 * Used before deleting an Archform patient to prevent orphaned references.
 */
export async function clearArchformIdByPatientId(archformPatientId: number): Promise<void> {
  try {
    await getKysely()
      .updateTable('aligner_sets')
      .set({ archform_id: null })
      .where('archform_id', '=', archformPatientId)
      .execute();
  } catch (err) {
    log.error('Failed to clear archform id by patient id', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

