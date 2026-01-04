/**
 * Work-related database queries
 */
import { Connection, Request } from 'tedious';
import type { ColumnValue } from '../../../types/database.types.js';
import { executeQuery, executeStoredProcedure, TYPES, SqlParam } from '../index.js';
import ConnectionPool from '../ConnectionPool.js';

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

/**
 * Helper function to map columns to object
 */
function mapRowToObject<T>(columns: ColumnValue[]): T {
  const obj: Record<string, unknown> = {};
  columns.forEach((column) => {
    obj[column.metadata.colName] = column.value;
  });
  return obj as T;
}

export async function getWorksByPatient(personId: number): Promise<Work[]> {
  return executeQuery<Work>(
    `SELECT
      w.workid,
      w.PersonID,
      w.TotalRequired,
      w.Currency,
      w.Typeofwork,
      w.Notes,
      w.Status,
      w.AdditionDate,
      w.StartDate,
      w.DebondDate,
      w.FPhotoDate,
      w.IPhotoDate,
      w.EstimatedDuration,
      w.DrID,
      w.NotesDate,
      w.KeyWordID1,
      w.KeyWordID2,
      w.KeywordID3,
      w.KeywordID4,
      w.KeywordID5,
      e.employeeName as DoctorName,
      wt.WorkType as TypeName,
      ws.StatusName,
      k1.KeyWord as Keyword1,
      k2.KeyWord as Keyword2,
      k3.KeyWord as Keyword3,
      k4.KeyWord as Keyword4,
      k5.KeyWord as Keyword5,
      CASE
        WHEN w.Status = 2 THEN 'Completed'
        WHEN w.Status = 3 THEN 'Discontinued'
        WHEN w.StartDate IS NOT NULL THEN 'In Progress'
        ELSE 'Planned'
      END as WorkStatus,
      COALESCE(SUM(i.Amountpaid), 0) as TotalPaid
    FROM tblwork w
    LEFT JOIN tblEmployees e ON w.DrID = e.ID
    LEFT JOIN tblWorkType wt ON w.Typeofwork = wt.ID
    LEFT JOIN tblWorkStatus ws ON w.Status = ws.StatusID
    LEFT JOIN tblKeyWord k1 ON w.KeyWordID1 = k1.ID
    LEFT JOIN tblKeyWord k2 ON w.KeyWordID2 = k2.ID
    LEFT JOIN tblKeyWord k3 ON w.KeywordID3 = k3.ID
    LEFT JOIN tblKeyWord k4 ON w.KeywordID4 = k4.ID
    LEFT JOIN tblKeyWord k5 ON w.KeywordID5 = k5.ID
    LEFT JOIN tblInvoice i ON w.workid = i.workid
    WHERE w.PersonID = @PersonID
    GROUP BY w.workid, w.PersonID, w.TotalRequired, w.Currency, w.Typeofwork, w.Notes,
             w.Status, w.AdditionDate, w.StartDate, w.DebondDate, w.FPhotoDate,
             w.IPhotoDate, w.EstimatedDuration, w.DrID, w.NotesDate, w.KeyWordID1,
             w.KeyWordID2, w.KeywordID3, w.KeywordID4, w.KeywordID5,
             e.employeeName, wt.WorkType, ws.StatusName, k1.KeyWord, k2.KeyWord, k3.KeyWord, k4.KeyWord, k5.KeyWord
    ORDER BY w.AdditionDate DESC`,
    [['PersonID', TYPES.Int, personId]],
    mapRowToObject
  );
}

