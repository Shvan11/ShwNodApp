/**
 * Work-related database queries
 *
 * notes for this module:
 *  - Money/amount aggregates (`SUM(invoices.amount_paid)`) come back from PG as a
 *    `numeric`; the centralized pg parser (kysely.ts) returns a JS number, so the
 *    aggregate is coalesced and typed `number`.
 *  - The `works` date columns `start_date`/`debond_date`/`f_photo_date`/`i_photo_date`/
 *    `notes_date`/`discount_date` (and `work_items.start_date`/`completed_date`) are PG
 *    `date` columns, so the parser yields `'YYYY-MM-DD'` strings at runtime.
 *    `addition_date` is a `timestamp`, typed honestly as `Date | null`
 *    on the `Work` interface; consumers that cross the HTTP boundary truncate it to a
 *    local `YYYY-MM-DD` string via `toDateOnly` at the DTO (see `toExistingWorkInfo` in
 *    WorkService) so the wire never carries a UTC-shifted ISO timestamp.
 *
 * Scope: this module owns the `works` ROW — its CRUD, status lifecycle and the
 * create-with-invoice paths. Three neighbours were split out of it (S2/C5) and are
 * the SSoT for their own tables:
 *  - `work-item-queries.ts`     — `work_items` + `work_item_teeth` + `tooth_numbers`
 *  - `work-lookup-queries.ts`   — `work_types` / `keywords` / `implant_manufacturers` / `labs`
 *  - `work-transfer-queries.ts` — moving a work between patients (+ its preview counts)
 */
import { sql, type Kysely } from 'kysely';
import { getKysely, withPgTransaction, type Database } from '../kysely.js';
import { toDateOnly } from '../../../utils/date.js';
import { WORK_STATUS } from '../../../shared/treatment-taxonomy.js';
import { recomputePatientType, recomputePatientTypeForWork } from './patient-type-classifier.js';

/**
 * Work status Constants
 * 1 = Active (ongoing treatment)
 * 2 = Finished (completed successfully)
 * 3 = Discontinued (abandoned by patient)
 *
 * Moved to the cross-boundary SSoT (shared/treatment-taxonomy.ts, shared with the
 * patient-type classifier); re-exported here for the existing importers.
 */
export { WORK_STATUS };

type WorkStatusType = (typeof WORK_STATUS)[keyof typeof WORK_STATUS];

/**
 * Coerce a value bound for a numeric PG column to `number | null`.
 *
 * The route layer forwards JSON form values verbatim, so empty optional numeric
 * fields arrive as `''` (empty string). A plain `?? null` does NOT catch that —
 * `??` only collapses `null`/`undefined` — so the empty string would reach PG and
 * blow up with `invalid input syntax for type smallint: ""`. This treats `''`
 * (and other blank/NaN inputs) as NULL.
 */
function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

// type definitions
interface Work {
  work_id: number;
  person_id: number;
  total_required: number | null;
  currency: string | null;
  type_of_work: number | null;
  notes: string | null;
  status: number;
  addition_date: Date | null;
  start_date: string | null;
  debond_date: string | null;
  f_photo_date: string | null;
  i_photo_date: string | null;
  estimated_duration: number | null;
  dr_id: number | null;
  notes_date: string | null;
  keyword_id_1: number | null;
  keyword_id_2: number | null;
  keyword_id_3: number | null;
  keyword_id_4: number | null;
  keyword_id_5: number | null;
  discount: number | null;
  discount_date: string | null;
  discount_reason: string | null;
  doctor_name: string | null;
  type_name: string | null;
  status_name: string | null;
  Keyword1: string | null;
  Keyword2: string | null;
  Keyword3: string | null;
  Keyword4: string | null;
  Keyword5: string | null;
  WorkStatus: string;
  TotalPaid: number;
}

interface WorkDetails extends Work {
  patient_name: string;
}

/**
 * Truncate a work row's `addition_date` (`timestamp` → a real `Date` at runtime) to a
 * local `YYYY-MM-DD` string for the wire. `res.json()` would otherwise serialize the
 * `Date` via `.toISOString()` (UTC), which can shift a near-midnight value back a day.
 * Every other field is passed through untouched; generic so it covers both `Work`
 * (the list/`getWorksByPatient`) and `WorkDetails`/`getWorkById` callers.
 */
