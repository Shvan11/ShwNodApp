/**
 * Work-related database queries
 *
 * Migration Phase 4: translated to typed Kysely (PostgreSQL). Runs against the pg
 * pool regardless of DB_DRIVER — the positional `ColumnValue[]` mappers are gone and
 * the bodies return plain objects.
 *
 * Notes for this module:
 *  - Money/amount aggregates (`SUM(tblInvoice.Amountpaid)`) come back from PG as a
 *    `numeric`; the centralized pg parser (kysely.ts) returns a JS number, so the
 *    aggregate is coalesced and typed `number`.
 *  - The work-table date columns `StartDate`/`DebondDate`/`FPhotoDate`/`IPhotoDate`/
 *    `NotesDate`/`DiscountDate` (and `tblWorkItems.StartDate`/`CompletedDate`) are PG
 *    `date` columns, so the parser yields `'YYYY-MM-DD'` strings at runtime (mssql
 *    returned `Date`). `AdditionDate` is a `timestamp` and still returns a `Date`.
 *    Declared return interfaces are preserved (callers unchanged) — see FLAGS.
 */
import { sql } from 'kysely';
import { getKysely, withPgTransaction } from '../kysely.js';
import { enqueueWorkIfAligner } from '../../sync/sync-queue.js';
import { toDateOnly } from '../../../utils/date.js';