export async function getWorkDetails(workId: number): Promise<WorkDetails | null> {
  return executeQuery<WorkDetails, WorkDetails | null>(
    `SELECT
      w.*,
      e.employeeName as DoctorName,
      wt.WorkType as TypeName,
      ws.StatusName,
      k1.KeyWord as Keyword1,
      k2.KeyWord as Keyword2,
      k3.KeyWord as Keyword3,
      k4.KeyWord as Keyword4,
      k5.KeyWord as Keyword5,
      p.PatientName,
      COALESCE(SUM(i.Amountpaid), 0) as TotalPaid
    FROM tblwork w
    LEFT JOIN tblEmployees e ON w.DrID = e.ID
    LEFT JOIN tblWorkType wt ON w.Typeofwork = wt.ID
    LEFT JOIN tblWorkStatus ws ON w.Status = ws.StatusID
    LEFT JOIN tblKeyWord k1 ON w.KeyWordID1 = k1.ID
    LEFT JOIN tblKeyWord k2 ON w.KeyWordID2 = k2.ID
    LEFT JOIN tblKeyWord k3 ON w.KeywordID3 = k3.ID
    LEFT JOIN tblKeyWord k4 ON w.KeywordID4 = k4.ID
    LEFT JOIN tblKeyWord k5 ON w.KeywordID5 = k5.ID
    LEFT JOIN tblpatients p ON w.PersonID = p.PersonID
    LEFT JOIN tblInvoice i ON w.workid = i.workid
    WHERE w.workid = @WorkID
    GROUP BY w.workid, w.PersonID, w.TotalRequired, w.Currency, w.Typeofwork, w.Notes,
             w.Status, w.AdditionDate, w.StartDate, w.DebondDate, w.FPhotoDate,
             w.IPhotoDate, w.EstimatedDuration, w.DrID, w.NotesDate, w.KeyWordID1,
             w.KeyWordID2, w.KeywordID3, w.KeywordID4, w.KeywordID5,
             e.employeeName, wt.WorkType, ws.StatusName, k1.KeyWord, k2.KeyWord, k3.KeyWord, k4.KeyWord, k5.KeyWord,
             p.PatientName`,
    [['WorkID', TYPES.Int, workId]],
    mapRowToObject,
    (results) => (results.length > 0 ? results[0] : null)
  );
}

// Raw DB row type - TeethIds comes as comma-separated string from STRING_AGG
type WorkItemDbRow = Omit<WorkItem, 'TeethIds'> & { TeethIds: string | null };

export async function getWorkDetailsList(workId: number): Promise<WorkItem[]> {
  const results = await executeQuery<WorkItemDbRow>(
    `SELECT
      wi.ID,
      wi.WorkID,
      wi.FillingType,
      wi.FillingDepth,
      wi.CanalsNo,
      wi.WorkingLength,
      wi.ImplantLength,
      wi.ImplantDiameter,
      wi.ImplantManufacturerID,
      im.ManufacturerName AS ImplantManufacturerName,
      wi.Material,
      wi.LabName,
      wi.ItemCost,
      wi.StartDate,
      wi.CompletedDate,
      wi.Note,
      STRING_AGG(tn.ToothCode, ', ') AS Teeth,
      STRING_AGG(CAST(tn.ID AS VARCHAR), ',') AS TeethIds
    FROM tblWorkItems wi
    LEFT JOIN tblWorkItemTeeth wit ON wi.ID = wit.WorkItemID
    LEFT JOIN tblToothNumber tn ON wit.ToothID = tn.ID
    LEFT JOIN tblImplantManufacturer im ON wi.ImplantManufacturerID = im.ID
    WHERE wi.WorkID = @WorkID
    GROUP BY wi.ID, wi.WorkID, wi.FillingType, wi.FillingDepth,
             wi.CanalsNo, wi.WorkingLength, wi.ImplantLength, wi.ImplantDiameter,
             wi.ImplantManufacturerID, im.ManufacturerName,
             wi.Material, wi.LabName, wi.ItemCost, wi.StartDate, wi.CompletedDate, wi.Note
    ORDER BY wi.ID`,
    [['WorkID', TYPES.Int, workId]],
    (columns: ColumnValue[]): WorkItemDbRow => ({
      ID: columns[0].value as number,
      WorkID: columns[1].value as number,
      FillingType: columns[2].value as string | null,
      FillingDepth: columns[3].value as string | null,
      CanalsNo: columns[4].value as number | null,
      WorkingLength: columns[5].value as string | null,
      ImplantLength: columns[6].value as number | null,
      ImplantDiameter: columns[7].value as number | null,
      ImplantManufacturerID: columns[8].value as number | null,
      ImplantManufacturerName: columns[9].value as string | null,
      Material: columns[10].value as string | null,
      LabName: columns[11].value as string | null,
      ItemCost: columns[12].value as number | null,
      StartDate: columns[13].value as Date | null,
      CompletedDate: columns[14].value as Date | null,
      Note: columns[15].value as string | null,
      Teeth: columns[16].value as string | null,
      TeethIds: columns[17].value as string | null,
    })
  );

  // Convert TeethIds string to array of integers
  return results.map((item) => ({
    ...item,
    TeethIds: item.TeethIds ? item.TeethIds.split(',').map((id) => parseInt(id)) : [],
  }));
}