export function toWorkWire<T extends { addition_date: Date | null }>(
  work: T
): Omit<T, 'addition_date'> & { addition_date: string | null } {
  return {
    ...work,
    addition_date: work.addition_date ? toDateOnly(work.addition_date) : null,
  };
}

interface WorkData {
  person_id: number;
  total_required?: number | null;
  currency?: string | null;
  type_of_work?: number | null;
  notes?: string | null;
  status?: WorkStatusType;
  start_date?: string | null;
  debond_date?: string | null;
  f_photo_date?: string | null;
  i_photo_date?: string | null;
  estimated_duration?: number | null;
  dr_id: number;
  notes_date?: string | null;
  keyword_id_1?: number | null;
  keyword_id_2?: number | null;
  keyword_id_3?: number | null;
  keyword_id_4?: number | null;
  keyword_id_5?: number | null;
  discount?: number | null;
  discount_date?: string | null;
  discount_reason?: string | null;
}

interface DependencyCheck {
  InvoiceCount: number;
  VisitCount: number;
  ItemCount: number;
  DiagnosisCount: number;
  ImplantCount: number;
  ScrewCount: number;
  AlignerSetCount: number;
}

interface ValidationResult {
  valid: boolean;
  error?: string;
  existingWork?: {
    work_id: number;
    type: string | null;
    doctor: string | null;
  };
}

// `type` (not `interface`) so an ImplantManufacturer[] is assignable to the
// lookup contract's `z.array(z.looseObject({ id }))` sendData arg (the index-

export async function getWorksByPatient(personId: number): Promise<Work[]> {
  const db = getKysely();
  return db
    .selectFrom('works as w')
    .leftJoin('employees as e', 'e.id', 'w.dr_id')
    .leftJoin('work_types as wt', 'wt.id', 'w.type_of_work')
    .leftJoin('work_statuses as ws', 'ws.status_id', 'w.status')
    .leftJoin('keywords as k1', 'k1.id', 'w.keyword_id_1')
    .leftJoin('keywords as k2', 'k2.id', 'w.keyword_id_2')
    .leftJoin('keywords as k3', 'k3.id', 'w.keyword_id_3')
    .leftJoin('keywords as k4', 'k4.id', 'w.keyword_id_4')
    .leftJoin('keywords as k5', 'k5.id', 'w.keyword_id_5')
    .leftJoin('invoices as i', 'i.work_id', 'w.work_id')
    .where('w.person_id', '=', personId)
    .select((eb) => [
      'w.work_id',
      'w.person_id',
      'w.total_required',
      'w.currency',
      'w.type_of_work',
      'w.notes',
      'w.status',
      'w.addition_date',
      'w.start_date',
      'w.debond_date',
      'w.f_photo_date',
      'w.i_photo_date',
      'w.estimated_duration',
      'w.dr_id',
      'w.notes_date',
      'w.keyword_id_1',
      'w.keyword_id_2',
      'w.keyword_id_3',
      'w.keyword_id_4',
      'w.keyword_id_5',
      'w.discount',
      'w.discount_date',
      'w.discount_reason',
      'e.employee_name as doctor_name',
      'wt.work_type as type_name',
      'ws.status_name',
      'k1.key_word as Keyword1',
      'k2.key_word as Keyword2',
      'k3.key_word as Keyword3',
      'k4.key_word as Keyword4',
      'k5.key_word as Keyword5',
      sql<string>`CASE
        WHEN ${eb.ref('w.status')} = 2 THEN 'Completed'
        WHEN ${eb.ref('w.status')} = 3 THEN 'Discontinued'
        WHEN ${eb.ref('w.start_date')} IS NOT NULL THEN 'In Progress'
        ELSE 'Planned'
      END`.as('WorkStatus'),
      eb.fn.coalesce(eb.fn.sum('i.amount_paid'), sql<number>`0`).$castTo<number>().as('TotalPaid'),
    ])
    .groupBy([
      'w.work_id',
      'w.person_id',
      'w.total_required',
      'w.currency',
      'w.type_of_work',
      'w.notes',
      'w.status',
      'w.addition_date',
      'w.start_date',
      'w.debond_date',
      'w.f_photo_date',
      'w.i_photo_date',
      'w.estimated_duration',
      'w.dr_id',
      'w.notes_date',
      'w.keyword_id_1',
      'w.keyword_id_2',
      'w.keyword_id_3',
      'w.keyword_id_4',
      'w.keyword_id_5',
      'w.discount',
      'w.discount_date',
      'w.discount_reason',
      'e.employee_name',
      'wt.work_type',
      'ws.status_name',
      'k1.key_word',
      'k2.key_word',
      'k3.key_word',
      'k4.key_word',
      'k5.key_word',
    ])
    // NULLS LAST so undated (legacy) works sort to the bottom, matching SQL Server.
    .orderBy('w.addition_date', sql`desc nulls last`)
    .execute();
}

