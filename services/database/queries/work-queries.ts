/**
 * Work-related database queries
 *
 * Migration Phase 4: translated to typed Kysely (PostgreSQL). Runs against the pg
 * pool regardless of DB_DRIVER — the positional `ColumnValue[]` mappers are gone and
 * the bodies return plain objects.
 *
 * notes for this module:
 *  - Money/amount aggregates (`SUM(tblInvoice.amount_paid)`) come back from PG as a
 *    `numeric`; the centralized pg parser (kysely.ts) returns a JS number, so the
 *    aggregate is coalesced and typed `number`.
 *  - The work-table date columns `start_date`/`debond_date`/`f_photo_date`/`i_photo_date`/
 *    `notes_date`/`discount_date` (and `tblWorkItems.start_date`/`completed_date`) are PG
 *    `date` columns, so the parser yields `'YYYY-MM-DD'` strings at runtime (mssql
 *    returned `Date`). `addition_date` is a `timestamp`, typed honestly as `Date | null`
 *    on the `Work` interface; consumers that cross the HTTP boundary truncate it to a
 *    local `YYYY-MM-DD` string via `toDateOnly` at the DTO (see `toExistingWorkInfo` in
 *    WorkService) so the wire never carries a UTC-shifted ISO timestamp.
 */
import { sql, type Kysely } from 'kysely';
import { getKysely, withPgTransaction, type Database } from '../kysely.js';
import { toDateOnly } from '../../../utils/date.js';

/**
 * Normalize a form-supplied numeric value for a nullable numeric column.
 * Empty string (unfilled form field), null and undefined all become null;
 * a real 0 is preserved. PG rejects "" for numeric columns (22P02), so this
 * must run on numeric fields that can arrive as "" from the client.
 */
function numericOrNull(value: number | string | null | undefined): number | null {
  if (value === '' || value === null || value === undefined) return null;
  return Number(value);
}

/**
 * Work status Constants
 * 1 = Active (ongoing treatment)
 * 2 = Finished (completed successfully)
 * 3 = Discontinued (abandoned by patient)
 */
export const WORK_STATUS = {
  ACTIVE: 1,
  FINISHED: 2,
  DISCONTINUED: 3,
} as const;

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

// Row types that feed a `sendData(res, <looseObject>.response, …)` call are
// `type` aliases, NOT `interface`s — a `z.looseObject` response infers a string
// index signature, and an `interface` isn't assignable to an index-signatured
// type (TS2345), whereas a `type` alias gets an implicit one. See the ⚠️ CRITICAL
// looseObject-index-signature Finding in docs/shared-contract-progress.md.
type WorkItem = {
  id: number;
  work_id: number;
  filling_type: string | null;
  filling_depth: string | null;
  canals_no: number | null;
  working_length: string | null;
  implant_length: number | null;
  implant_diameter: number | null;
  implant_manufacturer_id: number | null;
  ImplantManufacturerName: string | null;
  material: string | null;
  lab_name: string | null;
  item_cost: number | null;
  start_date: string | null;
  completed_date: string | null;
  note: string | null;
  Teeth: string | null;
  TeethIds: number[];
};

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

interface WorkItemData {
  work_id: number;
  filling_type?: string | null;
  filling_depth?: string | null;
  canals_no?: number | null;
  working_length?: string | null;
  implant_length?: number | null;
  implant_diameter?: number | null;
  implant_manufacturer_id?: number | null;
  material?: string | null;
  lab_name?: string | null;
  item_cost?: number | null;
  start_date?: string | null;
  completed_date?: string | null;
  note?: string | null;
  TeethIds?: number[];
}

type work_type = {
  id: number;
  work_type: string;
};

type Keyword = {
  id: number;
  key_word: string;
};

type tooth_number = {
  id: number;
  tooth_code: string;
  tooth_name: string;
  quadrant: number;
  tooth_number?: number;
  is_permanent: boolean;
  sort_order?: number;
};

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

interface ImplantManufacturer {
  id: number;
  name: string;
}

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
    .execute() as Promise<Work[]>;
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