// Alias for new naming convention
export const getWorkItems = getWorkDetailsList;

export async function addWorkDetail(workDetailData: WorkItemData): Promise<{ ID: number } | null> {
  const result = await executeQuery<{ ID: number }, { ID: number } | null>(
    `INSERT INTO tblWorkItems (
      WorkID, FillingType, FillingDepth, CanalsNo, WorkingLength,
      ImplantLength, ImplantDiameter, ImplantManufacturerID, Material, LabName,
      ItemCost, StartDate, CompletedDate, Note
    ) VALUES (
      @WorkID, @FillingType, @FillingDepth, @CanalsNo, @WorkingLength,
      @ImplantLength, @ImplantDiameter, @ImplantManufacturerID, @Material, @LabName,
      @ItemCost, @StartDate, @CompletedDate, @Note
    );
    SELECT SCOPE_IDENTITY() as ID;`,
    [
      ['WorkID', TYPES.Int, workDetailData.WorkID],
      ['FillingType', TYPES.NVarChar, workDetailData.FillingType || null],
      ['FillingDepth', TYPES.NVarChar, workDetailData.FillingDepth || null],
      ['CanalsNo', TYPES.Int, workDetailData.CanalsNo || null],
      ['WorkingLength', TYPES.NVarChar, workDetailData.WorkingLength || null],
      ['ImplantLength', TYPES.Decimal, workDetailData.ImplantLength || null],
      ['ImplantDiameter', TYPES.Decimal, workDetailData.ImplantDiameter || null],
      ['ImplantManufacturerID', TYPES.Int, workDetailData.ImplantManufacturerID || null],
      ['Material', TYPES.NVarChar, workDetailData.Material || null],
      ['LabName', TYPES.NVarChar, workDetailData.LabName || null],
      ['ItemCost', TYPES.Int, workDetailData.ItemCost || null],
      ['StartDate', TYPES.Date, workDetailData.StartDate || null],
      ['CompletedDate', TYPES.Date, workDetailData.CompletedDate || null],
      ['Note', TYPES.NVarChar, workDetailData.Note || null],
    ],
    (columns: ColumnValue[]) => ({ ID: columns[0].value as number }),
    (results) => (results.length > 0 ? results[0] : null)
  );

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
  const result = await executeQuery<unknown, { success: boolean; rowCount: number }>(
    `UPDATE tblWorkItems SET
      FillingType = @FillingType,
      FillingDepth = @FillingDepth,
      CanalsNo = @CanalsNo,
      WorkingLength = @WorkingLength,
      ImplantLength = @ImplantLength,
      ImplantDiameter = @ImplantDiameter,
      ImplantManufacturerID = @ImplantManufacturerID,
      Material = @Material,
      LabName = @LabName,
      ItemCost = @ItemCost,
      StartDate = @StartDate,
      CompletedDate = @CompletedDate,
      Note = @Note
    WHERE ID = @ID`,
    [
      ['ID', TYPES.Int, detailId],
      ['FillingType', TYPES.NVarChar, workDetailData.FillingType || null],
      ['FillingDepth', TYPES.NVarChar, workDetailData.FillingDepth || null],
      ['CanalsNo', TYPES.Int, workDetailData.CanalsNo || null],
      ['WorkingLength', TYPES.NVarChar, workDetailData.WorkingLength || null],
      ['ImplantLength', TYPES.Decimal, workDetailData.ImplantLength || null],
      ['ImplantDiameter', TYPES.Decimal, workDetailData.ImplantDiameter || null],
      ['ImplantManufacturerID', TYPES.Int, workDetailData.ImplantManufacturerID || null],
      ['Material', TYPES.NVarChar, workDetailData.Material || null],
      ['LabName', TYPES.NVarChar, workDetailData.LabName || null],
      ['ItemCost', TYPES.Int, workDetailData.ItemCost || null],
      ['StartDate', TYPES.Date, workDetailData.StartDate || null],
      ['CompletedDate', TYPES.Date, workDetailData.CompletedDate || null],
      ['Note', TYPES.NVarChar, workDetailData.Note || null],
    ],
    () => ({}),
    (results) => ({ success: true, rowCount: results.length || 0 })
  );

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
  return executeQuery<unknown, { success: boolean; rowCount: number }>(
    `DELETE FROM tblWorkItems WHERE ID = @ID`,
    [['ID', TYPES.Int, detailId]],
    () => ({}),
    (results) => ({ success: true, rowCount: results.length || 0 })
  );
}