export async function getWorkDetails(workId: number): Promise<WorkDetails | null> {
  const db = getKysely();
  const row = await db
    .selectFrom('works as w')
    .leftJoin('employees as e', 'e.id', 'w.dr_id')
    .leftJoin('work_types as wt', 'wt.id', 'w.type_of_work')
    .leftJoin('work_statuses as ws', 'ws.status_id', 'w.status')
    .leftJoin('keywords as k1', 'k1.id', 'w.keyword_id_1')
    .leftJoin('keywords as k2', 'k2.id', 'w.keyword_id_2')
    .leftJoin('keywords as k3', 'k3.id', 'w.keyword_id_3')
    .leftJoin('keywords as k4', 'k4.id', 'w.keyword_id_4')
    .leftJoin('keywords as k5', 'k5.id', 'w.keyword_id_5')
    .leftJoin('patients as p', 'p.person_id', 'w.person_id')
    .leftJoin('invoices as i', 'i.work_id', 'w.work_id')
    .where('w.work_id', '=', workId)
    .select((eb) => [
      'w.work_id',
      'w.person_id',
      'w.total_required',
      'w.currency',
      'w.type_of_work',
      'w.notes',
      'w.status',
      'w.addition_date',
      'w.start_date',
      'w.debond_date',
      'w.f_photo_date',
      'w.i_photo_date',
      'w.estimated_duration',
      'w.dr_id',
      'w.notes_date',
      'w.keyword_id_1',
      'w.keyword_id_2',
      'w.keyword_id_3',
      'w.keyword_id_4',
      'w.keyword_id_5',
      'w.discount',
      'w.discount_date',
      'w.discount_reason',
      'e.employee_name as doctor_name',
      'wt.work_type as type_name',
      'ws.status_name',
      'k1.key_word as Keyword1',
      'k2.key_word as Keyword2',
      'k3.key_word as Keyword3',
      'k4.key_word as Keyword4',
      'k5.key_word as Keyword5',
      'p.patient_name',
      eb.fn.coalesce(eb.fn.sum('i.amount_paid'), sql<number>`0`).$castTo<number>().as('TotalPaid'),
    ])
    .groupBy([
      'w.work_id',
      'w.person_id',
      'w.total_required',
      'w.currency',
      'w.type_of_work',
      'w.notes',
      'w.status',
      'w.addition_date',
      'w.start_date',
      'w.debond_date',
      'w.f_photo_date',
      'w.i_photo_date',
      'w.estimated_duration',
      'w.dr_id',
      'w.notes_date',
      'w.keyword_id_1',
      'w.keyword_id_2',
      'w.keyword_id_3',
      'w.keyword_id_4',
      'w.keyword_id_5',
      'w.discount',
      'w.discount_date',
      'w.discount_reason',
      'e.employee_name',
      'wt.work_type',
      'ws.status_name',
      'k1.key_word',
      'k2.key_word',
      'k3.key_word',
      'k4.key_word',
      'k5.key_word',
      'p.patient_name',
    ])
    .executeTakeFirst();

  // WorkStatus is not selected by the original detail query — keep parity.
  return (row as WorkDetails | undefined) ?? null;
}

