/**
 * Work ITEM database queries — the `work_items` table, its `work_item_teeth`
 * junction and the `tooth_numbers` catalogue they reference.
 *
 * Split out of work-queries.ts (which owns the `works` row itself): a work item is
 * one line of treatment ON a work (a filling, a canal, an implant, a crown), and it
 * carries its own teeth. Nothing here reads or writes `works`.
 *
 * note: `work_items.start_date`/`completed_date` are PG `date` columns, so the
 * centralized parser yields `'YYYY-MM-DD'` strings at runtime.
 */
import { sql, type Kysely } from 'kysely';
import { getKysely, withPgTransaction, type Database } from '../kysely.js';

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
  lab_id: number | null;
  lab_name: string | null;
  shade_system: string | null;
  shade: string | null;
  item_cost: number | null;
  start_date: string | null;
  completed_date: string | null;
  note: string | null;
  Teeth: string | null;
  TeethIds: number[];
};

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
  lab_id?: number | null;
  shade_system?: string | null;
  shade?: string | null;
  item_cost?: number | null;
  start_date?: string | null;
  completed_date?: string | null;
  note?: string | null;
  TeethIds?: number[];
}

type tooth_number = {
  id: number;
  tooth_code: string;
  tooth_name: string;
  quadrant: 'UR' | 'UL' | 'LR' | 'LL';
  tooth_number: string;
  is_permanent: boolean;
  sort_order?: number;
};

export async function getWorkDetailsList(workId: number): Promise<WorkItem[]> {
  const db = getKysely();
  const results = await db
    .selectFrom('work_items as wi')
    .leftJoin('work_item_teeth as wit', 'wit.work_item_id', 'wi.id')
    .leftJoin('tooth_numbers as tn', 'tn.id', 'wit.tooth_id')
    .leftJoin('implant_manufacturers as im', 'im.id', 'wi.implant_manufacturer_id')
    .leftJoin('labs as l', 'l.id', 'wi.lab_id')
    .leftJoin('lab_cases as lc', 'lc.work_item_id', 'wi.id')
    .where('wi.work_id', '=', workId)
    .select((eb) => [
      'wi.id',
      'lc.id as lab_case_id',
      'lc.status as lab_status',
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
      'wi.lab_id',
      'l.lab_name as lab_name',
      'wi.shade_system',
      'wi.shade',
      'wi.item_cost',
      'wi.start_date',
      'wi.completed_date',
      'wi.note',
      sql<string | null>`string_agg(${eb.ref('tn.tooth_code')}, ', ')`.as('Teeth'),
      sql<string | null>`string_agg(cast(${eb.ref('tn.id')} as varchar), ',')`.as('TeethIds'),
    ])
    .groupBy([
      'wi.id',
      'lc.id',
      'lc.status',
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
      'wi.lab_id',
      'l.lab_name',
      'wi.shade_system',
      'wi.shade',
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
    TeethIds: item.TeethIds ? item.TeethIds.split(',').map((id) => parseInt(id, 10)) : [],
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
        lab_id: workDetailData.lab_id || null,
        shade_system: workDetailData.shade_system || null,
        shade: workDetailData.shade || null,
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
        lab_id: workDetailData.lab_id || null,
        shade_system: workDetailData.shade_system || null,
        shade: workDetailData.shade || null,
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
// ===== TOOTH NUMBER FUNCTIONS =====

export async function getToothNumbers(
  includePermanent = true,
  includeDeciduous = true
): Promise<tooth_number[]> {
  const db = getKysely();
  // quadrant / tooth_number are text columns ('UR'…'LL', '11'…); select them as
  // their real (string) types — the historical `$castTo<number>()` was a type-level
  // fiction (the runtime values are strings) that forced an `as unknown` at the read.
  //
  // `quadrant` is free-text in the schema but a closed 4-value vocabulary in the app
  // (work.contract.ts#teeth declares the enum, and the table holds exactly UR/UL/LR/LL).
  // Restricting the SELECT makes the narrowed type a guarantee rather than an assertion.
  let q = db
    .selectFrom('tooth_numbers')
    .where('quadrant', 'in', ['UR', 'UL', 'LR', 'LL'])
    .select((eb) => [
      'id',
      'tooth_code',
      'tooth_name',
      eb.ref('quadrant').$castTo<'UR' | 'UL' | 'LR' | 'LL'>().as('quadrant'),
      'tooth_number',
      'is_permanent',
      'sort_order',
    ]);

  if (includePermanent && !includeDeciduous) {
    q = q.where('is_permanent', '=', true);
  } else if (!includePermanent && includeDeciduous) {
    q = q.where('is_permanent', '=', false);
  }

  return q.orderBy('sort_order').execute();
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
async function setWorkItemTeeth(
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
