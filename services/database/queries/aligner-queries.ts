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
 */
import type { ColumnValue } from '../../../types/database.types.js';
import type { Request as TediousRequest } from 'tedious';
import { executeQuery, executeStoredProcedure, TYPES, SqlParam } from '../index.js';
import { log } from '../../../utils/logger.js';

// ==============================
// TYPE DEFINITIONS
// ==============================

interface AlignerDoctor {
  DrID: number;
  DoctorName: string;
  DoctorEmail: string | null;
  LogoPath: string | null;
}

interface AlignerDoctorWithUnread extends AlignerDoctor {
  UnreadDoctorNotes: number;
}

interface DoctorData {
  DoctorName: string;
  DoctorEmail?: string | null;
  LogoPath?: string | null;
}

interface AlignerSet {
  AlignerSetID: number;
  WorkID: number;
  SetSequence: number | null;
  Type: string | null;
  UpperAlignersCount: number;
  LowerAlignersCount: number;
  RemainingUpperAligners: number;
  RemainingLowerAligners: number;
  CreationDate: Date;
  Days: number | null;
  IsActive: boolean;
  Notes: string | null;
  FolderPath: string | null;
  AlignerDrID: number;
  SetUrl: string | null;
  SetPdfUrl: string | null;
  SetVideo: string | null;
  SetCost: number | null;
  Currency: string | null;
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
  PersonID: number;
  PatientName: string;
  WorkID: number;
  AlignerDrID: number;
  AlignerSetID: number;
  SetSequence: number | null;
  SetIsActive: boolean;
  BatchSequence: number | null;
  CreationDate: Date | null;
  BatchCreationDate: Date | null;
  ManufactureDate: Date | null;
  DeliveredToPatientDate: Date | null;
  NextDueDate: Date | null;
  Notes: string | null;
  IsLast: boolean | null;
  NextBatchPresent: string | null;
  LabStatus: string | null;
  DoctorName: string;
  WorkStatus: number | null;
  WorkStatusName: string | null;
}

interface AlignerSetData {
  WorkID: number;
  SetSequence?: number | null;
  Type?: string | null;
  UpperAlignersCount?: number;
  LowerAlignersCount?: number;
  Days?: number | null;
  AlignerDrID: number;
  SetUrl?: string | null;
  SetPdfUrl?: string | null;
  SetCost?: number | null;
  Currency?: string | null;
  Notes?: string | null;
  IsActive?: boolean;
}

interface AlignerSetUpdateData {
  SetSequence?: number | null;
  Type?: string | null;
  UpperAlignersCount?: number;
  LowerAlignersCount?: number;
  Days?: number | null;
  AlignerDrID?: number | null;
  SetUrl?: string | null;
  SetPdfUrl?: string | null;
  SetVideo?: string | null;
  SetCost?: number | null;
  Currency?: string | null;
  Notes?: string | null;
  IsActive?: boolean;
}

interface AlignerPatient {
  PersonID: number;
  FirstName: string | null;
  LastName: string | null;
  PatientName: string;
  Phone: string | null;
  workid: number;
  WorkType: string;
  WorkTypeID: number;
  TotalSets?: number;
  ActiveSets?: number;
  UnreadDoctorNotes?: number;
  DateOfBirth?: Date | null;
  StartDate?: Date | null;
}

interface AlignerBatch {
  AlignerBatchID: number;
  AlignerSetID: number;
  BatchSequence: number;
  UpperAlignerCount: number;
  LowerAlignerCount: number;
  UpperAlignerStartSequence: number | null;
  UpperAlignerEndSequence: number | null;
  LowerAlignerStartSequence: number | null;
  LowerAlignerEndSequence: number | null;
  CreationDate: Date;
  ManufactureDate: Date | null;
  DeliveredToPatientDate: Date | null;
  Days: number | null;
  ValidityPeriod: number | null;
  BatchExpiryDate: Date | null;
  Notes: string | null;
  IsActive: boolean;
  IsLast: boolean;
}

interface BatchData {
  AlignerSetID: number;
  UpperAlignerCount?: number;
  LowerAlignerCount?: number;
  // NOTE: ManufactureDate and DeliveredToPatientDate are managed via updateBatchStatus()
  Days?: number | null;
  Notes?: string | null;
  IsActive?: boolean;
  IncludeUpperTemplate?: boolean;
  IncludeLowerTemplate?: boolean;
  IsLast?: boolean;
  BatchSequence?: number;
  AlignersInBatch?: number;
  UpperAlignerStartSequence?: number;
  UpperAlignerEndSequence?: number;
  LowerAlignerStartSequence?: number;
  LowerAlignerEndSequence?: number;
  // Note: BatchExpiryDate and ValidityPeriod are computed columns - cannot be set directly
}

interface BatchUpdateData extends Omit<BatchData, 'AlignerSetID'> {
  AlignerSetID?: number;
}

interface AlignerNote {
  NoteID: number;
  AlignerSetID: number;
  NoteType: 'Lab' | 'Doctor';
  NoteText: string;
  CreatedAt: Date;
  IsEdited: boolean;
  EditedAt: Date | null;
  IsRead: boolean;
  DoctorName: string;
}

interface AlignerActivity {
  ActivityID: number;
  AlignerSetID: number;
  ActivityType: string;
  ActivityDescription: string;
  CreatedAt: Date;
  IsRead: boolean;
  ReadAt: Date | null;
  RelatedRecordID: number | null;
}

interface AlignerPaymentData {
  workid: number;
  AlignerSetID: number | null;
  Amountpaid: number | string;
  Dateofpayment: Date | string;
  ActualAmount?: number | null;
  ActualCur?: string | null;
  Change?: number | null;
  USDReceived?: number;
  IQDReceived?: number;
  Notes?: string;
}

interface AlignerSetBalance {
  AlignerSetID: number;
  SetCost: number | null;
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
 * Result from usp_MarkBatchDelivered stored procedure
 */
interface MarkBatchDeliveredRow {
  AlignerBatchID: number;
  BatchSequence: number;
  AlignerSetID: number;
  WasActivated: boolean;
  WasAlreadyActive: boolean;
  WasAlreadyDelivered: boolean;
  PreviouslyActiveBatchSequence: number | null;
}

/**
 * Parsed result from marking batch as delivered
 */
export interface MarkBatchDeliveredResult {
  batchId: number;
  batchSequence: number;
  alignerSetId: number;
  wasActivated: boolean;
  wasAlreadyActive: boolean;
  wasAlreadyDelivered: boolean;
  previouslyActiveBatchSequence: number | null;
}

/**
 * Result from usp_UpdateBatchStatus stored procedure (consolidated batch operations)
 */
interface UpdateBatchStatusRow {
  AlignerBatchID: number;
  BatchSequence: number;
  AlignerSetID: number;
  ActionPerformed: string;
  Success: boolean;
  Message: string;
  WasActivated: boolean;
  WasAlreadyActive: boolean;
  WasAlreadyDelivered: boolean;
  PreviouslyActiveBatchSequence: number | null;
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
  const query = `
    SELECT DISTINCT
      ad.DrID,
      ad.DoctorName,
      (SELECT COUNT(*)
       FROM tblAlignerNotes n
       INNER JOIN tblAlignerSets s ON n.AlignerSetID = s.AlignerSetID
       WHERE s.AlignerDrID = ad.DrID
         AND n.NoteType = 'Doctor'
         AND n.IsRead = 0
      ) AS UnreadDoctorNotes
    FROM AlignerDoctors ad
    ORDER BY ad.DoctorName
  `;