export async function addWork(workData: WorkData): Promise<{ work_id: number } | null> {
  const status = workData.status || WORK_STATUS.ACTIVE;

  // Wrapped so the insert + the derived patient-type recompute commit together.
  return withPgTransaction(async (trx) => {
    const inserted = await trx
      .insertInto('works')
      .values({
        person_id: workData.person_id,
        // total_required / type_of_work are NOT NULL in the PG schema; the WorkData type
        // allows them optional, so keep the legacy `?? null` runtime (PG enforces NOT NULL).
        total_required: numOrNull(workData.total_required) as number,
        currency: workData.currency || null,
        type_of_work: numOrNull(workData.type_of_work) as number,
        notes: workData.notes || null,
        status: status,
        start_date: (workData.start_date as string | null) || null,
        debond_date: (workData.debond_date as string | null) || null,
        f_photo_date: (workData.f_photo_date as string | null) || null,
        i_photo_date: (workData.i_photo_date as string | null) || null,
        estimated_duration: numOrNull(workData.estimated_duration),
        dr_id: workData.dr_id,
        notes_date: (workData.notes_date as string | null) || null,
        keyword_id_1: numOrNull(workData.keyword_id_1),
        keyword_id_2: numOrNull(workData.keyword_id_2),
        keyword_id_3: numOrNull(workData.keyword_id_3),
        keyword_id_4: numOrNull(workData.keyword_id_4),
        keyword_id_5: numOrNull(workData.keyword_id_5),
      })
      .returning('work_id')
      .executeTakeFirst();

    if (!inserted) return null;
    await recomputePatientType(trx, workData.person_id);
    return { work_id: inserted.work_id };
  });
}

export async function updateWork(
  workId: number,
  workData: Partial<WorkData>
): Promise<{ success: boolean; rowCount: number }> {
  // Build dynamic UPDATE - only update fields that are provided.
  const updateValues: Record<string, unknown> = {};

  const fieldValues: Record<string, unknown> = {
    total_required: numOrNull(workData.total_required),
    currency: workData.currency || null,
    type_of_work: numOrNull(workData.type_of_work),
    notes: workData.notes || null,
    status: workData.status ?? WORK_STATUS.ACTIVE,
    start_date: (workData.start_date as string | null) || null,
    debond_date: (workData.debond_date as string | null) || null,
    f_photo_date: (workData.f_photo_date as string | null) || null,
    i_photo_date: (workData.i_photo_date as string | null) || null,
    estimated_duration: numOrNull(workData.estimated_duration),
    dr_id: workData.dr_id,
    notes_date: (workData.notes_date as string | null) || null,
    keyword_id_1: numOrNull(workData.keyword_id_1),
    keyword_id_2: numOrNull(workData.keyword_id_2),
    keyword_id_3: numOrNull(workData.keyword_id_3),
    keyword_id_4: numOrNull(workData.keyword_id_4),
    keyword_id_5: numOrNull(workData.keyword_id_5),
    discount: numOrNull(workData.discount),
    discount_date: (workData.discount_date as string | null) || null,
    discount_reason: workData.discount_reason ?? null,
  };

  // Only include fields that are present in workData
  Object.keys(fieldValues).forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(workData, field)) {
      updateValues[field] = fieldValues[field];
    }
  });

  // If no fields to update, return early
  if (Object.keys(updateValues).length === 0) {
    return { success: true, rowCount: 0 };
  }

  // Presence-keyed (matching the hasOwnProperty field filter above, NOT
  // value-changed): only the classification inputs (status / type_of_work) can
  // move the derived patient type, so recompute only when one of them is present.
  const affectsClassification =
    Object.prototype.hasOwnProperty.call(updateValues, 'status') ||
    Object.prototype.hasOwnProperty.call(updateValues, 'type_of_work');

  return withPgTransaction(async (trx) => {
    const result = await trx
      .updateTable('works')
      .set(updateValues as never)
      .where('work_id', '=', workId)
      .executeTakeFirst();

    if (affectsClassification) {
      await recomputePatientTypeForWork(trx, workId);
    }

    return { success: true, rowCount: Number(result.numUpdatedRows) };
  });
}