// Alias for new naming convention
export const deleteWorkItem = deleteWorkDetail;

export async function addWork(workData: WorkData): Promise<{ workid: number } | null> {
  const status = workData.Status || WORK_STATUS.ACTIVE;

  return executeQuery<{ workid: number }, { workid: number } | null>(
    `INSERT INTO tblwork (
      PersonID, TotalRequired, Currency, Typeofwork, Notes, Status,
      StartDate, DebondDate, FPhotoDate, IPhotoDate, EstimatedDuration,
      DrID, NotesDate, KeyWordID1, KeyWordID2, KeywordID3, KeywordID4, KeywordID5
    ) VALUES (
      @PersonID, @TotalRequired, @Currency, @Typeofwork, @Notes, @Status,
      @StartDate, @DebondDate, @FPhotoDate, @IPhotoDate, @EstimatedDuration,
      @DrID, @NotesDate, @KeyWordID1, @KeyWordID2, @KeywordID3, @KeywordID4, @KeywordID5
    );
    SELECT SCOPE_IDENTITY() as workid;`,
    [
      ['PersonID', TYPES.Int, workData.PersonID],
      ['TotalRequired', TYPES.Int, workData.TotalRequired ?? null],
      ['Currency', TYPES.NVarChar, workData.Currency || null],
      ['Typeofwork', TYPES.Int, workData.Typeofwork ?? null],
      ['Notes', TYPES.NVarChar, workData.Notes || null],
      ['Status', TYPES.TinyInt, status],
      ['StartDate', TYPES.Date, workData.StartDate || null],
      ['DebondDate', TYPES.Date, workData.DebondDate || null],
      ['FPhotoDate', TYPES.Date, workData.FPhotoDate || null],
      ['IPhotoDate', TYPES.Date, workData.IPhotoDate || null],
      ['EstimatedDuration', TYPES.TinyInt, workData.EstimatedDuration ?? null],
      ['DrID', TYPES.Int, workData.DrID],
      ['NotesDate', TYPES.Date, workData.NotesDate || null],
      ['KeyWordID1', TYPES.Int, workData.KeyWordID1 || null],
      ['KeyWordID2', TYPES.Int, workData.KeyWordID2 || null],
      ['KeywordID3', TYPES.Int, workData.KeywordID3 || null],
      ['KeywordID4', TYPES.Int, workData.KeywordID4 || null],
      ['KeywordID5', TYPES.Int, workData.KeywordID5 || null],
    ],
    (columns: ColumnValue[]) => ({ workid: columns[0].value as number }),
    (results) => (results.length > 0 ? results[0] : null)
  );
}