/**
 * Work Status Constants
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

// Type definitions
interface Work {
  workid: number;
  PersonID: number;
  TotalRequired: number | null;
  Currency: string | null;
  Typeofwork: number | null;
  Notes: string | null;
  Status: number;
  AdditionDate: Date | null;
  StartDate: Date | null;
  DebondDate: Date | null;
  FPhotoDate: Date | null;
  IPhotoDate: Date | null;
  EstimatedDuration: number | null;
  DrID: number | null;
  NotesDate: Date | null;
  KeyWordID1: number | null;
  KeyWordID2: number | null;
  KeywordID3: number | null;
  KeywordID4: number | null;
  KeywordID5: number | null;
  Discount: number | null;
  DiscountDate: Date | null;
  DiscountReason: string | null;
  DoctorName: string | null;
  TypeName: string | null;
  StatusName: string | null;
  Keyword1: string | null;
  Keyword2: string | null;
  Keyword3: string | null;
  Keyword4: string | null;
  Keyword5: string | null;
  WorkStatus: string;
  TotalPaid: number;
}

interface WorkDetails extends Work {
  PatientName: string;
}

interface WorkItem {
  ID: number;
  WorkID: number;
  FillingType: string | null;
  FillingDepth: string | null;
  CanalsNo: number | null;
  WorkingLength: string | null;
  ImplantLength: number | null;
  ImplantDiameter: number | null;
  ImplantManufacturerID: number | null;
  ImplantManufacturerName: string | null;
  Material: string | null;
  LabName: string | null;
  ItemCost: number | null;
  StartDate: Date | null;
  CompletedDate: Date | null;
  Note: string | null;
  Teeth: string | null;
  TeethIds: number[];
}

interface WorkData {
  PersonID: number;
  TotalRequired?: number | null;
  Currency?: string | null;
  Typeofwork?: number | null;
  Notes?: string | null;
  Status?: WorkStatusType;
  StartDate?: Date | string | null;
  DebondDate?: Date | string | null;
  FPhotoDate?: Date | string | null;
  IPhotoDate?: Date | string | null;
  EstimatedDuration?: number | null;
  DrID: number;
  NotesDate?: Date | string | null;
  KeyWordID1?: number | null;
  KeyWordID2?: number | null;
  KeywordID3?: number | null;
  KeywordID4?: number | null;
  KeywordID5?: number | null;
  Discount?: number | null;
  DiscountDate?: Date | string | null;
  DiscountReason?: string | null;
}

interface WorkItemData {
  WorkID: number;
  FillingType?: string | null;
  FillingDepth?: string | null;
  CanalsNo?: number | null;
  WorkingLength?: string | null;
  ImplantLength?: number | null;
  ImplantDiameter?: number | null;
  ImplantManufacturerID?: number | null;
  Material?: string | null;
  LabName?: string | null;
  ItemCost?: number | null;
  StartDate?: Date | string | null;
  CompletedDate?: Date | string | null;
  Note?: string | null;
  TeethIds?: number[];
}

interface WorkType {
  ID: number;
  WorkType: string;
}

interface Keyword {
  ID: number;
  KeyWord: string;
}

interface ToothNumber {
  ID: number;
  ToothCode: string;
  ToothName: string;
  Quadrant: number;
  ToothNumber?: number;
  IsPermanent: boolean;
  SortOrder?: number;
}

interface DependencyCheck {
  InvoiceCount: number;
  VisitCount: number;
  ItemCount: number;
  DiagnosisCount: number;
  ImplantCount: number;
  ScrewCount: number;
}

interface ValidationResult {
  valid: boolean;
  error?: string;
  existingWork?: {
    workid: number;
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
    .selectFrom('tblwork as w')
    .leftJoin('tblEmployees as e', 'e.ID', 'w.DrID')
    .leftJoin('tblWorkType as wt', 'wt.ID', 'w.Typeofwork')
    .leftJoin('tblWorkStatus as ws', 'ws.StatusID', 'w.Status')
    .leftJoin('tblKeyWord as k1', 'k1.ID', 'w.KeyWordID1')
    .leftJoin('tblKeyWord as k2', 'k2.ID', 'w.KeyWordID2')
    .leftJoin('tblKeyWord as k3', 'k3.ID', 'w.KeywordID3')
    .leftJoin('tblKeyWord as k4', 'k4.ID', 'w.KeywordID4')
    .leftJoin('tblKeyWord as k5', 'k5.ID', 'w.KeywordID5')
    .leftJoin('tblInvoice as i', 'i.workid', 'w.workid')
    .where('w.PersonID', '=', personId)
    .select((eb) => [
      'w.workid',
      'w.PersonID',
      'w.TotalRequired',
      'w.Currency',
      'w.Typeofwork',
      'w.Notes',
      'w.Status',
      'w.AdditionDate',
      'w.StartDate',
      'w.DebondDate',
      'w.FPhotoDate',
      'w.IPhotoDate',
      'w.EstimatedDuration',
      'w.DrID',
      'w.NotesDate',
      'w.KeyWordID1',
      'w.KeyWordID2',
      'w.KeywordID3',
      'w.KeywordID4',
      'w.KeywordID5',
      'w.Discount',
      'w.DiscountDate',
      'w.DiscountReason',
      'e.employeeName as DoctorName',
      'wt.WorkType as TypeName',
      'ws.StatusName',
      'k1.KeyWord as Keyword1',
      'k2.KeyWord as Keyword2',
      'k3.KeyWord as Keyword3',
      'k4.KeyWord as Keyword4',
      'k5.KeyWord as Keyword5',
      sql<string>`CASE
        WHEN ${eb.ref('w.Status')} = 2 THEN 'Completed'
        WHEN ${eb.ref('w.Status')} = 3 THEN 'Discontinued'
        WHEN ${eb.ref('w.StartDate')} IS NOT NULL THEN 'In Progress'
        ELSE 'Planned'
      END`.as('WorkStatus'),
      eb.fn.coalesce(eb.fn.sum('i.Amountpaid'), sql<number>`0`).$castTo<number>().as('TotalPaid'),
    ])
    .groupBy([
      'w.workid',
      'w.PersonID',
      'w.TotalRequired',
      'w.Currency',
      'w.Typeofwork',
      'w.Notes',
      'w.Status',
      'w.AdditionDate',
      'w.StartDate',
      'w.DebondDate',
      'w.FPhotoDate',
      'w.IPhotoDate',
      'w.EstimatedDuration',
      'w.DrID',
      'w.NotesDate',
      'w.KeyWordID1',
      'w.KeyWordID2',
      'w.KeywordID3',
      'w.KeywordID4',
      'w.KeywordID5',
      'w.Discount',
      'w.DiscountDate',
      'w.DiscountReason',
      'e.employeeName',
      'wt.WorkType',
      'ws.StatusName',
      'k1.KeyWord',
      'k2.KeyWord',
      'k3.KeyWord',
      'k4.KeyWord',
      'k5.KeyWord',
    ])
    .orderBy('w.AdditionDate', 'desc')
    .execute() as Promise<Work[]>;
}

export async function getWorkDetails(workId: number): Promise<WorkDetails | null> {
  const db = getKysely();
  const row = await db
    .selectFrom('tblwork as w')
    .leftJoin('tblEmployees as e', 'e.ID', 'w.DrID')
    .leftJoin('tblWorkType as wt', 'wt.ID', 'w.Typeofwork')
    .leftJoin('tblWorkStatus as ws', 'ws.StatusID', 'w.Status')
    .leftJoin('tblKeyWord as k1', 'k1.ID', 'w.KeyWordID1')
    .leftJoin('tblKeyWord as k2', 'k2.ID', 'w.KeyWordID2')
    .leftJoin('tblKeyWord as k3', 'k3.ID', 'w.KeywordID3')
    .leftJoin('tblKeyWord as k4', 'k4.ID', 'w.KeywordID4')
    .leftJoin('tblKeyWord as k5', 'k5.ID', 'w.KeywordID5')
    .leftJoin('tblpatients as p', 'p.PersonID', 'w.PersonID')
    .leftJoin('tblInvoice as i', 'i.workid', 'w.workid')
    .where('w.workid', '=', workId)
    .select((eb) => [
      'w.workid',
      'w.PersonID',
      'w.TotalRequired',
      'w.Currency',
      'w.Typeofwork',
      'w.Notes',
      'w.Status',
      'w.AdditionDate',
      'w.StartDate',
      'w.DebondDate',
      'w.FPhotoDate',
      'w.IPhotoDate',
      'w.EstimatedDuration',
      'w.DrID',
      'w.NotesDate',
      'w.KeyWordID1',
      'w.KeyWordID2',
      'w.KeywordID3',
      'w.KeywordID4',
      'w.KeywordID5',
      'w.Discount',
      'w.DiscountDate',
      'w.DiscountReason',
      'e.employeeName as DoctorName',
      'wt.WorkType as TypeName',
      'ws.StatusName',
      'k1.KeyWord as Keyword1',
      'k2.KeyWord as Keyword2',
      'k3.KeyWord as Keyword3',
      'k4.KeyWord as Keyword4',
      'k5.KeyWord as Keyword5',
      'p.PatientName',
      eb.fn.coalesce(eb.fn.sum('i.Amountpaid'), sql<number>`0`).$castTo<number>().as('TotalPaid'),
    ])
    .groupBy([
      'w.workid',
      'w.PersonID',
      'w.TotalRequired',
      'w.Currency',
      'w.Typeofwork',
      'w.Notes',
      'w.Status',
      'w.AdditionDate',
      'w.StartDate',
      'w.DebondDate',
      'w.FPhotoDate',
      'w.IPhotoDate',
      'w.EstimatedDuration',
      'w.DrID',
      'w.NotesDate',
      'w.KeyWordID1',
      'w.KeyWordID2',
      'w.KeywordID3',
      'w.KeywordID4',
      'w.KeywordID5',
      'w.Discount',
      'w.DiscountDate',
      'w.DiscountReason',
      'e.employeeName',
      'wt.WorkType',
      'ws.StatusName',
      'k1.KeyWord',
      'k2.KeyWord',
      'k3.KeyWord',
      'k4.KeyWord',
      'k5.KeyWord',
      'p.PatientName',
    ])
    .executeTakeFirst();

  // WorkStatus is not selected by the original detail query — keep parity.
  return (row as WorkDetails | undefined) ?? null;
}

export async function getWorkDetailsList(workId: number): Promise<WorkItem[]> {
  const db = getKysely();
  const results = await db
    .selectFrom('tblWorkItems as wi')
    .leftJoin('tblWorkItemTeeth as wit', 'wit.WorkItemID', 'wi.ID')
    .leftJoin('tblToothNumber as tn', 'tn.ID', 'wit.ToothID')
    .leftJoin('tblImplantManufacturer as im', 'im.ID', 'wi.ImplantManufacturerID')
    .where('wi.WorkID', '=', workId)
    .select((eb) => [
      'wi.ID',
      'wi.WorkID',
      'wi.FillingType',
      'wi.FillingDepth',
      'wi.CanalsNo',
      'wi.WorkingLength',
      eb.ref('wi.ImplantLength').$castTo<number>().as('ImplantLength'),
      eb.ref('wi.ImplantDiameter').$castTo<number>().as('ImplantDiameter'),
      'wi.ImplantManufacturerID',
      'im.ManufacturerName as ImplantManufacturerName',
      'wi.Material',
      'wi.LabName',
      'wi.ItemCost',
      'wi.StartDate',
      'wi.CompletedDate',
      'wi.Note',
      sql<string | null>`string_agg(${eb.ref('tn.ToothCode')}, ', ')`.as('Teeth'),
      sql<string | null>`string_agg(cast(${eb.ref('tn.ID')} as varchar), ',')`.as('TeethIds'),
    ])
    .groupBy([
      'wi.ID',
      'wi.WorkID',
      'wi.FillingType',
      'wi.FillingDepth',
      'wi.CanalsNo',
      'wi.WorkingLength',
      'wi.ImplantLength',
      'wi.ImplantDiameter',
      'wi.ImplantManufacturerID',
      'im.ManufacturerName',
      'wi.Material',
      'wi.LabName',
      'wi.ItemCost',
      'wi.StartDate',
      'wi.CompletedDate',
      'wi.Note',
    ])
    .orderBy('wi.ID')
    .execute();

  // Convert TeethIds string to array of integers
  return results.map((item) => ({
    ...item,
    TeethIds: item.TeethIds ? item.TeethIds.split(',').map((id) => parseInt(id)) : [],
  })) as WorkItem[];
}

// Alias for new naming convention
export const getWorkItems = getWorkDetailsList;

export async function addWorkDetail(workDetailData: WorkItemData): Promise<{ ID: number } | null> {
  const db = getKysely();
  const inserted = await db
    .insertInto('tblWorkItems')
    .values({
      WorkID: workDetailData.WorkID,
      FillingType: workDetailData.FillingType || null,
      FillingDepth: workDetailData.FillingDepth || null,
      CanalsNo: workDetailData.CanalsNo || null,
      WorkingLength: workDetailData.WorkingLength || null,
      ImplantLength: workDetailData.ImplantLength ?? null,
      ImplantDiameter: workDetailData.ImplantDiameter ?? null,
      ImplantManufacturerID: workDetailData.ImplantManufacturerID || null,
      Material: workDetailData.Material || null,
      LabName: workDetailData.LabName || null,
      ItemCost: workDetailData.ItemCost || null,
      StartDate: (workDetailData.StartDate as Date | string | null) || null,
      CompletedDate: (workDetailData.CompletedDate as Date | string | null) || null,
      Note: workDetailData.Note || null,
    })
    .returning('ID')
    .executeTakeFirst();

  const result = inserted ? { ID: inserted.ID } : null;

  // If teeth are provided, add them to junction table
  if (result && result.ID && workDetailData.TeethIds && workDetailData.TeethIds.length > 0) {
    await setWorkItemTeeth(result.ID, workDetailData.TeethIds);
  }

  return result;
}

// Alias for new naming convention
export const addWorkItem = addWorkDetail;

export async function updateWorkDetail(
  detailId: number,
  workDetailData: Omit<WorkItemData, 'WorkID'>
): Promise<{ success: boolean; rowCount: number }> {
  const db = getKysely();
  const updateResult = await db
    .updateTable('tblWorkItems')
    .set({
      FillingType: workDetailData.FillingType || null,
      FillingDepth: workDetailData.FillingDepth || null,
      CanalsNo: workDetailData.CanalsNo || null,
      WorkingLength: workDetailData.WorkingLength || null,
      ImplantLength: workDetailData.ImplantLength ?? null,
      ImplantDiameter: workDetailData.ImplantDiameter ?? null,
      ImplantManufacturerID: workDetailData.ImplantManufacturerID || null,
      Material: workDetailData.Material || null,
      LabName: workDetailData.LabName || null,
      ItemCost: workDetailData.ItemCost || null,
      StartDate: (workDetailData.StartDate as Date | string | null) || null,
      CompletedDate: (workDetailData.CompletedDate as Date | string | null) || null,
      Note: workDetailData.Note || null,
    })
    .where('ID', '=', detailId)
    .executeTakeFirst();

  const result = {
    success: true,
    rowCount: Number(updateResult.numUpdatedRows),
  };

  // If teeth are provided, update the junction table
  if (workDetailData.TeethIds !== undefined) {
    await setWorkItemTeeth(detailId, workDetailData.TeethIds || []);
  }

  return result;
}

// Alias for new naming convention
export const updateWorkItem = updateWorkDetail;

export async function deleteWorkDetail(
  detailId: number
): Promise<{ success: boolean; rowCount: number }> {
  const db = getKysely();
  const result = await db
    .deleteFrom('tblWorkItems')
    .where('ID', '=', detailId)
    .executeTakeFirst();

  return { success: true, rowCount: Number(result.numDeletedRows) };
}

// Alias for new naming convention
export const deleteWorkItem = deleteWorkDetail;

export async function addWork(workData: WorkData): Promise<{ workid: number } | null> {
  const status = workData.Status || WORK_STATUS.ACTIVE;

  const db = getKysely();
  const inserted = await db
    .insertInto('tblwork')
    .values({
      PersonID: workData.PersonID,
      // TotalRequired / Typeofwork are NOT NULL in the PG schema; the WorkData type
      // allows them optional, so keep the legacy `?? null` runtime (PG enforces NOT NULL).
      TotalRequired: (workData.TotalRequired ?? null) as number,
      Currency: workData.Currency || null,
      Typeofwork: (workData.Typeofwork ?? null) as number,
      Notes: workData.Notes || null,
      Status: status,
      StartDate: (workData.StartDate as Date | string | null) || null,
      DebondDate: (workData.DebondDate as Date | string | null) || null,
      FPhotoDate: (workData.FPhotoDate as Date | string | null) || null,
      IPhotoDate: (workData.IPhotoDate as Date | string | null) || null,
      EstimatedDuration: workData.EstimatedDuration ?? null,
      DrID: workData.DrID,
      NotesDate: (workData.NotesDate as Date | string | null) || null,
      KeyWordID1: workData.KeyWordID1 || null,
      KeyWordID2: workData.KeyWordID2 || null,
      KeywordID3: workData.KeywordID3 || null,
      KeywordID4: workData.KeywordID4 || null,
      KeywordID5: workData.KeywordID5 || null,
    })
    .returning('workid')
    .executeTakeFirst();

  return inserted ? { workid: inserted.workid } : null;
}

export async function updateWork(
  workId: number,
  workData: Partial<WorkData>
): Promise<{ success: boolean; rowCount: number }> {
  // Build dynamic UPDATE - only update fields that are provided.
  const updateValues: Record<string, unknown> = {};

  const fieldValues: Record<string, unknown> = {
    TotalRequired: workData.TotalRequired ?? null,
    Currency: workData.Currency || null,
    Typeofwork: workData.Typeofwork ?? null,
    Notes: workData.Notes || null,
    Status: workData.Status ?? WORK_STATUS.ACTIVE,
    StartDate: (workData.StartDate as Date | string | null) || null,
    DebondDate: (workData.DebondDate as Date | string | null) || null,
    FPhotoDate: (workData.FPhotoDate as Date | string | null) || null,
    IPhotoDate: (workData.IPhotoDate as Date | string | null) || null,
    EstimatedDuration: workData.EstimatedDuration || null,
    DrID: workData.DrID,
    NotesDate: (workData.NotesDate as Date | string | null) || null,
    KeyWordID1: workData.KeyWordID1 || null,
    KeyWordID2: workData.KeyWordID2 || null,
    KeywordID3: workData.KeywordID3 || null,
    KeywordID4: workData.KeywordID4 || null,
    KeywordID5: workData.KeywordID5 || null,
    Discount: workData.Discount ?? null,
    DiscountDate: (workData.DiscountDate as Date | string | null) || null,
    DiscountReason: workData.DiscountReason ?? null,
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
      .updateTable('tblwork')
      .set(updateValues as never)
      .where('workid', '=', workId)
      .executeTakeFirst();

    await enqueueWorkIfAligner(trx, workId, 'UPDATE');
    return { success: true, rowCount: Number(result.numUpdatedRows) };
  });
}

export async function finishWork(workId: number): Promise<{ success: boolean; rowCount: number }> {
  return withPgTransaction(async (trx) => {
    const result = await trx
      .updateTable('tblwork')
      .set({ Status: WORK_STATUS.FINISHED })
      .where('workid', '=', workId)
      .executeTakeFirst();

    await enqueueWorkIfAligner(trx, workId, 'UPDATE');
    return { success: true, rowCount: Number(result.numUpdatedRows) };
  });
}

export async function discontinueWork(
  workId: number
): Promise<{ success: boolean; rowCount: number }> {
  return withPgTransaction(async (trx) => {
    const result = await trx
      .updateTable('tblwork')
      .set({ Status: WORK_STATUS.DISCONTINUED })
      .where('workid', '=', workId)
      .executeTakeFirst();

    await enqueueWorkIfAligner(trx, workId, 'UPDATE');
    return { success: true, rowCount: Number(result.numUpdatedRows) };
  });
}

export async function reactivateWork(
  workId: number
): Promise<{ success: boolean; rowCount: number }> {
  return withPgTransaction(async (trx) => {
    const result = await trx
      .updateTable('tblwork')
      .set({ Status: WORK_STATUS.ACTIVE })
      .where('workid', '=', workId)
      .executeTakeFirst();

    await enqueueWorkIfAligner(trx, workId, 'UPDATE');
    return { success: true, rowCount: Number(result.numUpdatedRows) };
  });
}

export async function addWorkWithInvoice(
  workData: WorkData
): Promise<{ workId: number; invoiceId: number }> {
  const today = toDateOnly(new Date());
  const usdReceived =
    workData.Currency === 'USD' || workData.Currency === 'EUR' ? workData.TotalRequired : 0;
  const iqdReceived = workData.Currency === 'IQD' ? workData.TotalRequired : 0;

  // Atomic work + invoice insert (the original ran one BEGIN/COMMIT TRANSACTION batch).
  // Status is hard-coded to 2 (Finished) here, matching the original VALUES list.
  return getKysely()
    .transaction()
    .execute(async (trx) => {
      const work = await trx
        .insertInto('tblwork')
        .values({
          PersonID: workData.PersonID,
          TotalRequired: (workData.TotalRequired ?? null) as number,
          Currency: workData.Currency || null,
          Typeofwork: (workData.Typeofwork ?? null) as number,
          Notes: workData.Notes || null,
          Status: WORK_STATUS.FINISHED,
          StartDate: (workData.StartDate as Date | string | null) || null,
          DebondDate: (workData.DebondDate as Date | string | null) || null,
          FPhotoDate: (workData.FPhotoDate as Date | string | null) || null,
          IPhotoDate: (workData.IPhotoDate as Date | string | null) || null,
          EstimatedDuration: workData.EstimatedDuration ?? null,
          DrID: workData.DrID,
          NotesDate: (workData.NotesDate as Date | string | null) || null,
          KeyWordID1: workData.KeyWordID1 || null,
          KeyWordID2: workData.KeyWordID2 || null,
          KeywordID3: workData.KeywordID3 || null,
          KeywordID4: workData.KeywordID4 || null,
          KeywordID5: workData.KeywordID5 || null,
        })
        .returning('workid')
        .executeTakeFirstOrThrow();

      const invoice = await trx
        .insertInto('tblInvoice')
        .values({
          workid: work.workid,
          Amountpaid: workData.TotalRequired ?? 0,
          Dateofpayment: today,
          USDReceived: usdReceived ?? 0,
          IQDReceived: iqdReceived ?? 0,
          Change: null,
        })
        .returning('invoiceID')
        .executeTakeFirstOrThrow();

      return { workId: work.workid, invoiceId: invoice.invoiceID };
    });
}

export async function deleteWork(
  workId: number
): Promise<{ canDelete: boolean; success?: boolean; rowCount?: number; dependencies?: DependencyCheck }> {
  const db = getKysely();
  const dependencyCheck = await db
    .selectNoFrom((eb) => [
      eb
        .selectFrom('tblInvoice')
        .select(eb.fn.countAll<number>().as('c'))
        .where('workid', '=', workId)
        .as('InvoiceCount'),
      eb
        .selectFrom('tblvisits')
        .select(eb.fn.countAll<number>().as('c'))
        .where('WorkID', '=', workId)
        .as('VisitCount'),
      eb
        .selectFrom('tblWorkItems')
        .select(eb.fn.countAll<number>().as('c'))
        .where('WorkID', '=', workId)
        .as('ItemCount'),
      eb
        .selectFrom('tblDiagnosis')
        .select(eb.fn.countAll<number>().as('c'))
        .where('WorkID', '=', workId)
        .as('DiagnosisCount'),
      eb
        .selectFrom('tblImplant')
        .select(eb.fn.countAll<number>().as('c'))
        .where('WorkID', '=', workId)
        .as('ImplantCount'),
      eb
        .selectFrom('tblscrews')
        .select(eb.fn.countAll<number>().as('c'))
        .where('WorkID', '=', workId)
        .as('ScrewCount'),
    ])
    .executeTakeFirstOrThrow();

  const counts: DependencyCheck = {
    InvoiceCount: Number(dependencyCheck.InvoiceCount),
    VisitCount: Number(dependencyCheck.VisitCount),
    ItemCount: Number(dependencyCheck.ItemCount),
    DiagnosisCount: Number(dependencyCheck.DiagnosisCount),
    ImplantCount: Number(dependencyCheck.ImplantCount),
    ScrewCount: Number(dependencyCheck.ScrewCount),
  };

  // Return dependency information if any exist
  if (
    counts.InvoiceCount > 0 ||
    counts.VisitCount > 0 ||
    counts.ItemCount > 0 ||
    counts.DiagnosisCount > 0 ||
    counts.ImplantCount > 0 ||
    counts.ScrewCount > 0
  ) {
    return {
      canDelete: false,
      dependencies: counts,
    };
  }

  // If no dependencies, proceed with deletion
  const result = await db.deleteFrom('tblwork').where('workid', '=', workId).executeTakeFirst();

  return {
    canDelete: true,
    success: true,
    rowCount: Number(result.numDeletedRows),
  };
}

export async function getActiveWork(personId: number): Promise<Work | null> {
  const db = getKysely();
  const row = await db
    .selectFrom('tblwork as w')
    .leftJoin('tblEmployees as e', 'e.ID', 'w.DrID')
    .leftJoin('tblWorkType as wt', 'wt.ID', 'w.Typeofwork')
    .leftJoin('tblWorkStatus as ws', 'ws.StatusID', 'w.Status')
    .where('w.PersonID', '=', personId)
    .where('w.Status', '=', 1)
    .selectAll('w')
    .select([
      'e.employeeName as DoctorName',
      'wt.WorkType as TypeName',
      'ws.StatusName',
    ])
    .orderBy('w.AdditionDate', 'desc')
    .limit(1)
    .executeTakeFirst();

  return (row as Work | undefined) ?? null;
}

export async function getWorkById(workId: number): Promise<Work | null> {
  const db = getKysely();
  const row = await db
    .selectFrom('tblwork as w')
    .leftJoin('tblEmployees as e', 'e.ID', 'w.DrID')
    .leftJoin('tblWorkType as wt', 'wt.ID', 'w.Typeofwork')
    .leftJoin('tblWorkStatus as ws', 'ws.StatusID', 'w.Status')
    .where('w.workid', '=', workId)
    .selectAll('w')
    .select([
      'e.employeeName as DoctorName',
      'wt.WorkType as TypeName',
      'ws.StatusName',
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
    if (activeWork && activeWork.workid !== workId) {
      return {
        valid: false,
        error: 'Patient already has an active work',
        existingWork: {
          workid: activeWork.workid,
          type: activeWork.TypeName,
          doctor: activeWork.DoctorName,
        },
      };
    }
  }

  return { valid: true };
}

export async function getWorkTypes(): Promise<WorkType[]> {
  const db = getKysely();
  return db
    .selectFrom('tblWorkType')
    .select(['ID', 'WorkType'])
    .orderBy('WorkType')
    .execute() as Promise<WorkType[]>;
}

export async function getWorkKeywords(): Promise<Keyword[]> {
  const db = getKysely();
  return db
    .selectFrom('tblKeyWord')
    .select(['ID', 'KeyWord'])
    .orderBy('KeyWord')
    .execute() as Promise<Keyword[]>;
}

// ===== TOOTH NUMBER FUNCTIONS =====

export async function getToothNumbers(
  includePermanent = true,
  includeDeciduous = true
): Promise<ToothNumber[]> {
  const db = getKysely();
  let q = db
    .selectFrom('tblToothNumber')
    .select((eb) => [
      'ID',
      'ToothCode',
      'ToothName',
      eb.ref('Quadrant').$castTo<number>().as('Quadrant'),
      eb.ref('ToothNumber').$castTo<number>().as('ToothNumber'),
      'IsPermanent',
      'SortOrder',
    ]);

  if (includePermanent && !includeDeciduous) {
    q = q.where('IsPermanent', '=', true);
  } else if (!includePermanent && includeDeciduous) {
    q = q.where('IsPermanent', '=', false);
  }

  return q.orderBy('SortOrder').execute() as Promise<ToothNumber[]>;
}

export async function setWorkItemTeeth(
  workItemId: number,
  teethIds: number[]
): Promise<{ success: boolean; count: number }> {
  const db = getKysely();

  // First, delete existing teeth for this work item
  await db.deleteFrom('tblWorkItemTeeth').where('WorkItemID', '=', workItemId).execute();

  // If no teeth to add, return early
  if (!teethIds || teethIds.length === 0) {
    return { success: true, count: 0 };
  }

  // Insert new teeth
  await db
    .insertInto('tblWorkItemTeeth')
    .values(teethIds.map((toothId) => ({ WorkItemID: workItemId, ToothID: toothId })))
    .execute();

  return { success: true, count: teethIds.length };
}

export async function getWorkItemTeeth(workItemId: number): Promise<ToothNumber[]> {
  const db = getKysely();
  return db
    .selectFrom('tblWorkItemTeeth as wit')
    .innerJoin('tblToothNumber as tn', 'tn.ID', 'wit.ToothID')
    .where('wit.WorkItemID', '=', workItemId)
    .select((eb) => [
      'tn.ID',
      'tn.ToothCode',
      'tn.ToothName',
      eb.ref('tn.Quadrant').$castTo<number>().as('Quadrant'),
      'tn.IsPermanent',
    ])
    .orderBy('tn.SortOrder')
    .execute() as Promise<ToothNumber[]>;
}

export async function getImplantManufacturers(): Promise<ImplantManufacturer[]> {
  const db = getKysely();
  return db
    .selectFrom('tblImplantManufacturer')
    .select(['ID as id', 'ManufacturerName as name'])
    .orderBy('ManufacturerName')
    .execute() as Promise<ImplantManufacturer[]>;
}

// ===== WORK TRANSFER FUNCTIONS =====

/**
 * Related record counts for work transfer preview
 */