export async function getWorkDetailsList(workId: number): Promise<WorkItem[]> {
  const db = getKysely();
  const results = await db
    .selectFrom('work_items as wi')
    .leftJoin('work_item_teeth as wit', 'wit.work_item_id', 'wi.id')
    .leftJoin('tooth_numbers as tn', 'tn.id', 'wit.tooth_id')
    .leftJoin('implant_manufacturers as im', 'im.id', 'wi.implant_manufacturer_id')
    .where('wi.work_id', '=', workId)
    .select((eb) => [
      'wi.id',
      'wi.work_id',
      'wi.filling_type',
      'wi.filling_depth',
      'wi.canals_no',
      'wi.working_length',
      eb.ref('wi.implant_length').$castTo<number>().as('implant_length'),
      eb.ref('wi.implant_diameter').$castTo<number>().as('implant_diameter'),
      'wi.implant_manufacturer_id',
      'im.manufacturer_name as ImplantManufacturerName',
      'wi.material',
      'wi.lab_name',
      'wi.item_cost',
      'wi.start_date',
      'wi.completed_date',
      'wi.note',
      sql<string | null>`string_agg(${eb.ref('tn.tooth_code')}, ', ')`.as('Teeth'),
      sql<string | null>`string_agg(cast(${eb.ref('tn.id')} as varchar), ',')`.as('TeethIds'),
    ])
    .groupBy([
      'wi.id',
      'wi.work_id',
      'wi.filling_type',
      'wi.filling_depth',
      'wi.canals_no',
      'wi.working_length',
      'wi.implant_length',
      'wi.implant_diameter',
      'wi.implant_manufacturer_id',
      'im.manufacturer_name',
      'wi.material',
      'wi.lab_name',
      'wi.item_cost',
      'wi.start_date',
      'wi.completed_date',
      'wi.note',
    ])
    .orderBy('wi.id')
    .execute();

  // Convert TeethIds string to array of integers
  return results.map((item) => ({
    ...item,
    TeethIds: item.TeethIds ? item.TeethIds.split(',').map((id) => parseInt(id)) : [],
  })) as WorkItem[];
}

export async function addWorkDetail(workDetailData: WorkItemData): Promise<{ id: number } | null> {
  // One transaction: the item insert + its teeth write commit together, so a failed
  // teeth insert can't leave a half-written item behind.
  return withPgTransaction(async (trx) => {
    const inserted = await trx
      .insertInto('work_items')
      .values({
        work_id: workDetailData.work_id,
        filling_type: workDetailData.filling_type || null,
        filling_depth: workDetailData.filling_depth || null,
        canals_no: workDetailData.canals_no || null,
        working_length: workDetailData.working_length || null,
        implant_length: numericOrNull(workDetailData.implant_length),
        implant_diameter: numericOrNull(workDetailData.implant_diameter),
        implant_manufacturer_id: workDetailData.implant_manufacturer_id || null,
        material: workDetailData.material || null,
        lab_name: workDetailData.lab_name || null,
        item_cost: workDetailData.item_cost || null,
        start_date: (workDetailData.start_date as string | null) || null,
        completed_date: (workDetailData.completed_date as string | null) || null,
        note: workDetailData.note || null,
      })
      .returning('id')
      .executeTakeFirst();

    const result = inserted ? { id: inserted.id } : null;

    // If teeth are provided, add them to junction table (same trx → atomic with the insert)
    if (result && result.id && workDetailData.TeethIds && workDetailData.TeethIds.length > 0) {
      await setWorkItemTeeth(result.id, workDetailData.TeethIds, trx);
    }

    return result;
  });
}

export async function updateWorkDetail(
  detailId: number,
  workDetailData: Omit<WorkItemData, 'work_id'>
): Promise<{ success: boolean; rowCount: number }> {
  // One transaction: the item update + its teeth replacement commit together, so a
  // failed teeth insert can't strip the item's teeth with no rollback.
  return withPgTransaction(async (trx) => {
    const updateResult = await trx
      .updateTable('work_items')
      .set({
        filling_type: workDetailData.filling_type || null,
        filling_depth: workDetailData.filling_depth || null,
        canals_no: workDetailData.canals_no || null,
        working_length: workDetailData.working_length || null,
        implant_length: numericOrNull(workDetailData.implant_length),
        implant_diameter: numericOrNull(workDetailData.implant_diameter),
        implant_manufacturer_id: workDetailData.implant_manufacturer_id || null,
        material: workDetailData.material || null,
        lab_name: workDetailData.lab_name || null,
        item_cost: workDetailData.item_cost || null,
        start_date: (workDetailData.start_date as string | null) || null,
        completed_date: (workDetailData.completed_date as string | null) || null,
        note: workDetailData.note || null,
      })
      .where('id', '=', detailId)
      .executeTakeFirst();

    const result = {
      success: true,
      rowCount: Number(updateResult.numUpdatedRows),
    };

    // If teeth are provided, update the junction table (same trx → atomic with the update)
    if (workDetailData.TeethIds !== undefined) {
      await setWorkItemTeeth(detailId, workDetailData.TeethIds || [], trx);
    }

    return result;
  });
}

export async function deleteWorkDetail(
  detailId: number
): Promise<{ success: boolean; rowCount: number }> {
  const db = getKysely();
  const result = await db
    .deleteFrom('work_items')
    .where('id', '=', detailId)
    .executeTakeFirst();

  return { success: true, rowCount: Number(result.numDeletedRows) };
}