export async function updateWork(
  workId: number,
  workData: Partial<WorkData>
): Promise<{ success: boolean; rowCount: number }> {
  // Build dynamic UPDATE query - only update fields that are provided
  interface FieldMapping {
    param: string;
    type: typeof TYPES.Int | typeof TYPES.NVarChar | typeof TYPES.TinyInt | typeof TYPES.Date;
    value: unknown;
  }

  const fieldMappings: Record<string, FieldMapping> = {
    TotalRequired: { param: 'TotalRequired', type: TYPES.Int, value: workData.TotalRequired ?? null },
    Currency: { param: 'Currency', type: TYPES.NVarChar, value: workData.Currency || null },
    Typeofwork: { param: 'Typeofwork', type: TYPES.Int, value: workData.Typeofwork ?? null },
    Notes: { param: 'Notes', type: TYPES.NVarChar, value: workData.Notes || null },
    Status: { param: 'Status', type: TYPES.TinyInt, value: workData.Status ?? WORK_STATUS.ACTIVE },
    StartDate: { param: 'StartDate', type: TYPES.Date, value: workData.StartDate || null },
    DebondDate: { param: 'DebondDate', type: TYPES.Date, value: workData.DebondDate || null },
    FPhotoDate: { param: 'FPhotoDate', type: TYPES.Date, value: workData.FPhotoDate || null },
    IPhotoDate: { param: 'IPhotoDate', type: TYPES.Date, value: workData.IPhotoDate || null },
    EstimatedDuration: {
      param: 'EstimatedDuration',
      type: TYPES.TinyInt,
      value: workData.EstimatedDuration || null,
    },
    DrID: { param: 'DrID', type: TYPES.Int, value: workData.DrID },
    NotesDate: { param: 'NotesDate', type: TYPES.Date, value: workData.NotesDate || null },
    KeyWordID1: { param: 'KeyWordID1', type: TYPES.Int, value: workData.KeyWordID1 || null },
    KeyWordID2: { param: 'KeyWordID2', type: TYPES.Int, value: workData.KeyWordID2 || null },
    KeywordID3: { param: 'KeywordID3', type: TYPES.Int, value: workData.KeywordID3 || null },
    KeywordID4: { param: 'KeywordID4', type: TYPES.Int, value: workData.KeywordID4 || null },
    KeywordID5: { param: 'KeywordID5', type: TYPES.Int, value: workData.KeywordID5 || null },
  };

  // Only include fields that are present in workData
  const setClause: string[] = [];
  const parameters: SqlParam[] = [['WorkID', TYPES.Int, workId]];

  Object.keys(fieldMappings).forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(workData, field)) {
      const mapping = fieldMappings[field];
      setClause.push(`${field} = @${mapping.param}`);
      parameters.push([mapping.param, mapping.type, mapping.value]);
    }
  });

  // If no fields to update, return early
  if (setClause.length === 0) {
    return { success: true, rowCount: 0 };
  }

  const query = `UPDATE tblwork SET ${setClause.join(', ')} WHERE workid = @WorkID`;

  return executeQuery<unknown, { success: boolean; rowCount: number }>(query, parameters, () => ({}), (results) => ({
    success: true,
    rowCount: results.length || 0,
  }));
}

export async function finishWork(workId: number): Promise<{ success: boolean; rowCount: number }> {
  return executeQuery<unknown, { success: boolean; rowCount: number }>(
    `UPDATE tblwork SET Status = @Status WHERE workid = @WorkID`,
    [
      ['WorkID', TYPES.Int, workId],
      ['Status', TYPES.TinyInt, WORK_STATUS.FINISHED],
    ],
    () => ({}),
    (results) => ({ success: true, rowCount: results.length || 0 })
  );
}

export async function discontinueWork(
  workId: number
): Promise<{ success: boolean; rowCount: number }> {
  return executeQuery<unknown, { success: boolean; rowCount: number }>(
    `UPDATE tblwork SET Status = @Status WHERE workid = @WorkID`,
    [
      ['WorkID', TYPES.Int, workId],
      ['Status', TYPES.TinyInt, WORK_STATUS.DISCONTINUED],
    ],
    () => ({}),
    (results) => ({ success: true, rowCount: results.length || 0 })
  );
}

export async function reactivateWork(
  workId: number
): Promise<{ success: boolean; rowCount: number }> {
  return executeQuery<unknown, { success: boolean; rowCount: number }>(
    `UPDATE tblwork SET Status = @Status WHERE workid = @WorkID`,
    [
      ['WorkID', TYPES.Int, workId],
      ['Status', TYPES.TinyInt, WORK_STATUS.ACTIVE],
    ],
    () => ({}),
    (results) => ({ success: true, rowCount: results.length || 0 })
  );
}