export interface WorkRelatedCounts {
  visits: number;
  invoices: number;
  diagnoses: number;
  workItems: number;
  alignerSets: number;
  alignerBatches: number;
  wires: number;
  implants: number;
  screws: number;
}

/**
 * Work transfer result
 */
export interface TransferWorkResult {
  success: boolean;
  workId: number;
  sourcePatientId: number;
  targetPatientId: number;
  relatedCounts: WorkRelatedCounts;
}

/**
 * Get counts of all related records for a work
 * Used to show what will be transferred in the preview
 */
export async function getWorkRelatedCounts(workId: number): Promise<WorkRelatedCounts> {
  const db = getKysely();
  const row = await db
    .selectNoFrom((eb) => [
      eb
        .selectFrom('tblvisits')
        .select(eb.fn.countAll<number>().as('c'))
        .where('WorkID', '=', workId)
        .as('visits'),
      eb
        .selectFrom('tblInvoice')
        .select(eb.fn.countAll<number>().as('c'))
        .where('workid', '=', workId)
        .as('invoices'),
      eb
        .selectFrom('tblDiagnosis')
        .select(eb.fn.countAll<number>().as('c'))
        .where('WorkID', '=', workId)
        .as('diagnoses'),
      eb
        .selectFrom('tblWorkItems')
        .select(eb.fn.countAll<number>().as('c'))
        .where('WorkID', '=', workId)
        .as('workItems'),
      eb
        .selectFrom('tblAlignerSets')
        .select(eb.fn.countAll<number>().as('c'))
        .where('WorkID', '=', workId)
        .as('alignerSets'),
      eb
        .selectFrom('tblAlignerBatches as ab')
        .innerJoin('tblAlignerSets as s', 's.AlignerSetID', 'ab.AlignerSetID')
        .select(eb.fn.countAll<number>().as('c'))
        .where('s.WorkID', '=', workId)
        .as('alignerBatches'),
      // Distinct upper + lower wire ids referenced by this work's visits.
      sql<number>`(
        SELECT COUNT(DISTINCT "UpperWireID") + COUNT(DISTINCT "LowerWireID")
        FROM "tblvisits"
        WHERE "WorkID" = ${workId}
          AND ("UpperWireID" IS NOT NULL OR "LowerWireID" IS NOT NULL)
      )`.as('wires'),
      eb
        .selectFrom('tblImplant')
        .select(eb.fn.countAll<number>().as('c'))
        .where('WorkID', '=', workId)
        .as('implants'),
      eb
        .selectFrom('tblscrews')
        .select(eb.fn.countAll<number>().as('c'))
        .where('WorkID', '=', workId)
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
 * because they link via WorkID, not PersonID
 */
export async function transferWork(
  workId: number,
  targetPatientId: number
): Promise<TransferWorkResult> {
  // Get source patient ID and related counts before transfer
  const work = await getWorkById(workId);
  if (!work) {
    throw new Error(`Work ${workId} not found`);
  }

  const relatedCounts = await getWorkRelatedCounts(workId);
  const sourcePatientId = work.PersonID;

  // Execute the transfer - simple UPDATE since all related tables link via WorkID
  await withPgTransaction(async (trx) => {
    await trx
      .updateTable('tblwork')
      .set({ PersonID: targetPatientId })
      .where('workid', '=', workId)
      .execute();

    // Work moved to a new owner → forward-sync the work (if aligner-tracked). The new
    // patient is synced lazily by the queue processor's related-record bootstrap.
    await enqueueWorkIfAligner(trx, workId, 'UPDATE');
  });

  return {
    success: true,
    workId,
    sourcePatientId,
    targetPatientId,
    relatedCounts,
  };
}