export async function finishWork(workId: number): Promise<{ success: boolean; rowCount: number }> {
  return withPgTransaction(async (trx) => {
    const result = await trx
      .updateTable('works')
      .set({ status: WORK_STATUS.FINISHED })
      .where('work_id', '=', workId)
      .executeTakeFirst();

    await recomputePatientTypeForWork(trx, workId);
    return { success: true, rowCount: Number(result.numUpdatedRows) };
  });
}

export async function discontinueWork(
  workId: number
): Promise<{ success: boolean; rowCount: number }> {
  return withPgTransaction(async (trx) => {
    const result = await trx
      .updateTable('works')
      .set({ status: WORK_STATUS.DISCONTINUED })
      .where('work_id', '=', workId)
      .executeTakeFirst();

    await recomputePatientTypeForWork(trx, workId);
    return { success: true, rowCount: Number(result.numUpdatedRows) };
  });
}

export async function reactivateWork(
  workId: number
): Promise<{ success: boolean; rowCount: number }> {
  return withPgTransaction(async (trx) => {
    const result = await trx
      .updateTable('works')
      .set({ status: WORK_STATUS.ACTIVE })
      .where('work_id', '=', workId)
      .executeTakeFirst();

    await recomputePatientTypeForWork(trx, workId);
    return { success: true, rowCount: Number(result.numUpdatedRows) };
  });
}

/**
 * Insert a FINISHED work row on a caller-supplied executor and return its id. Shared
 * by insertWorkWithInvoice + insertIntakeWork. status is hard-coded to 2 (Finished).
 */
async function insertFinishedWorkRow(
  trx: Kysely<Database>,
  workData: WorkData
): Promise<number> {
  const work = await trx
    .insertInto('works')
    .values({
      person_id: workData.person_id,
      total_required: numOrNull(workData.total_required) as number,
      currency: workData.currency || null,
      type_of_work: numOrNull(workData.type_of_work) as number,
      notes: workData.notes || null,
      status: WORK_STATUS.FINISHED,
      start_date: (workData.start_date as string | null) || null,
      debond_date: (workData.debond_date as string | null) || null,
      f_photo_date: (workData.f_photo_date as string | null) || null,
      i_photo_date: (workData.i_photo_date as string | null) || null,
      estimated_duration: numOrNull(workData.estimated_duration),
      dr_id: workData.dr_id,
      notes_date: (workData.notes_date as string | null) || null,
      keyword_id_1: numOrNull(workData.keyword_id_1),
      keyword_id_2: numOrNull(workData.keyword_id_2),
      keyword_id_3: numOrNull(workData.keyword_id_3),
      keyword_id_4: numOrNull(workData.keyword_id_4),
      keyword_id_5: numOrNull(workData.keyword_id_5),
    })
    .returning('work_id')
    .executeTakeFirstOrThrow();
  return work.work_id;
}

/**
 * Insert a full-payment invoice for a work on a caller-supplied executor. The whole
 * `total_required` is booked as received in the work's currency. NOT valid for a
 * zero fee — the invoices table forbids a zero/no-cash row
 * (chk_invoice_amountpaidpositive / chk_invoice_mustreceivecash); callers must skip
 * this for a free work.
 */
async function insertFullPaymentInvoice(
  trx: Kysely<Database>,
  workId: number,
  totalRequired: number,
  currency: string | null | undefined
): Promise<number> {
  const usdReceived = currency === 'USD' || currency === 'EUR' ? totalRequired : 0;
  const iqdReceived = currency === 'IQD' ? totalRequired : 0;
  const invoice = await trx
    .insertInto('invoices')
    .values({
      work_id: workId,
      amount_paid: totalRequired,
      date_of_payment: toDateOnly(new Date()),
      usd_received: usdReceived,
      iqd_received: iqdReceived,
      change: null,
    })
    .returning('invoice_id')
    .executeTakeFirstOrThrow();
  return invoice.invoice_id;
}