export async function addWorkWithInvoice(
  workData: WorkData
): Promise<{ workId: number; invoiceId: number }> {
  const today = new Date().toISOString().split('T')[0];
  let connection: Connection | null = null;

  try {
    connection = await ConnectionPool.getConnection();

    const result = await new Promise<{ workId: number; invoiceId: number }>((resolve, reject) => {
      let workId: number | null = null;
      let invoiceId: number | null = null;

      const usdReceived =
        workData.Currency === 'USD' || workData.Currency === 'EUR' ? workData.TotalRequired : 0;
      const iqdReceived = workData.Currency === 'IQD' ? workData.TotalRequired : 0;

      const request = new Request(
        `BEGIN TRANSACTION;

        DECLARE @workId INT;

        INSERT INTO tblwork (
          PersonID, TotalRequired, Currency, Typeofwork, Notes, Status,
          StartDate, DebondDate, FPhotoDate, IPhotoDate, EstimatedDuration,
          DrID, NotesDate, KeyWordID1, KeyWordID2, KeywordID3, KeywordID4, KeywordID5
        )
        VALUES (
          @PersonID, @TotalRequired, @Currency, @Typeofwork, @Notes, 2,
          @StartDate, @DebondDate, @FPhotoDate, @IPhotoDate, @EstimatedDuration,
          @DrID, @NotesDate, @KeyWordID1, @KeyWordID2, @KeywordID3, @KeywordID4, @KeywordID5
        );

        SET @workId = SCOPE_IDENTITY();

        INSERT INTO dbo.tblInvoice (workid, Amountpaid, Dateofpayment, USDReceived, IQDReceived, Change)
        VALUES (@workId, @TotalRequired, @paymentDate, @usdReceived, @iqdReceived, @change);

        COMMIT TRANSACTION;

        SELECT @workId AS workId, SCOPE_IDENTITY() AS invoiceId;`,
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve({ workId: workId!, invoiceId: invoiceId! });
          }
        }
      );

      request.on('row', (columns: ColumnValue[]) => {
        workId = columns[0].value as number;
        invoiceId = columns[1].value as number;
      });

      request.addParameter('PersonID', TYPES.Int, workData.PersonID);
      request.addParameter('TotalRequired', TYPES.Int, workData.TotalRequired ?? null);
      request.addParameter('Currency', TYPES.NVarChar, workData.Currency || null);
      request.addParameter('Typeofwork', TYPES.Int, workData.Typeofwork ?? null);
      request.addParameter('Notes', TYPES.NVarChar, workData.Notes || null);
      request.addParameter('StartDate', TYPES.Date, workData.StartDate || null);
      request.addParameter('DebondDate', TYPES.Date, workData.DebondDate || null);
      request.addParameter('FPhotoDate', TYPES.Date, workData.FPhotoDate || null);
      request.addParameter('IPhotoDate', TYPES.Date, workData.IPhotoDate || null);
      request.addParameter('EstimatedDuration', TYPES.TinyInt, workData.EstimatedDuration ?? null);
      request.addParameter('DrID', TYPES.Int, workData.DrID);
      request.addParameter('NotesDate', TYPES.Date, workData.NotesDate || null);
      request.addParameter('KeyWordID1', TYPES.Int, workData.KeyWordID1 || null);
      request.addParameter('KeyWordID2', TYPES.Int, workData.KeyWordID2 || null);
      request.addParameter('KeywordID3', TYPES.Int, workData.KeywordID3 || null);
      request.addParameter('KeywordID4', TYPES.Int, workData.KeywordID4 || null);
      request.addParameter('KeywordID5', TYPES.Int, workData.KeywordID5 || null);
      request.addParameter('paymentDate', TYPES.Date, today);
      request.addParameter('usdReceived', TYPES.Int, usdReceived);
      request.addParameter('iqdReceived', TYPES.Int, iqdReceived);
      request.addParameter('change', TYPES.Int, null);

      connection!.execSql(request);
    });

    return result;
  } finally {
    if (connection) {
      ConnectionPool.releaseConnection(connection);
    }
  }
}