export async function addWork(workData: WorkData): Promise<{ work_id: number } | null> {
  const status = workData.status || WORK_STATUS.ACTIVE;

  const db = getKysely();
  const inserted = await db
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

  return inserted ? { work_id: inserted.work_id } : null;
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

  return withPgTransaction(async (trx) => {
    const result = await trx
      .updateTable('works')
      .set(updateValues as never)
      .where('work_id', '=', workId)
      .executeTakeFirst();

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

    return { success: true, rowCount: Number(result.numUpdatedRows) };
  });
}

export async function addWorkWithInvoice(
  workData: WorkData
): Promise<{ workId: number; invoiceId: number }> {
  const today = toDateOnly(new Date());
  const totalRequired = numOrNull(workData.total_required);
  const usdReceived =
    workData.currency === 'USD' || workData.currency === 'EUR' ? totalRequired : 0;
  const iqdReceived = workData.currency === 'IQD' ? totalRequired : 0;

  // Atomic work + invoice insert (the original ran one BEGIN/COMMIT TRANSACTION batch).
  // status is hard-coded to 2 (Finished) here, matching the original VALUES list.
  return getKysely()
    .transaction()
    .execute(async (trx) => {
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

      const invoice = await trx
        .insertInto('invoices')
        .values({
          work_id: work.work_id,
          amount_paid: totalRequired ?? 0,
          date_of_payment: today,
          usd_received: usdReceived ?? 0,
          iqd_received: iqdReceived ?? 0,
          change: null,
        })
        .returning('invoice_id')
        .executeTakeFirstOrThrow();

      return { workId: work.work_id, invoiceId: invoice.invoice_id };
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

  // If no dependencies, proceed with deletion
  const result = await db.deleteFrom('works').where('work_id', '=', workId).executeTakeFirst();

  return {
    canDelete: true,
    success: true,
    rowCount: Number(result.numDeletedRows),
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

export async function getWorkTypes(): Promise<work_type[]> {
  const db = getKysely();
  return db
    .selectFrom('work_types')
    .select(['id', 'work_type'])
    .orderBy('work_type')
    .execute() as Promise<work_type[]>;
}

export async function getWorkKeywords(): Promise<Keyword[]> {
  const db = getKysely();
  return db
    .selectFrom('keywords')
    .select(['id', 'key_word'])
    .orderBy('key_word')
    .execute() as Promise<Keyword[]>;
}

// ===== TOOTH NUMBER FUNCTIONS =====

export async function getToothNumbers(
  includePermanent = true,
  includeDeciduous = true
): Promise<tooth_number[]> {
  const db = getKysely();
  let q = db
    .selectFrom('tooth_numbers')
    .select((eb) => [
      'id',
      'tooth_code',
      'tooth_name',
      eb.ref('quadrant').$castTo<number>().as('quadrant'),
      eb.ref('tooth_number').$castTo<number>().as('tooth_number'),
      'is_permanent',
      'sort_order',
    ]);

  if (includePermanent && !includeDeciduous) {
    q = q.where('is_permanent', '=', true);
  } else if (!includePermanent && includeDeciduous) {
    q = q.where('is_permanent', '=', false);
  }

  return q.orderBy('sort_order').execute() as Promise<tooth_number[]>;
}

/**
 * Replace a work item's tooth associations (DELETE existing + INSERT new).
 *
 * The DELETE+INSERT must be atomic: if the INSERT fails (e.g. a bad tooth_id trips
 * FK_WorkItemTeeth_Tooth, or a connection blip) after the DELETE has committed, the
 * item would be left with its teeth permanently stripped and no rollback. When a
 * caller's transaction is supplied (`executor`) we reuse it so the item write and the
 * teeth write commit together; otherwise we open our own transaction for the pair.
 */
export async function setWorkItemTeeth(
  workItemId: number,
  teethIds: number[],
  executor?: Kysely<Database>
): Promise<{ success: boolean; count: number }> {
  if (executor) return replaceWorkItemTeeth(executor, workItemId, teethIds);
  return withPgTransaction((trx) => replaceWorkItemTeeth(trx, workItemId, teethIds));
}

async function replaceWorkItemTeeth(
  db: Kysely<Database>,
  workItemId: number,
  teethIds: number[]
): Promise<{ success: boolean; count: number }> {
  // First, delete existing teeth for this work item
  await db.deleteFrom('work_item_teeth').where('work_item_id', '=', workItemId).execute();

  // If no teeth to add, return early
  if (!teethIds || teethIds.length === 0) {
    return { success: true, count: 0 };
  }

  // Insert new teeth
  await db
    .insertInto('work_item_teeth')
    .values(teethIds.map((toothId) => ({ work_item_id: workItemId, tooth_id: toothId })))
    .execute();

  return { success: true, count: teethIds.length };
}

export async function getImplantManufacturers(): Promise<ImplantManufacturer[]> {
  const db = getKysely();
  return db
    .selectFrom('implant_manufacturers')
    .select(['id as id', 'manufacturer_name as name'])
    .orderBy('manufacturer_name')
    .execute() as Promise<ImplantManufacturer[]>;
}

// ===== WORK TRANSFER FUNCTIONS =====

/**
 * Related record counts for work transfer preview
 */
// `type` (not interface) — feeds a looseObject `sendData` response (transfer-preview);
// imported only as a type by WorkService + re-exported, so the flip is safe.
export type WorkRelatedCounts = {
  visits: number;
  invoices: number;
  diagnoses: number;
  workItems: number;
  alignerSets: number;
  alignerBatches: number;
  wires: number;
  implants: number;
  screws: number;
};

/**
 * Work transfer result
 */
// `type` (not interface) — feeds a looseObject `sendData` response (transfer).
export type TransferWorkResult = {
  success: boolean;
  workId: number;
  sourcePatientId: number;
  targetPatientId: number;
  relatedCounts: WorkRelatedCounts;
};

/**
 * Get counts of all related records for a work
 * Used to show what will be transferred in the preview
 */
export async function getWorkRelatedCounts(workId: number): Promise<WorkRelatedCounts> {
  const db = getKysely();
  const row = await db
    .selectNoFrom((eb) => [
      eb
        .selectFrom('visits')
        .select(eb.fn.countAll<number>().as('c'))
        .where('work_id', '=', workId)
        .as('visits'),
      eb
        .selectFrom('invoices')
        .select(eb.fn.countAll<number>().as('c'))
        .where('work_id', '=', workId)
        .as('invoices'),
      eb
        .selectFrom('diagnoses')
        .select(eb.fn.countAll<number>().as('c'))
        .where('work_id', '=', workId)
        .as('diagnoses'),
      eb
        .selectFrom('work_items')
        .select(eb.fn.countAll<number>().as('c'))
        .where('work_id', '=', workId)
        .as('workItems'),
      eb
        .selectFrom('aligner_sets')
        .select(eb.fn.countAll<number>().as('c'))
        .where('work_id', '=', workId)
        .as('alignerSets'),
      eb
        .selectFrom('aligner_batches as ab')
        .innerJoin('aligner_sets as s', 's.aligner_set_id', 'ab.aligner_set_id')
        .select(eb.fn.countAll<number>().as('c'))
        .where('s.work_id', '=', workId)
        .as('alignerBatches'),
      // Distinct upper + lower wire ids referenced by this work's visits.
      sql<number>`(
        SELECT COUNT(DISTINCT "upper_wire_id") + COUNT(DISTINCT "lower_wire_id")
        FROM "visits"
        WHERE "work_id" = ${workId}
          AND ("upper_wire_id" IS NOT NULL OR "lower_wire_id" IS NOT NULL)
      )`.as('wires'),
      eb
        .selectFrom('implants')
        .select(eb.fn.countAll<number>().as('c'))
        .where('work_id', '=', workId)
        .as('implants'),
      eb
        .selectFrom('screws')
        .select(eb.fn.countAll<number>().as('c'))
        .where('work_id', '=', workId)
        .as('screws'),
    ])
    .executeTakeFirstOrThrow();

  return {
    visits: Number(row.visits),
    invoices: Number(row.invoices),
    diagnoses: Number(row.diagnoses),
    workItems: Number(row.workItems),
    alignerSets: Number(row.alignerSets),
    alignerBatches: Number(row.alignerBatches),
    wires: Number(row.wires),
    implants: Number(row.implants),
    screws: Number(row.screws),
  };
}

/**
 * Transfer a work to a new patient
 * All related records (visits, invoices, wires, etc.) automatically follow
 * because they link via work_id, not person_id
 */
export async function transferWork(
  workId: number,
  targetPatientId: number
): Promise<TransferWorkResult> {
  // Get source patient id and related counts before transfer
  const work = await getWorkById(workId);
  if (!work) {
    throw new Error(`Work ${workId} not found`);
  }

  const relatedCounts = await getWorkRelatedCounts(workId);
  const sourcePatientId = work.person_id;

  // Execute the transfer - simple UPDATE since all related tables link via work_id
  await withPgTransaction(async (trx) => {
    await trx
      .updateTable('works')
      .set({ person_id: targetPatientId })
      .where('work_id', '=', workId)
      .execute();

  });

  return {
    success: true,
    workId,
    sourcePatientId,
    targetPatientId,
    relatedCounts,
  };
}