  return executeQuery<AlignerDoctorWithUnread>(query, [], (columns: ColumnValue[]) => ({
    DrID: columns[0].value as number,
    DoctorName: columns[1].value as string,
    DoctorEmail: null,
    LogoPath: null,
    UnreadDoctorNotes: (columns[2].value as number) || 0,
  }));
}

/**
 * Get all aligner doctors (simple list)
 */
export async function getAllDoctors(): Promise<AlignerDoctor[]> {
  const query = `
    SELECT DrID, DoctorName, DoctorEmail, LogoPath
    FROM AlignerDoctors
    ORDER BY DoctorName
  `;

  return executeQuery<AlignerDoctor>(query, [], (columns: ColumnValue[]) => ({
    DrID: columns[0].value as number,
    DoctorName: columns[1].value as string,
    DoctorEmail: columns[2].value as string | null,
    LogoPath: columns[3].value as string | null,
  }));
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

  let query = 'SELECT DrID FROM AlignerDoctors WHERE DoctorEmail = @email';
  const params: SqlParam[] = [['email', TYPES.NVarChar, email.trim()]];

  if (excludeDrID) {
    query += ' AND DrID != @drID';
    params.push(['drID', TYPES.Int, excludeDrID]);
  }

  const result = await executeQuery<number>(
    query,
    params,
    (columns: ColumnValue[]) => columns[0].value as number
  );

  return result && result.length > 0;
}

/**
 * Get count of aligner sets for a doctor
 */
export async function getDoctorSetCount(drID: number): Promise<number> {
  const result = await executeQuery<number>(
    'SELECT COUNT(*) as SetCount FROM tblAlignerSets WHERE AlignerDrID = @drID',
    [['drID', TYPES.Int, drID]],
    (columns: ColumnValue[]) => columns[0].value as number
  );

  return result && result.length > 0 ? result[0] : 0;
}

/**
 * Create a new aligner doctor
 */
export async function createDoctor(doctorData: DoctorData): Promise<number | null> {
  const { DoctorName, DoctorEmail, LogoPath } = doctorData;

  const insertQuery = `
    DECLARE @OutputTable TABLE (DrID INT);

    INSERT INTO AlignerDoctors (DoctorName, DoctorEmail, LogoPath)
    OUTPUT INSERTED.DrID INTO @OutputTable
    VALUES (@name, @email, @logo);

    SELECT DrID FROM @OutputTable;
  `;

  const result = await executeQuery<number>(
    insertQuery,
    [
      ['name', TYPES.NVarChar, DoctorName.trim()],
      ['email', TYPES.VarChar, DoctorEmail && DoctorEmail.trim() !== '' ? DoctorEmail.trim() : null],
      ['logo', TYPES.NVarChar, LogoPath && LogoPath.trim() !== '' ? LogoPath.trim() : null],
    ],
    (columns: ColumnValue[]) => columns[0].value as number
  );

  return result && result.length > 0 ? result[0] : null;
}

/**
 * Update an aligner doctor
 */
export async function updateDoctor(drID: number, doctorData: DoctorData): Promise<void> {
  const { DoctorName, DoctorEmail, LogoPath } = doctorData;

  const updateQuery = `
    UPDATE AlignerDoctors
    SET DoctorName = @name,
        DoctorEmail = @email,
        LogoPath = @logo
    WHERE DrID = @drID
  `;

  await executeQuery(updateQuery, [
    ['name', TYPES.NVarChar, DoctorName.trim()],
    ['email', TYPES.NVarChar, DoctorEmail && DoctorEmail.trim() !== '' ? DoctorEmail.trim() : null],
    ['logo', TYPES.NVarChar, LogoPath && LogoPath.trim() !== '' ? LogoPath.trim() : null],
    ['drID', TYPES.Int, drID],
  ]);
}

/**
 * Delete an aligner doctor
 */
export async function deleteDoctor(drID: number): Promise<void> {
  await executeQuery('DELETE FROM AlignerDoctors WHERE DrID = @drID', [['drID', TYPES.Int, drID]]);
}

// ==============================
// ALIGNER SETS QUERIES
// ==============================

/**
 * Get all aligner sets from v_allsets view
 */
export async function getAllAlignerSets(): Promise<AlignerSetFromView[]> {
  const query = `
    SELECT
      v.PersonID,
      v.PatientName,
      v.WorkID,
      v.AlignerDrID,
      v.AlignerSetID,
      v.SetSequence,
      v.SetIsActive,
      v.BatchSequence,
      v.CreationDate,
      v.BatchCreationDate,
      v.ManufactureDate,
      v.DeliveredToPatientDate,
      v.NextDueDate,
      v.Notes,
      v.IsLast,
      v.NextBatchPresent,
      v.LabStatus,
      ad.DoctorName,
      w.Status as WorkStatus,
      ws.StatusName as WorkStatusName
    FROM dbo.v_allsets v
    INNER JOIN AlignerDoctors ad ON v.AlignerDrID = ad.DrID
    INNER JOIN tblwork w ON v.WorkID = w.workid
    LEFT JOIN tblWorkStatus ws ON w.Status = ws.StatusID
    ORDER BY
      CASE WHEN v.SetIsActive = 1 THEN 0 ELSE 1 END,
      CASE WHEN v.NextBatchPresent = 'False' THEN 0 ELSE 1 END,
      v.NextDueDate ASC,
      v.PatientName
  `;

  return executeQuery<AlignerSetFromView>(query, [], (columns: ColumnValue[]) => ({
    PersonID: columns[0].value as number,
    PatientName: columns[1].value as string,
    WorkID: columns[2].value as number,
    AlignerDrID: columns[3].value as number,
    AlignerSetID: columns[4].value as number,
    SetSequence: columns[5].value as number | null,
    SetIsActive: columns[6].value as boolean,
    BatchSequence: columns[7].value as number | null,
    CreationDate: columns[8].value as Date | null,
    BatchCreationDate: columns[9].value as Date | null,
    ManufactureDate: columns[10].value as Date | null,
    DeliveredToPatientDate: columns[11].value as Date | null,
    NextDueDate: columns[12].value as Date | null,
    Notes: columns[13].value as string | null,
    IsLast: columns[14].value as boolean | null,
    NextBatchPresent: columns[15].value as string | null,
    LabStatus: columns[16].value as string | null,
    DoctorName: columns[17].value as string,
    WorkStatus: columns[18].value as number | null,
    WorkStatusName: columns[19].value as string | null,
  }));
}

/**
 * Get aligner sets for a specific work ID
 */
export async function getAlignerSetsByWorkId(workId: number): Promise<AlignerSetWithDetails[]> {
  const query = `
    SELECT
      s.AlignerSetID,
      s.WorkID,
      s.SetSequence,
      s.Type,
      s.UpperAlignersCount,
      s.LowerAlignersCount,
      s.RemainingUpperAligners,
      s.RemainingLowerAligners,
      s.CreationDate,
      s.Days,
      s.IsActive,
      s.Notes,
      s.FolderPath,
      s.AlignerDrID,
      s.SetUrl,
      s.SetPdfUrl,
      s.SetVideo,
      s.SetCost,
      s.Currency,
      ad.DoctorName as AlignerDoctorName,
      COUNT(b.AlignerBatchID) as TotalBatches,
      SUM(CASE WHEN b.DeliveredToPatientDate IS NOT NULL THEN 1 ELSE 0 END) as DeliveredBatches,
      vp.TotalPaid,
      vp.Balance,
      vp.PaymentStatus,
      (SELECT COUNT(*)
       FROM tblAlignerNotes n
       WHERE n.AlignerSetID = s.AlignerSetID
         AND n.NoteType = 'Doctor'
         AND n.IsRead = 0
      ) AS UnreadActivityCount
    FROM tblAlignerSets s
    LEFT JOIN tblAlignerBatches b ON s.AlignerSetID = b.AlignerSetID
    LEFT JOIN AlignerDoctors ad ON s.AlignerDrID = ad.DrID
    LEFT JOIN vw_AlignerSetPayments vp ON s.AlignerSetID = vp.AlignerSetID
    WHERE s.WorkID = @workId
    GROUP BY
      s.AlignerSetID, s.WorkID, s.SetSequence, s.Type,
      s.UpperAlignersCount, s.LowerAlignersCount,
      s.RemainingUpperAligners, s.RemainingLowerAligners,
      s.CreationDate, s.Days, s.IsActive, s.Notes,
      s.FolderPath, s.AlignerDrID, s.SetUrl, s.SetPdfUrl,
      s.SetVideo, s.SetCost, s.Currency, ad.DoctorName,
      vp.TotalPaid, vp.Balance, vp.PaymentStatus
    ORDER BY s.SetSequence
  `;

  return executeQuery<AlignerSetWithDetails>(
    query,
    [['workId', TYPES.Int, workId]],
    (columns: ColumnValue[]) => ({
      AlignerSetID: columns[0].value as number,
      WorkID: columns[1].value as number,
      SetSequence: columns[2].value as number | null,
      Type: columns[3].value as string | null,
      UpperAlignersCount: columns[4].value as number,
      LowerAlignersCount: columns[5].value as number,
      RemainingUpperAligners: columns[6].value as number,
      RemainingLowerAligners: columns[7].value as number,
      CreationDate: columns[8].value as Date,
      Days: columns[9].value as number | null,
      IsActive: columns[10].value as boolean,
      Notes: columns[11].value as string | null,
      FolderPath: columns[12].value as string | null,
      AlignerDrID: columns[13].value as number,
      SetUrl: columns[14].value as string | null,
      SetPdfUrl: columns[15].value as string | null,
      SetVideo: columns[16].value as string | null,
      SetCost: columns[17].value as number | null,
      Currency: columns[18].value as string | null,
      AlignerDoctorName: columns[19].value as string | null,
      TotalBatches: columns[20].value as number,
      DeliveredBatches: columns[21].value as number,
      TotalPaid: columns[22].value as number | null,
      Balance: columns[23].value as number | null,
      PaymentStatus: columns[24].value as string | null,
      UnreadActivityCount: (columns[25].value as number) || 0,
    })
  );
}

/**
 * Get a single aligner set by ID
 */
export async function getAlignerSetById(setId: number): Promise<AlignerSet | null> {
  const query = `
    SELECT
      AlignerSetID, WorkID, SetSequence, Type,
      UpperAlignersCount, LowerAlignersCount,
      RemainingUpperAligners, RemainingLowerAligners,
      CreationDate, Days, IsActive, Notes,
      FolderPath, AlignerDrID, SetUrl, SetPdfUrl,
      SetVideo, SetCost, Currency
    FROM tblAlignerSets
    WHERE AlignerSetID = @setId
  `;

  const result = await executeQuery<AlignerSet>(
    query,
    [['setId', TYPES.Int, setId]],
    (columns: ColumnValue[]) => ({
      AlignerSetID: columns[0].value as number,
      WorkID: columns[1].value as number,
      SetSequence: columns[2].value as number | null,
      Type: columns[3].value as string | null,
      UpperAlignersCount: columns[4].value as number,
      LowerAlignersCount: columns[5].value as number,
      RemainingUpperAligners: columns[6].value as number,
      RemainingLowerAligners: columns[7].value as number,
      CreationDate: columns[8].value as Date,
      Days: columns[9].value as number | null,
      IsActive: columns[10].value as boolean,
      Notes: columns[11].value as string | null,
      FolderPath: columns[12].value as string | null,
      AlignerDrID: columns[13].value as number,
      SetUrl: columns[14].value as string | null,
      SetPdfUrl: columns[15].value as string | null,
      SetVideo: columns[16].value as string | null,
      SetCost: columns[17].value as number | null,
      Currency: columns[18].value as string | null,
    })
  );

  return result && result.length > 0 ? result[0] : null;
}

/**
 * Create a new aligner set with business logic
 * Deactivates other sets if creating an active set
 */
export async function createAlignerSet(setData: AlignerSetData): Promise<number | null> {
  const startTime = Date.now();
  const {
    WorkID,
    SetSequence,
    Type,
    UpperAlignersCount,
    LowerAlignersCount,
    Days,
    AlignerDrID,
    SetUrl,
    SetPdfUrl,
    SetCost,
    Currency,
    Notes,
    IsActive,
  } = setData;

  const afterExtraction = Date.now();
  log.debug(`[DB QUERY TIMING] Parameter extraction took: ${afterExtraction - startTime}ms`);

  const query = `
    DECLARE @OutputTable TABLE (AlignerSetID INT);

    -- Deactivate all other sets for this work if creating an active set
    IF @IsActive = 1
    BEGIN
      UPDATE tblAlignerSets
      SET IsActive = 0
      WHERE WorkID = @WorkID AND IsActive = 1;
    END

    -- Insert new set with remaining aligners = total aligners
    INSERT INTO tblAlignerSets (
      WorkID, SetSequence, Type, UpperAlignersCount, LowerAlignersCount,
      RemainingUpperAligners, RemainingLowerAligners, Days, AlignerDrID,
      SetUrl, SetPdfUrl, SetCost, Currency, Notes, IsActive, CreationDate
    )
    OUTPUT INSERTED.AlignerSetID INTO @OutputTable
    VALUES (
      @WorkID, @SetSequence, @Type, @UpperAlignersCount, @LowerAlignersCount,
      @UpperAlignersCount, @LowerAlignersCount, @Days, @AlignerDrID,
      @SetUrl, @SetPdfUrl, @SetCost, @Currency, @Notes, @IsActive, GETDATE()
    );

    SELECT AlignerSetID FROM @OutputTable;
  `;

  const beforeExecute = Date.now();
  log.debug(`[DB QUERY TIMING] Query preparation took: ${beforeExecute - afterExtraction}ms`);

  const result = await executeQuery<number>(
    query,
    [
      ['WorkID', TYPES.Int, WorkID],
      ['SetSequence', TYPES.Int, SetSequence ?? null],
      ['Type', TYPES.NVarChar, Type || null],
      ['UpperAlignersCount', TYPES.Int, UpperAlignersCount ?? 0],
      ['LowerAlignersCount', TYPES.Int, LowerAlignersCount ?? 0],
      ['Days', TYPES.Int, Days ?? null],
      ['AlignerDrID', TYPES.Int, AlignerDrID],
      ['SetUrl', TYPES.NVarChar, SetUrl || null],
      ['SetPdfUrl', TYPES.NVarChar, SetPdfUrl || null],
      ['SetCost', TYPES.Decimal, SetCost ?? null],
      ['Currency', TYPES.NVarChar, Currency || null],
      ['Notes', TYPES.NVarChar, Notes || null],
      ['IsActive', TYPES.Bit, IsActive !== undefined ? IsActive : true],
    ],
    (columns: ColumnValue[]) => columns[0].value as number
  );

  const afterExecute = Date.now();
  log.debug(`[DB QUERY TIMING] SQL execution took: ${afterExecute - beforeExecute}ms`);
  log.debug(`[DB QUERY TIMING] Total createAlignerSet() took: ${afterExecute - startTime}ms`);

  return result && result.length > 0 ? result[0] : null;
}

/**
 * Update an aligner set
 */
export async function updateAlignerSet(
  setId: number,
  setData: AlignerSetUpdateData
): Promise<void> {
  const {
    SetSequence,
    Type,
    UpperAlignersCount,
    LowerAlignersCount,
    Days,
    AlignerDrID,
    SetUrl,
    SetPdfUrl,
    SetVideo,
    SetCost,
    Currency,
    Notes,
    IsActive,
  } = setData;

  const newUpperCount = UpperAlignersCount ?? 0;
  const newLowerCount = LowerAlignersCount ?? 0;

  // First, get current set data to validate the change
  const currentSet = await getAlignerSetById(setId);
  if (!currentSet) {
    throw new Error(`Aligner set ${setId} not found`);
  }

  // Calculate how many aligners are already used in batches
  const usedUpper = currentSet.UpperAlignersCount - currentSet.RemainingUpperAligners;
  const usedLower = currentSet.LowerAlignersCount - currentSet.RemainingLowerAligners;

  // Validate: new total cannot be less than what's already used in batches
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

  const query = `
    UPDATE tblAlignerSets
    SET
      SetSequence = @SetSequence,
      Type = @Type,
      RemainingUpperAligners = RemainingUpperAligners + (@UpperAlignersCount - UpperAlignersCount),
      RemainingLowerAligners = RemainingLowerAligners + (@LowerAlignersCount - LowerAlignersCount),
      UpperAlignersCount = @UpperAlignersCount,
      LowerAlignersCount = @LowerAlignersCount,
      Days = @Days,
      AlignerDrID = @AlignerDrID,
      SetUrl = @SetUrl,
      SetPdfUrl = @SetPdfUrl,
      SetVideo = @SetVideo,
      SetCost = @SetCost,
      Currency = @Currency,
      Notes = @Notes,
      IsActive = @IsActive
    WHERE AlignerSetID = @setId
  `;

  await executeQuery(query, [
    ['SetSequence', TYPES.Int, SetSequence ?? null],
    ['Type', TYPES.NVarChar, Type || null],
    ['UpperAlignersCount', TYPES.Int, newUpperCount],
    ['LowerAlignersCount', TYPES.Int, newLowerCount],
    ['Days', TYPES.Int, Days ?? null],
    ['AlignerDrID', TYPES.Int, AlignerDrID ?? null],
    ['SetUrl', TYPES.NVarChar, SetUrl || null],
    ['SetPdfUrl', TYPES.NVarChar, SetPdfUrl || null],
    ['SetVideo', TYPES.NVarChar, SetVideo || null],
    ['SetCost', TYPES.Decimal, SetCost ?? null],
    ['Currency', TYPES.NVarChar, Currency || null],
    ['Notes', TYPES.NVarChar, Notes || null],
    ['IsActive', TYPES.Bit, IsActive !== undefined ? IsActive : true],
    ['setId', TYPES.Int, setId],
  ]);
}

/**
 * Delete batches for a set
 */
export async function deleteBatchesBySetId(setId: number): Promise<void> {
  await executeQuery('DELETE FROM tblAlignerBatches WHERE AlignerSetID = @setId', [
    ['setId', TYPES.Int, setId],
  ]);
}

/**
 * Delete an aligner set
 */
export async function deleteAlignerSet(setId: number): Promise<void> {
  await executeQuery('DELETE FROM tblAlignerSets WHERE AlignerSetID = @setId', [
    ['setId', TYPES.Int, setId],
  ]);
}

// ==============================
// ALIGNER PATIENTS QUERIES
// ==============================

/**
 * Get all aligner patients (all doctors)
 */
export async function getAllAlignerPatients(): Promise<AlignerPatient[]> {
  const query = `
    SELECT DISTINCT
      p.PersonID,
      p.FirstName,
      p.LastName,
      p.PatientName,
      p.Phone,
      w.workid,
      wt.WorkType,
      w.Typeofwork as WorkTypeID,
      COUNT(DISTINCT s.AlignerSetID) as TotalSets,
      SUM(CASE WHEN s.IsActive = 1 THEN 1 ELSE 0 END) as ActiveSets
    FROM tblpatients p
    INNER JOIN tblwork w ON p.PersonID = w.PersonID
    INNER JOIN tblWorkType wt ON w.Typeofwork = wt.ID
    INNER JOIN tblAlignerSets s ON w.workid = s.WorkID
    WHERE wt.ID IN (19, 20, 21)
    GROUP BY
      p.PersonID, p.FirstName, p.LastName, p.PatientName,
      p.Phone, w.workid, wt.WorkType, w.Typeofwork
    ORDER BY p.PatientName, p.FirstName, p.LastName
  `;

  return executeQuery<AlignerPatient>(query, [], (columns: ColumnValue[]) => ({
    PersonID: columns[0].value as number,
    FirstName: columns[1].value as string | null,
    LastName: columns[2].value as string | null,
    PatientName: columns[3].value as string,
    Phone: columns[4].value as string | null,
    workid: columns[5].value as number,
    WorkType: columns[6].value as string,
    WorkTypeID: columns[7].value as number,
    TotalSets: columns[8].value as number,
    ActiveSets: columns[9].value as number,
  }));
}

/**
 * Get aligner patients by doctor ID
 */
export async function getAlignerPatientsByDoctor(doctorId: number): Promise<AlignerPatient[]> {
  const query = `
    SELECT DISTINCT
      p.PersonID,
      p.FirstName,
      p.LastName,
      p.PatientName,
      p.Phone,
      w.workid,
      wt.WorkType,
      w.Typeofwork as WorkTypeID,
      COUNT(DISTINCT s.AlignerSetID) as TotalSets,
      SUM(CASE WHEN s.IsActive = 1 THEN 1 ELSE 0 END) as ActiveSets,
      (SELECT COUNT(*)
       FROM tblAlignerNotes n
       INNER JOIN tblAlignerSets sets ON n.AlignerSetID = sets.AlignerSetID
       WHERE sets.WorkID = w.workid
         AND n.NoteType = 'Doctor'
         AND n.IsRead = 0
      ) AS UnreadDoctorNotes
    FROM tblpatients p
    INNER JOIN tblwork w ON p.PersonID = w.PersonID
    INNER JOIN tblWorkType wt ON w.Typeofwork = wt.ID
    INNER JOIN tblAlignerSets s ON w.workid = s.WorkID
    WHERE wt.ID IN (19, 20, 21)
      AND s.AlignerDrID = @doctorId
    GROUP BY
      p.PersonID, p.FirstName, p.LastName, p.PatientName,
      p.Phone, w.workid, wt.WorkType, w.Typeofwork
    ORDER BY p.PatientName, p.FirstName, p.LastName
  `;

  return executeQuery<AlignerPatient>(
    query,
    [['doctorId', TYPES.Int, doctorId]],
    (columns: ColumnValue[]) => ({
      PersonID: columns[0].value as number,
      FirstName: columns[1].value as string | null,
      LastName: columns[2].value as string | null,
      PatientName: columns[3].value as string,
      Phone: columns[4].value as string | null,
      workid: columns[5].value as number,
      WorkType: columns[6].value as string,
      WorkTypeID: columns[7].value as number,
      TotalSets: columns[8].value as number,
      ActiveSets: columns[9].value as number,
      UnreadDoctorNotes: (columns[10].value as number) || 0,
    })
  );
}

/**
 * Search for aligner patients
 */
export async function searchAlignerPatients(
  searchTerm: string,
  doctorId: number | null = null
): Promise<AlignerPatient[]> {
  let query = `
    SELECT DISTINCT
      p.PersonID,
      p.FirstName,
      p.LastName,
      p.PatientName,
      p.Phone,
      w.workid,
      wt.WorkType,
      w.Typeofwork as WorkTypeID
    FROM tblpatients p
    INNER JOIN tblwork w ON p.PersonID = w.PersonID
    INNER JOIN tblWorkType wt ON w.Typeofwork = wt.ID
    INNER JOIN tblAlignerSets s ON w.workid = s.WorkID
    WHERE wt.ID IN (19, 20, 21)
      AND (
        p.FirstName LIKE @search
        OR p.LastName LIKE @search
        OR p.PatientName LIKE @search
        OR p.Phone LIKE @search
        OR (p.FirstName + ' ' + p.LastName) LIKE @search
      )
  `;

  const params: SqlParam[] = [['search', TYPES.NVarChar, `%${searchTerm}%`]];

  if (doctorId && !isNaN(doctorId)) {
    query += ` AND s.AlignerDrID = @doctorId`;
    params.push(['doctorId', TYPES.Int, doctorId]);
  }

  query += ` ORDER BY p.FirstName, p.LastName`;

  return executeQuery<AlignerPatient>(query, params, (columns: ColumnValue[]) => ({
    PersonID: columns[0].value as number,
    FirstName: columns[1].value as string | null,
    LastName: columns[2].value as string | null,
    PatientName: columns[3].value as string,
    Phone: columns[4].value as string | null,
    workid: columns[5].value as number,
    WorkType: columns[6].value as string,
    WorkTypeID: columns[7].value as number,
  }));
}

// ==============================
// ALIGNER BATCHES QUERIES
// ==============================

/**
 * Get batches for a specific aligner set
 */
export async function getBatchesBySetId(setId: number): Promise<AlignerBatch[]> {
  const query = `
    SELECT
      AlignerBatchID,
      AlignerSetID,
      BatchSequence,
      UpperAlignerCount,
      LowerAlignerCount,
      UpperAlignerStartSequence,
      UpperAlignerEndSequence,
      LowerAlignerStartSequence,
      LowerAlignerEndSequence,
      CreationDate,
      ManufactureDate,
      DeliveredToPatientDate,
      Days,
      ValidityPeriod,
      BatchExpiryDate,
      Notes,
      IsActive,
      IsLast
    FROM tblAlignerBatches
    WHERE AlignerSetID = @setId
    ORDER BY BatchSequence
  `;

  return executeQuery<AlignerBatch>(
    query,
    [['setId', TYPES.Int, setId]],
    (columns: ColumnValue[]) => ({
      AlignerBatchID: columns[0].value as number,
      AlignerSetID: columns[1].value as number,
      BatchSequence: columns[2].value as number,
      UpperAlignerCount: columns[3].value as number,
      LowerAlignerCount: columns[4].value as number,
      UpperAlignerStartSequence: columns[5].value as number | null,
      UpperAlignerEndSequence: columns[6].value as number | null,
      LowerAlignerStartSequence: columns[7].value as number | null,
      LowerAlignerEndSequence: columns[8].value as number | null,
      CreationDate: columns[9].value as Date,
      ManufactureDate: columns[10].value as Date | null,
      DeliveredToPatientDate: columns[11].value as Date | null,
      Days: columns[12].value as number | null,
      ValidityPeriod: columns[13].value as number | null,
      BatchExpiryDate: columns[14].value as Date | null,
      Notes: columns[15].value as string | null,
      IsActive: columns[16].value as boolean,
      IsLast: columns[17].value as boolean,
    })
  );
}

/**
 * Create a new aligner batch using optimized stored procedure
 * Note: ManufactureDate and DeliveredToPatientDate are not set during creation
 * They should be set via usp_UpdateBatchStatus (MANUFACTURE/DELIVER actions)
 */
export async function createBatch(batchData: BatchData): Promise<number | null> {
  const {
    AlignerSetID,
    UpperAlignerCount,
    LowerAlignerCount,
    Days,
    Notes,
    IsActive,
    IncludeUpperTemplate,
    IncludeLowerTemplate,
    IsLast,
  } = batchData;

  const params: SqlParam[] = [
    ['AlignerSetID', TYPES.Int, AlignerSetID],
    ['UpperAlignerCount', TYPES.Int, UpperAlignerCount ?? 0],
    ['LowerAlignerCount', TYPES.Int, LowerAlignerCount ?? 0],
    ['ManufactureDate', TYPES.Date, null],  // Set via status endpoint
    ['DeliveredToPatientDate', TYPES.Date, null],  // Set via status endpoint
    ['Days', TYPES.Int, Days ?? null],
    ['Notes', TYPES.NVarChar, Notes || null],
    ['IsActive', TYPES.Bit, IsActive !== undefined ? IsActive : false],  // Default false, set when delivered
    ['IsLast', TYPES.Bit, IsLast !== undefined ? IsLast : false],
    ['IncludeUpperTemplate', TYPES.Bit, IncludeUpperTemplate !== undefined ? IncludeUpperTemplate : true],
    ['IncludeLowerTemplate', TYPES.Bit, IncludeLowerTemplate !== undefined ? IncludeLowerTemplate : true],
  ];

  // Add output parameter for NewBatchID
  const beforeExec = (request: TediousRequest) => {
    request.addOutputParameter('NewBatchID', TYPES.Int);
  };

  // Result mapper to extract output parameter
  const resultMapper = (
    _rows: unknown[],
    outParams: Array<{ parameterName: string; value: unknown }>
  ): number | null => {
    const newBatchIdParam = outParams.find((p) => p.parameterName === 'NewBatchID');
    return newBatchIdParam ? (newBatchIdParam.value as number) : null;
  };

  return executeStoredProcedure<unknown, number | null>(
    'usp_CreateAlignerBatch',
    params,
    beforeExec,
    undefined,
    resultMapper
  );
}

interface DeactivatedBatchRow {
  DeactivatedBatchID: number | null;
  DeactivatedBatchSequence: number | null;
}

/**
 * Update an aligner batch using optimized stored procedure
 * NOTE: ManufactureDate and DeliveredToPatientDate are managed via updateBatchStatus()
 */
export async function updateBatch(
  batchId: number,
  batchData: BatchUpdateData
): Promise<DeactivatedBatchInfo | null> {
  const {
    AlignerSetID,
    UpperAlignerCount,
    LowerAlignerCount,
    Notes,
    IsActive,
    Days,
    IsLast,
  } = batchData;

  const params: SqlParam[] = [
    ['AlignerBatchID', TYPES.Int, batchId],
    ['AlignerSetID', TYPES.Int, AlignerSetID],
    ['UpperAlignerCount', TYPES.Int, UpperAlignerCount ?? 0],
    ['LowerAlignerCount', TYPES.Int, LowerAlignerCount ?? 0],
    ['Days', TYPES.Int, Days ?? null],
    ['Notes', TYPES.NVarChar, Notes || null],
    ['IsActive', TYPES.Bit, IsActive !== undefined ? IsActive : null],
    ['IsLast', TYPES.Bit, IsLast !== undefined ? IsLast : null],
  ];

  // Row mapper for deactivated batch info (if SP returns a result set)
  const rowMapper = (columns: ColumnValue[]): DeactivatedBatchRow => ({
    DeactivatedBatchID:
      (columns.find((c) => c.metadata.colName === 'DeactivatedBatchID')?.value as number) || null,
    DeactivatedBatchSequence:
      (columns.find((c) => c.metadata.colName === 'DeactivatedBatchSequence')?.value as number) ||
      null,
  });

  const result = await executeStoredProcedure<DeactivatedBatchRow>(
    'usp_UpdateAlignerBatch',
    params,
    undefined,
    rowMapper
  );

  // Return deactivated batch info if present
  if (result && result.length > 0 && result[0].DeactivatedBatchID) {
    return {
      deactivatedBatch: {
        batchId: result[0].DeactivatedBatchID,
        batchSequence: result[0].DeactivatedBatchSequence!,
      },
    };
  }

  return null;
}

/**
 * Update batch status using consolidated stored procedure
 *
 * Actions:
 * - MANUFACTURE: Sets ManufactureDate = @targetDate or GETDATE()
 *                If @targetDate provided and already manufactured, updates date
 * - DELIVER: Sets DeliveredToPatientDate = @targetDate or GETDATE()
 *            BatchExpiryDate is auto-computed from DeliveredToPatientDate + (Days * AlignerCount)
 *            If batch is latest (highest BatchSequence) AND not already active:
 *            - Deactivates other batches in the set
 *            - Activates this batch
 * - UNDO_MANUFACTURE: Clears ManufactureDate (requires batch not yet delivered)
 * - UNDO_DELIVERY: Clears DeliveredToPatientDate (BatchExpiryDate auto-clears as computed)
 *
 * @param batchId - The batch ID to update
 * @param action - The action to perform
 * @param targetDate - Optional date for backdating/correction. If null, uses GETDATE()
 * @returns Result with operation info and activation status
 */
export async function updateBatchStatus(
  batchId: number,
  action: 'MANUFACTURE' | 'DELIVER' | 'UNDO_MANUFACTURE' | 'UNDO_DELIVERY',
  targetDate?: Date | null
): Promise<UpdateBatchStatusResult> {
  const params: SqlParam[] = [
    ['AlignerBatchID', TYPES.Int, batchId],
    ['Action', TYPES.VarChar, action],
    ['TargetDate', TYPES.DateTime, targetDate || null],
  ];

  const rowMapper = (columns: ColumnValue[]): UpdateBatchStatusRow => ({
    AlignerBatchID: columns.find((c) => c.metadata.colName === 'AlignerBatchID')?.value as number,
    BatchSequence: columns.find((c) => c.metadata.colName === 'BatchSequence')?.value as number,
    AlignerSetID: columns.find((c) => c.metadata.colName === 'AlignerSetID')?.value as number,
    ActionPerformed: columns.find((c) => c.metadata.colName === 'ActionPerformed')?.value as string,
    Success: columns.find((c) => c.metadata.colName === 'Success')?.value as boolean,
    Message: columns.find((c) => c.metadata.colName === 'Message')?.value as string,
    WasActivated: columns.find((c) => c.metadata.colName === 'WasActivated')?.value as boolean,
    WasAlreadyActive: columns.find((c) => c.metadata.colName === 'WasAlreadyActive')?.value as boolean,
    WasAlreadyDelivered: columns.find((c) => c.metadata.colName === 'WasAlreadyDelivered')?.value as boolean,
    PreviouslyActiveBatchSequence: columns.find((c) => c.metadata.colName === 'PreviouslyActiveBatchSequence')
      ?.value as number | null,
  });

  const resultMapper = (rows: UpdateBatchStatusRow[]): UpdateBatchStatusResult => {
    if (!rows || rows.length === 0) {
      throw new Error('No result returned from stored procedure');
    }

    const row = rows[0];
    return {
      batchId: row.AlignerBatchID,
      batchSequence: row.BatchSequence,
      setId: row.AlignerSetID,
      action: row.ActionPerformed,
      success: row.Success,
      message: row.Message,
      wasActivated: row.WasActivated,
      wasAlreadyActive: row.WasAlreadyActive,
      wasAlreadyDelivered: row.WasAlreadyDelivered,
      previouslyActiveBatchSequence: row.PreviouslyActiveBatchSequence,
    };
  };

  return executeStoredProcedure<UpdateBatchStatusRow, UpdateBatchStatusResult>(
    'usp_UpdateBatchStatus',
    params,
    undefined,
    rowMapper,
    resultMapper
  );
}

/**
 * Mark batch as delivered using consolidated stored procedure
 * @deprecated Use updateBatchStatus(batchId, 'DELIVER') instead
 */
export async function markBatchAsDelivered(
  batchId: number
): Promise<MarkBatchDeliveredResult> {
  const result = await updateBatchStatus(batchId, 'DELIVER');
  // Map to legacy result format for backwards compatibility
  return {
    batchId: result.batchId,
    batchSequence: result.batchSequence,
    alignerSetId: result.setId,
    wasActivated: result.wasActivated,
    wasAlreadyActive: result.wasAlreadyActive,
    wasAlreadyDelivered: result.wasAlreadyDelivered,
    previouslyActiveBatchSequence: result.previouslyActiveBatchSequence,
  };
}

/**
 * Mark batch as manufactured (sets ManufactureDate to today)
 * @deprecated Use updateBatchStatus(batchId, 'MANUFACTURE') instead
 */
export async function markBatchAsManufactured(batchId: number): Promise<UpdateBatchStatusResult> {
  return updateBatchStatus(batchId, 'MANUFACTURE');
}

/**
 * Undo manufacture - clears ManufactureDate
 * @deprecated Use updateBatchStatus(batchId, 'UNDO_MANUFACTURE') instead
 */
export async function undoManufactureBatch(batchId: number): Promise<UpdateBatchStatusResult> {
  return updateBatchStatus(batchId, 'UNDO_MANUFACTURE');
}

/**
 * Undo delivery - clears DeliveredToPatientDate and BatchExpiryDate
 * @deprecated Use updateBatchStatus(batchId, 'UNDO_DELIVERY') instead
 */
export async function undoDeliverBatch(batchId: number): Promise<UpdateBatchStatusResult> {
  return updateBatchStatus(batchId, 'UNDO_DELIVERY');
}

/**
 * Delete a batch using optimized stored procedure
 */
export async function deleteBatch(batchId: number): Promise<void> {
  await executeStoredProcedure('usp_DeleteAlignerBatch', [['AlignerBatchID', TYPES.Int, batchId]]);
}

// ==============================
// ALIGNER NOTES QUERIES
// ==============================

/**
 * Get notes for an aligner set
 */
export async function getNotesBySetId(setId: number): Promise<AlignerNote[]> {
  const query = `
    SELECT
      n.NoteID,
      n.AlignerSetID,
      n.NoteType,
      n.NoteText,
      n.CreatedAt,
      n.IsEdited,
      n.EditedAt,
      n.IsRead,
      d.DoctorName
    FROM tblAlignerNotes n
    INNER JOIN tblAlignerSets s ON n.AlignerSetID = s.AlignerSetID
    INNER JOIN AlignerDoctors d ON s.AlignerDrID = d.DrID
    WHERE n.AlignerSetID = @setId
    ORDER BY n.CreatedAt DESC
  `;

  return executeQuery<AlignerNote>(
    query,
    [['setId', TYPES.Int, setId]],
    (columns: ColumnValue[]) => ({
      NoteID: columns[0].value as number,
      AlignerSetID: columns[1].value as number,
      NoteType: columns[2].value as 'Lab' | 'Doctor',
      NoteText: columns[3].value as string,
      CreatedAt: columns[4].value as Date,
      IsEdited: columns[5].value as boolean,
      EditedAt: columns[6].value as Date | null,
      IsRead: columns[7].value as boolean,
      DoctorName: columns[8].value as string,
    })
  );
}

/**
 * Check if aligner set exists
 */
export async function alignerSetExists(setId: number): Promise<boolean> {
  const result = await executeQuery<number>(
    'SELECT AlignerSetID FROM tblAlignerSets WHERE AlignerSetID = @setId',
    [['setId', TYPES.Int, setId]],
    (columns: ColumnValue[]) => columns[0].value as number
  );

  return result && result.length > 0;
}

/**
 * Create a note
 */
export async function createNote(
  setId: number,
  noteText: string,
  noteType: 'Lab' | 'Doctor' = 'Lab'
): Promise<number | null> {
  const insertQuery = `
    INSERT INTO tblAlignerNotes (AlignerSetID, NoteType, NoteText)
    VALUES (@setId, @noteType, @noteText);
    SELECT SCOPE_IDENTITY() AS NoteID;
  `;

  const result = await executeQuery<number>(
    insertQuery,
    [
      ['setId', TYPES.Int, setId],
      ['noteType', TYPES.NVarChar, noteType],
      ['noteText', TYPES.NVarChar, noteText.trim()],
    ],
    (columns: ColumnValue[]) => columns[0].value as number
  );

  return result && result.length > 0 ? result[0] : null;
}

interface NoteInfo {
  NoteID: number;
  NoteType: 'Lab' | 'Doctor';
}

/**
 * Check if note exists
 */
export async function getNoteById(noteId: number): Promise<NoteInfo | null> {
  const result = await executeQuery<NoteInfo>(
    'SELECT NoteID, NoteType FROM tblAlignerNotes WHERE NoteID = @noteId',
    [['noteId', TYPES.Int, noteId]],
    (columns: ColumnValue[]) => ({
      NoteID: columns[0].value as number,
      NoteType: columns[1].value as 'Lab' | 'Doctor',
    })
  );

  return result && result.length > 0 ? result[0] : null;
}

/**
 * Update a note
 */
export async function updateNote(noteId: number, noteText: string): Promise<void> {
  await executeQuery(
    `UPDATE tblAlignerNotes
     SET NoteText = @noteText, IsEdited = 1, EditedAt = GETDATE()
     WHERE NoteID = @noteId`,
    [
      ['noteId', TYPES.Int, noteId],
      ['noteText', TYPES.NVarChar, noteText.trim()],
    ]
  );
}

/**
 * Toggle note read status
 */
export async function toggleNoteReadStatus(noteId: number): Promise<void> {
  await executeQuery(
    'UPDATE tblAlignerNotes SET IsRead = CASE WHEN IsRead = 1 THEN 0 ELSE 1 END WHERE NoteID = @noteId',
    [['noteId', TYPES.Int, noteId]]
  );
}

/**
 * Delete a note
 */
export async function deleteNote(noteId: number): Promise<void> {
  await executeQuery('DELETE FROM tblAlignerNotes WHERE NoteID = @noteId', [
    ['noteId', TYPES.Int, noteId],
  ]);
}

/**
 * Get note read status
 */
export async function getNoteReadStatus(noteId: number): Promise<boolean | null> {
  const result = await executeQuery<boolean>(
    'SELECT IsRead FROM tblAlignerNotes WHERE NoteID = @noteId',
    [['noteId', TYPES.Int, noteId]],
    (columns: ColumnValue[]) => columns[0].value as boolean
  );

  return result && result.length > 0 ? result[0] : null;
}

// ==============================
// ALIGNER ACTIVITY FLAGS QUERIES
// ==============================

/**
 * Get unread activities for a set
 */
export async function getUnreadActivitiesBySetId(setId: number): Promise<AlignerActivity[]> {
  const query = `
    SELECT
      ActivityID,
      AlignerSetID,
      ActivityType,
      ActivityDescription,
      CreatedAt,
      IsRead,
      ReadAt,
      RelatedRecordID
    FROM tblAlignerActivityFlags
    WHERE AlignerSetID = @setId AND IsRead = 0
    ORDER BY CreatedAt DESC
  `;

  return executeQuery<AlignerActivity>(
    query,
    [['setId', TYPES.Int, setId]],
    (columns: ColumnValue[]) => ({
      ActivityID: columns[0].value as number,
      AlignerSetID: columns[1].value as number,
      ActivityType: columns[2].value as string,
      ActivityDescription: columns[3].value as string,
      CreatedAt: columns[4].value as Date,
      IsRead: columns[5].value as boolean,
      ReadAt: columns[6].value as Date | null,
      RelatedRecordID: columns[7].value as number | null,
    })
  );
}

/**
 * Mark an activity as read
 */
export async function markActivityAsRead(activityId: number): Promise<void> {
  await executeQuery(
    'UPDATE tblAlignerActivityFlags SET IsRead = 1, ReadAt = GETDATE() WHERE ActivityID = @activityId',
    [['activityId', TYPES.Int, activityId]]
  );
}

/**
 * Mark all activities for a set as read
 */
export async function markAllActivitiesAsRead(setId: number): Promise<void> {
  await executeQuery(
    'UPDATE tblAlignerActivityFlags SET IsRead = 1, ReadAt = GETDATE() WHERE AlignerSetID = @setId AND IsRead = 0',
    [['setId', TYPES.Int, setId]]
  );
}

// ==============================
// ALIGNER PAYMENTS QUERIES
// ==============================

/**
 * Add payment for an aligner set
 */
export async function createAlignerPayment(
  paymentData: AlignerPaymentData
): Promise<number | null> {
  const { workid, AlignerSetID, Amountpaid, Dateofpayment, ActualAmount, ActualCur, Change } =
    paymentData;

  // Determine USD vs IQD based on currency (default to USD for aligner payments)
  const currency = ActualCur || 'USD';
  const parsedAmount = typeof Amountpaid === 'string' ? parseFloat(Amountpaid) : Amountpaid;
  const amount = Math.round(parsedAmount); // Round to integer for USDReceived/IQDReceived columns
  const usdReceived = currency === 'USD' ? amount : 0;
  const iqdReceived = currency === 'IQD' ? amount : 0;

  log.info('Creating aligner payment', {
    workid,
    AlignerSetID,
    Amountpaid,
    currency,
    usdReceived,
    iqdReceived,
  });

  const query = `
    INSERT INTO tblInvoice (workid, Amountpaid, Dateofpayment, ActualAmount, ActualCur, Change, AlignerSetID, USDReceived, IQDReceived)
    VALUES (@workid, @Amountpaid, @Dateofpayment, @ActualAmount, @ActualCur, @Change, @AlignerSetID, @USDReceived, @IQDReceived);
    SELECT SCOPE_IDENTITY() AS invoiceID;
  `;

  const result = await executeQuery<number>(
    query,
    [
      ['workid', TYPES.Int, workid],
      ['Amountpaid', TYPES.Decimal, Amountpaid],
      ['Dateofpayment', TYPES.Date, new Date(Dateofpayment as string)],
      ['ActualAmount', TYPES.Decimal, ActualAmount ?? null],
      ['ActualCur', TYPES.NVarChar, ActualCur || null],
      ['Change', TYPES.Decimal, Change ?? null],
      ['AlignerSetID', TYPES.Int, AlignerSetID || null],
      ['USDReceived', TYPES.Int, usdReceived],
      ['IQDReceived', TYPES.Int, iqdReceived],
    ],
    (columns: ColumnValue[]) => columns[0].value as number
  );

  return result && result.length > 0 ? result[0] : null;
}

/**
 * Get aligner set balance information for validation
 */
export async function getAlignerSetBalance(alignerSetId: number): Promise<AlignerSetBalance | null> {
  const query = `
    SELECT AlignerSetID, SetCost, TotalPaid, Balance
    FROM vw_AlignerSetPayments
    WHERE AlignerSetID = @alignerSetId
  `;

  const result = await executeQuery<AlignerSetBalance>(
    query,
    [['alignerSetId', TYPES.Int, alignerSetId]],
    (columns: ColumnValue[]) => ({
      AlignerSetID: columns[0].value as number,
      SetCost: columns[1].value as number | null,
      TotalPaid: columns[2].value as number | null,
      Balance: columns[3].value as number | null,
    })
  );

  return result && result.length > 0 ? result[0] : null;
}

// ==============================
// LABEL GENERATION QUERIES
// ==============================

/**
 * Get a single batch by ID
 */
export async function getBatchById(batchId: number): Promise<AlignerBatch[]> {
  const query = `
    SELECT
      AlignerBatchID,
      AlignerSetID,
      BatchSequence,
      UpperAlignerCount,
      LowerAlignerCount,
      UpperAlignerStartSequence,
      UpperAlignerEndSequence,
      LowerAlignerStartSequence,
      LowerAlignerEndSequence,
      CreationDate,
      ManufactureDate,
      DeliveredToPatientDate,
      Days,
      Notes,
      IsActive,
      IsLast
    FROM tblAlignerBatches
    WHERE AlignerBatchID = @batchId
  `;

  return executeQuery<AlignerBatch>(
    query,
    [['batchId', TYPES.Int, batchId]],
    (columns: ColumnValue[]) => ({
      AlignerBatchID: columns[0].value as number,
      AlignerSetID: columns[1].value as number,
      BatchSequence: columns[2].value as number,
      UpperAlignerCount: columns[3].value as number,
      LowerAlignerCount: columns[4].value as number,
      UpperAlignerStartSequence: columns[5].value as number | null,
      UpperAlignerEndSequence: columns[6].value as number | null,
      LowerAlignerStartSequence: columns[7].value as number | null,
      LowerAlignerEndSequence: columns[8].value as number | null,
      CreationDate: columns[9].value as Date,
      ManufactureDate: columns[10].value as Date | null,
      DeliveredToPatientDate: columns[11].value as Date | null,
      Days: columns[12].value as number | null,
      ValidityPeriod: null,
      BatchExpiryDate: null,
      Notes: columns[13].value as string | null,
      IsActive: columns[14].value as boolean,
      IsLast: columns[15].value as boolean,
    })
  );
}

/**
 * Get a single doctor by ID
 */
export async function getDoctorById(drId: number): Promise<AlignerDoctor[]> {
  const query = `
    SELECT DrID, DoctorName, DoctorEmail, LogoPath
    FROM AlignerDoctors
    WHERE DrID = @drId
  `;

  return executeQuery<AlignerDoctor>(
    query,
    [['drId', TYPES.Int, drId]],
    (columns: ColumnValue[]) => ({
      DrID: columns[0].value as number,
      DoctorName: columns[1].value as string,
      DoctorEmail: columns[2].value as string | null,
      LogoPath: columns[3].value as string | null,
    })
  );
}