export async function deleteWork(
  workId: number
): Promise<{ canDelete: boolean; success?: boolean; rowCount?: number; dependencies?: DependencyCheck }> {
  const dependencyCheck = await executeQuery<DependencyCheck, DependencyCheck>(
    `SELECT
      (SELECT COUNT(*) FROM tblInvoice WHERE workid = @WorkID) AS InvoiceCount,
      (SELECT COUNT(*) FROM tblvisits WHERE WorkID = @WorkID) AS VisitCount,
      (SELECT COUNT(*) FROM tblWorkItems WHERE WorkID = @WorkID) AS ItemCount,
      (SELECT COUNT(*) FROM tblDiagnosis WHERE WorkID = @WorkID) AS DiagnosisCount,
      (SELECT COUNT(*) FROM tblImplant WHERE WorkID = @WorkID) AS ImplantCount,
      (SELECT COUNT(*) FROM tblscrews WHERE WorkID = @WorkID) AS ScrewCount`,
    [['WorkID', TYPES.Int, workId]],
    (columns: ColumnValue[]) => ({
      InvoiceCount: columns[0].value as number,
      VisitCount: columns[1].value as number,
      ItemCount: columns[2].value as number,
      DiagnosisCount: columns[3].value as number,
      ImplantCount: columns[4].value as number,
      ScrewCount: columns[5].value as number,
    }),
    (results) => results[0]
  );

  // Return dependency information if any exist
  if (
    dependencyCheck.InvoiceCount > 0 ||
    dependencyCheck.VisitCount > 0 ||
    dependencyCheck.ItemCount > 0 ||
    dependencyCheck.DiagnosisCount > 0 ||
    dependencyCheck.ImplantCount > 0 ||
    dependencyCheck.ScrewCount > 0
  ) {
    return {
      canDelete: false,
      dependencies: dependencyCheck,
    };
  }

  // If no dependencies, proceed with deletion
  const result = await executeQuery<unknown, { success: boolean; rowCount: number }>(
    `DELETE FROM tblwork WHERE workid = @WorkID`,
    [['WorkID', TYPES.Int, workId]],
    () => ({}),
    (results) => ({ success: true, rowCount: results.length || 0 })
  );

  return {
    canDelete: true,
    success: result.success,
    rowCount: result.rowCount,
  };
}

export async function getActiveWork(personId: number): Promise<Work | null> {
  return executeQuery<Work, Work | null>(
    `SELECT TOP 1
      w.*,
      e.employeeName as DoctorName,
      wt.WorkType as TypeName,
      ws.StatusName
    FROM tblwork w
    LEFT JOIN tblEmployees e ON w.DrID = e.ID
    LEFT JOIN tblWorkType wt ON w.Typeofwork = wt.ID
    LEFT JOIN tblWorkStatus ws ON w.Status = ws.StatusID
    WHERE w.PersonID = @PersonID AND w.Status = 1
    ORDER BY w.AdditionDate DESC`,
    [['PersonID', TYPES.Int, personId]],
    mapRowToObject,
    (results) => (results.length > 0 ? results[0] : null)
  );
}

export async function getWorkById(workId: number): Promise<Work | null> {
  return executeQuery<Work, Work | null>(
    `SELECT
      w.*,
      e.employeeName as DoctorName,
      wt.WorkType as TypeName,
      ws.StatusName
    FROM tblwork w
    LEFT JOIN tblEmployees e ON w.DrID = e.ID
    LEFT JOIN tblWorkType wt ON w.Typeofwork = wt.ID
    LEFT JOIN tblWorkStatus ws ON w.Status = ws.StatusID
    WHERE w.workid = @WorkID`,
    [['WorkID', TYPES.Int, workId]],
    mapRowToObject,
    (results) => (results.length > 0 ? results[0] : null)
  );
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
  return executeQuery<WorkType>(
    `SELECT ID, WorkType
    FROM tblWorkType
    ORDER BY WorkType`,
    [],
    mapRowToObject
  );
}

export async function getWorkKeywords(): Promise<Keyword[]> {
  return executeQuery<Keyword>(
    `SELECT ID, KeyWord
    FROM tblKeyWord
    ORDER BY KeyWord`,
    [],
    mapRowToObject
  );
}

// ===== TOOTH NUMBER FUNCTIONS =====

export async function getToothNumbers(
  includePermanent = true,
  includeDeciduous = true
): Promise<ToothNumber[]> {
  let whereClause = '';
  if (includePermanent && !includeDeciduous) {
    whereClause = 'WHERE IsPermanent = 1';
  } else if (!includePermanent && includeDeciduous) {
    whereClause = 'WHERE IsPermanent = 0';
  }

  return executeQuery<ToothNumber>(
    `SELECT ID, ToothCode, ToothName, Quadrant, ToothNumber, IsPermanent, SortOrder
    FROM tblToothNumber
    ${whereClause}
    ORDER BY SortOrder`,
    [],
    mapRowToObject
  );
}