/**
 * Insert a FINISHED work + its full-payment invoice on a CALLER-SUPPLIED executor
 * (transaction). Extracted from addWorkWithInvoice so the intake auto-create
 * (PatientService.createPatientWithIntake) can run the same insert inside its own
 * patient-insert transaction — Kysely transactions don't nest, so the caller owns
 * the `withPgTransaction`. Does NOT recompute the patient type: the caller does
 * that once, after all of its works writes. status is hard-coded to 2 (Finished),
 * matching the original VALUES list.
 */
async function insertWorkWithInvoice(
  trx: Kysely<Database>,
  workData: WorkData
): Promise<{ workId: number; invoiceId: number }> {
  const workId = await insertFinishedWorkRow(trx, workData);
  const invoiceId = await insertFullPaymentInvoice(
    trx,
    workId,
    numOrNull(workData.total_required) ?? 0,
    workData.currency
  );
  return { workId, invoiceId };
}

/**
 * Insert an intake auto-work (FINISHED) and, ONLY when it carries a positive fee, its
 * full-payment invoice. A FREE intake (fee 0/null — e.g. a free Consult) inserts the
 * work ALONE: a $0 service has no payment, and the invoices table forbids a zero/
 * no-cash row. Returns invoiceId only when an invoice was created. Caller-supplied
 * executor + no patient-type recompute, same contract as insertWorkWithInvoice.
 */
export async function insertIntakeWork(
  trx: Kysely<Database>,
  workData: WorkData
): Promise<{ workId: number; invoiceId?: number }> {
  const workId = await insertFinishedWorkRow(trx, workData);
  const totalRequired = numOrNull(workData.total_required);
  if (!totalRequired || totalRequired <= 0) {
    return { workId }; // free intake → work only, no invoice
  }
  const invoiceId = await insertFullPaymentInvoice(trx, workId, totalRequired, workData.currency);
  return { workId, invoiceId };
}

export async function addWorkWithInvoice(
  workData: WorkData
): Promise<{ workId: number; invoiceId: number }> {
  // Atomic work + invoice insert + the derived patient-type recompute.
  return withPgTransaction(async (trx) => {
    const result = await insertWorkWithInvoice(trx, workData);
    await recomputePatientType(trx, workData.person_id);
    return result;
  });
}

export async function deleteWork(
  workId: number
): Promise<{ canDelete: boolean; success?: boolean; rowCount?: number; dependencies?: DependencyCheck }> {
  const db = getKysely();
  const dependencyCheck = await db
    .selectNoFrom((eb) => [
      eb
        .selectFrom('invoices')
        .select(eb.fn.countAll<number>().as('c'))
        .where('work_id', '=', workId)
        .as('InvoiceCount'),
      eb
        .selectFrom('visits')
        .select(eb.fn.countAll<number>().as('c'))
        .where('work_id', '=', workId)
        .as('VisitCount'),
      eb
        .selectFrom('work_items')
        .select(eb.fn.countAll<number>().as('c'))
        .where('work_id', '=', workId)
        .as('ItemCount'),
      eb
        .selectFrom('diagnoses')
        .select(eb.fn.countAll<number>().as('c'))
        .where('work_id', '=', workId)
        .as('DiagnosisCount'),
      eb
        .selectFrom('implants')
        .select(eb.fn.countAll<number>().as('c'))
        .where('work_id', '=', workId)
        .as('ImplantCount'),
      eb
        .selectFrom('screws')
        .select(eb.fn.countAll<number>().as('c'))
        .where('work_id', '=', workId)
        .as('ScrewCount'),
      // Aligner sets hang off work_id too; without this the work was deletable while
      // its aligner sets remained (orphaned — there is no DB-level cascade guarding it
      // until the FK_tblAlignerSets_tblwork migration). Block the delete so the user
      // gets the WORK_HAS_DEPENDENCIES warning instead of losing aligner records.
      eb
        .selectFrom('aligner_sets')
        .select(eb.fn.countAll<number>().as('c'))
        .where('work_id', '=', workId)
        .as('AlignerSetCount'),
    ])
    .executeTakeFirstOrThrow();

  const counts: DependencyCheck = {
    InvoiceCount: Number(dependencyCheck.InvoiceCount),
    VisitCount: Number(dependencyCheck.VisitCount),
    ItemCount: Number(dependencyCheck.ItemCount),
    DiagnosisCount: Number(dependencyCheck.DiagnosisCount),
    ImplantCount: Number(dependencyCheck.ImplantCount),
    ScrewCount: Number(dependencyCheck.ScrewCount),
    AlignerSetCount: Number(dependencyCheck.AlignerSetCount),
  };

  // Return dependency information if any exist
  if (
    counts.InvoiceCount > 0 ||
    counts.VisitCount > 0 ||
    counts.ItemCount > 0 ||
    counts.DiagnosisCount > 0 ||
    counts.ImplantCount > 0 ||
    counts.ScrewCount > 0 ||
    counts.AlignerSetCount > 0
  ) {
    return {
      canDelete: false,
      dependencies: counts,
    };
  }

  // If no dependencies, proceed with deletion. Read the owning patient BEFORE the
  // delete (the row is about to vanish) so we can reclassify them afterwards; the
  // delete + the recompute commit atomically.
  const owner = await db
    .selectFrom('works')
    .select('person_id')
    .where('work_id', '=', workId)
    .executeTakeFirst();

  const rowCount = await withPgTransaction(async (trx) => {
    const result = await trx.deleteFrom('works').where('work_id', '=', workId).executeTakeFirst();
    if (owner) await recomputePatientType(trx, owner.person_id);
    return Number(result.numDeletedRows);
  });

  return {
    canDelete: true,
    success: true,
    rowCount,
  };
}