export async function setWorkItemTeeth(
  workItemId: number,
  teethIds: number[]
): Promise<{ success: boolean; count: number }> {
  // First, delete existing teeth for this work item
  await executeQuery(
    `DELETE FROM tblWorkItemTeeth WHERE WorkItemID = @WorkItemID`,
    [['WorkItemID', TYPES.Int, workItemId]],
    () => ({}),
    () => ({ success: true })
  );

  // If no teeth to add, return early
  if (!teethIds || teethIds.length === 0) {
    return { success: true, count: 0 };
  }

  // Insert new teeth
  const values = teethIds.map((_, index) => `(@WorkItemID, @ToothID${index})`).join(', ');
  const params: SqlParam[] = [['WorkItemID', TYPES.Int, workItemId]];
  teethIds.forEach((toothId, index) => {
    params.push([`ToothID${index}`, TYPES.Int, toothId]);
  });

  await executeQuery(
    `INSERT INTO tblWorkItemTeeth (WorkItemID, ToothID) VALUES ${values}`,
    params,
    () => ({}),
    () => ({ success: true })
  );

  return { success: true, count: teethIds.length };
}

export async function getWorkItemTeeth(workItemId: number): Promise<ToothNumber[]> {
  return executeQuery<ToothNumber>(
    `SELECT tn.ID, tn.ToothCode, tn.ToothName, tn.Quadrant, tn.IsPermanent
    FROM tblWorkItemTeeth wit
    INNER JOIN tblToothNumber tn ON wit.ToothID = tn.ID
    WHERE wit.WorkItemID = @WorkItemID
    ORDER BY tn.SortOrder`,
    [['WorkItemID', TYPES.Int, workItemId]],
    mapRowToObject
  );
}

export async function getImplantManufacturers(): Promise<ImplantManufacturer[]> {
  return executeQuery<ImplantManufacturer>(
    `SELECT ID as id, ManufacturerName as name
    FROM tblImplantManufacturer
    ORDER BY ManufacturerName`,
    [],
    (columns: ColumnValue[]) => ({
      id: columns[0].value as number,
      name: columns[1].value as string,
    })
  );
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
  return executeQuery<WorkRelatedCounts, WorkRelatedCounts>(
    `SELECT
      (SELECT COUNT(*) FROM tblvisits WHERE WorkID = @WorkID) AS visits,
      (SELECT COUNT(*) FROM tblInvoice WHERE workid = @WorkID) AS invoices,
      (SELECT COUNT(*) FROM tblDiagnosis WHERE WorkID = @WorkID) AS diagnoses,
      (SELECT COUNT(*) FROM tblWorkItems WHERE WorkID = @WorkID) AS workItems,
      (SELECT COUNT(*) FROM tblAlignerSets WHERE WorkID = @WorkID) AS alignerSets,
      (SELECT COUNT(*) FROM tblAlignerBatches ab
       INNER JOIN tblAlignerSets s ON ab.AlignerSetID = s.AlignerSetID
       WHERE s.WorkID = @WorkID) AS alignerBatches,
      (SELECT COUNT(*) FROM tblWires WHERE WorkID = @WorkID) AS wires,
      (SELECT COUNT(*) FROM tblImplant WHERE WorkID = @WorkID) AS implants,
      (SELECT COUNT(*) FROM tblscrews WHERE WorkID = @WorkID) AS screws`,
    [['WorkID', TYPES.Int, workId]],
    (columns: ColumnValue[]) => ({
      visits: columns[0].value as number,
      invoices: columns[1].value as number,
      diagnoses: columns[2].value as number,
      workItems: columns[3].value as number,
      alignerSets: columns[4].value as number,
      alignerBatches: columns[5].value as number,
      wires: columns[6].value as number,
      implants: columns[7].value as number,
      screws: columns[8].value as number,
    }),
    (results) => results[0]
  );
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
  await executeQuery(
    `UPDATE tblwork SET PersonID = @TargetPersonID WHERE workid = @WorkID`,
    [
      ['WorkID', TYPES.Int, workId],
      ['TargetPersonID', TYPES.Int, targetPatientId],
    ],
    () => ({}),
    () => ({ success: true })
  );

  return {
    success: true,
    workId,
    sourcePatientId,
    targetPatientId,
    relatedCounts,
  };
}