export async function getActiveWork(personId: number): Promise<Work | null> {
  const db = getKysely();
  const row = await db
    .selectFrom('works as w')
    .leftJoin('employees as e', 'e.id', 'w.dr_id')
    .leftJoin('work_types as wt', 'wt.id', 'w.type_of_work')
    .leftJoin('work_statuses as ws', 'ws.status_id', 'w.status')
    .where('w.person_id', '=', personId)
    .where('w.status', '=', 1)
    .selectAll('w')
    .select([
      'e.employee_name as doctor_name',
      'wt.work_type as type_name',
      'ws.status_name',
    ])
    // NULLS LAST: PG sorts NULLs first on DESC (SQL Server sorted them last), so a
    // legacy status=1 row with a NULL addition_date would otherwise be picked as "the"
    // active work ahead of real-dated rows. Keep dated works winning the LIMIT 1.
    .orderBy('w.addition_date', sql`desc nulls last`)
    .limit(1)
    .executeTakeFirst();

  return (row as Work | undefined) ?? null;
}

export async function getWorkById(workId: number): Promise<Work | null> {
  const db = getKysely();
  const row = await db
    .selectFrom('works as w')
    .leftJoin('employees as e', 'e.id', 'w.dr_id')
    .leftJoin('work_types as wt', 'wt.id', 'w.type_of_work')
    .leftJoin('work_statuses as ws', 'ws.status_id', 'w.status')
    .where('w.work_id', '=', workId)
    .selectAll('w')
    .select([
      'e.employee_name as doctor_name',
      'wt.work_type as type_name',
      'ws.status_name',
    ])
    .executeTakeFirst();

  return (row as Work | undefined) ?? null;
}

export async function validateStatusChange(
  workId: number,
  newStatus: WorkStatusType,
  personId: number
): Promise<ValidationResult> {
  // If changing to Active (1), check for existing active work
  if (newStatus === WORK_STATUS.ACTIVE && personId) {
    const activeWork = await getActiveWork(personId);

    // If there's an active work and it's NOT the one being updated
    if (activeWork && activeWork.work_id !== workId) {
      return {
        valid: false,
        error: 'Patient already has an active work',
        existingWork: {
          work_id: activeWork.work_id,
          type: activeWork.type_name,
          doctor: activeWork.doctor_name,
        },
      };
    }
  }

  return { valid: true };
}
