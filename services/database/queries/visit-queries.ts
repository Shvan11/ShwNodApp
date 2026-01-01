/**
 * Visit and wire-related database queries
 */
import type { ColumnValue } from '../../../types/database.types.js';
import { executeQuery, executeStoredProcedure, TYPES } from '../index.js';
import { getActiveWID } from './patient-queries.js';

// Type definitions
interface VisitSummary {
  PatientName: string;
  WorkID: number;
  ID: number;
  VisitDate: Date;
  OPG: boolean;
  IPhoto: boolean;
  FPhoto: boolean;
  PPhoto: boolean;
  ApplianceRemoved: boolean;
  Summary: string | null;
}

interface LatestVisitSummary {
  VisitDate: Date;
  Summary: string | null;
}

interface Wire {
  id: number;
  name: string;
}

interface LatestWire {
  upperWireID: number | null;
  lowerWireID: number | null;
}

interface LatestWireDetails {
  UpperWireID: number | null;
  UpperWireName: string | null;
  LowerWireID: number | null;
  LowerWireName: string | null;
}

interface VisitDetails {
  visitDate: Date;
  upperWireID: number | null;
  lowerWireID: number | null;
  others: string | null;
  next: string | null;
}

interface Visit {
  ID: number;
  WorkID: number;
  VisitDate: Date;
  BracketChange: string | null;
  WireBending: string | null;
  OPG: boolean;
  Others: string | null;
  NextVisit: string | null;
  Elastics: string | null;
  UpperWireID: number | null;
  LowerWireID: number | null;
  PPhoto: boolean;
  IPhoto: boolean;
  FPhoto: boolean;
  ApplianceRemoved: boolean;
  OperatorID: number | null;
  UpperWireName: string | null;
  LowerWireName: string | null;
  OperatorName: string | null;
}

interface VisitData {
  WorkID: number;
  VisitDate: Date;
  BracketChange?: string;
  WireBending?: string;
  OPG?: boolean;
  Others?: string;
  NextVisit?: string;
  Elastics?: string;
  UpperWireID?: number;
  LowerWireID?: number;
  PPhoto?: boolean;
  IPhoto?: boolean;
  FPhoto?: boolean;
  ApplianceRemoved?: boolean;
  OperatorID?: number;
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

/**
 * Retrieves visit summaries for a given patient ID.
 */
export async function getVisitsSummary(PID: number): Promise<VisitSummary[]> {
  const WID = await getActiveWID(PID);
  return executeStoredProcedure<VisitSummary>(
    'ProVisitSum',
    [['WID', TYPES.Int, WID]],
    undefined,
    (columns: ColumnValue[]) => ({
      PatientName: columns[0].value as string,
      WorkID: columns[1].value as number,
      ID: columns[2].value as number,
      VisitDate: columns[3].value as Date,
      OPG: columns[4].value as boolean,
      IPhoto: columns[5].value as boolean,
      FPhoto: columns[6].value as boolean,
      PPhoto: columns[7].value as boolean,
      ApplianceRemoved: columns[8].value as boolean,
      Summary: columns[9].value as string | null,
    })
  );
}

/**
 * Retrieves the latest visit summary for a given patient ID.
 */
export async function getLatestVisitsSum(PID: number): Promise<LatestVisitSummary | undefined> {
  const WID = await getActiveWID(PID);
  return executeStoredProcedure<LatestVisitSummary, LatestVisitSummary | undefined>(
    'ProlatestVisitSum',
    [['WID', TYPES.Int, WID]],
    undefined,
    (columns: ColumnValue[]) => ({
      VisitDate: columns[0].value as Date,
      Summary: columns[1].value as string | null,
    }),
    (result) => result[0]
  );
}

/**
 * Adds a new visit for a given patient ID.
 */
export async function addVisit(
  PID: number,
  visitDate: Date,
  upperWireID: number,
  lowerWireID: number,
  others: string,
  next: string
): Promise<boolean> {
  const WID = await getActiveWID(PID);
  return executeStoredProcedure<unknown, boolean>(
    'proAddVisit',
    [
      ['WID', TYPES.Int, WID],
      ['visitDate', TYPES.Date, visitDate],
      ['upperWireID', TYPES.Int, upperWireID],
      ['lowerWireID', TYPES.Int, lowerWireID],
      ['others', TYPES.NVarChar, others],
      ['next', TYPES.NVarChar, next],
    ],
    undefined,
    undefined,
    () => true
  );
}

/**
 * Retrieves visit details by visit ID.
 */
export async function getVisitDetailsByID(VID: number): Promise<VisitDetails | undefined> {
  return executeStoredProcedure<VisitDetails, VisitDetails | undefined>(
    'proGetVisitSum',
    [['VID', TYPES.Int, VID]],
    undefined,
    (columns: ColumnValue[]) => ({
      visitDate: columns[0].value as Date,
      upperWireID: columns[1].value as number | null,
      lowerWireID: columns[2].value as number | null,
      others: columns[3].value as string | null,
      next: columns[4].value as string | null,
    }),
    (result) => result[0]
  );
}

/**
 * Updates a visit by visit ID.
 */
export async function updateVisit(
  VID: number,
  visitDate: Date,
  upperWireID: number,
  lowerWireID: number,
  others: string,
  next: string
): Promise<{ success: boolean }> {
  return executeQuery<unknown, { success: boolean }>(
    `UPDATE dbo.tblVisits
     SET VisitDate = @visitDate, UpperWireID = @upperWireID, LowerWireID = @lowerWireID, Others = @others, NextVisit = @next
     WHERE ID = @VID`,
    [
      ['VID', TYPES.Int, VID],
      ['visitDate', TYPES.Date, visitDate],
      ['upperWireID', TYPES.Int, upperWireID],
      ['lowerWireID', TYPES.Int, lowerWireID],
      ['others', TYPES.NVarChar, others],
      ['next', TYPES.NVarChar, next],
    ],
    () => ({}),
    () => ({ success: true })
  );
}

/**
 * Deletes a visit by visit ID.
 */
export async function deleteVisit(VID: number): Promise<{ success: boolean }> {
  return executeQuery<unknown, { success: boolean }>(
    'DELETE FROM dbo.tblVisits WHERE ID = @VID',
    [['VID', TYPES.Int, VID]],
    () => ({}),
    () => ({ success: true })
  );
}

/**
 * Retrieves available wires.
 */
export function getWires(): Promise<Wire[]> {
  return executeQuery<Wire>(
    'SELECT Wire_ID as id, Wire as name FROM dbo.tblWires ORDER BY Wire',
    [],
    (columns: ColumnValue[]) => ({
      id: columns[0].value as number,
      name: columns[1].value as string,
    })
  );
}

/**
 * Retrieves the latest wire IDs for a given patient ID.
 */
export async function getLatestWire(PID: number): Promise<LatestWire | null> {
  const WID = await getActiveWID(PID);
  return executeStoredProcedure<LatestWire, LatestWire | null>(
    'proGetLatestWire',
    [['WID', TYPES.Int, WID]],
    undefined,
    (columns: ColumnValue[]) => ({
      upperWireID: columns[0].value as number | null,
      lowerWireID: columns[1].value as number | null,
    }),
    (result) => (result && result.length > 0 ? result[0] : null)
  );
}

/**
 * Retrieves the latest wire details (ID and name) for a given work ID.
 */
export async function getLatestWiresByWorkId(workId: number): Promise<LatestWireDetails> {
  return executeQuery<LatestWireDetails, LatestWireDetails>(
    `SELECT
      uw.Wire_ID as UpperWireID,
      uw.Wire as UpperWireName,
      lw.Wire_ID as LowerWireID,
      lw.Wire as LowerWireName
    FROM dbo.qryLastUWire uw
    FULL OUTER JOIN dbo.qryLastLWire lw ON uw.WorkID = lw.WorkID
    WHERE COALESCE(uw.WorkID, lw.WorkID) = @WorkID`,
    [['WorkID', TYPES.Int, workId]],
    (columns: ColumnValue[]) => ({
      UpperWireID: columns[0].value as number | null,
      UpperWireName: columns[1].value as string | null,
      LowerWireID: columns[2].value as number | null,
      LowerWireName: columns[3].value as string | null,
    }),
    (result) =>
      result && result.length > 0
        ? result[0]
        : { UpperWireID: null, UpperWireName: null, LowerWireID: null, LowerWireName: null }
  );
}

/**
 * Retrieves all visits for a specific work ID (not dependent on active work).
 */
export async function getVisitsByWorkId(workId: number): Promise<Visit[]> {
  return executeQuery<Visit>(
    `SELECT
      v.ID,
      v.WorkID,
      v.VisitDate,
      v.BracketChange,
      v.WireBending,
      v.OPG,
      v.Others,
      v.NextVisit,
      v.Elastics,
      v.UpperWireID,
      v.LowerWireID,
      v.PPhoto,
      v.IPhoto,
      v.FPhoto,
      v.ApplianceRemoved,
      v.OperatorID,
      uw.Wire as UpperWireName,
      lw.Wire as LowerWireName,
      e.employeeName as OperatorName
    FROM tblvisits v
    LEFT JOIN tblWires uw ON v.UpperWireID = uw.Wire_ID
    LEFT JOIN tblWires lw ON v.LowerWireID = lw.Wire_ID
    LEFT JOIN tblEmployees e ON v.OperatorID = e.ID
    WHERE v.WorkID = @WorkID
    ORDER BY v.VisitDate ASC`,
    [['WorkID', TYPES.Int, workId]],
    mapRowToObject
  );
}

/**
 * Retrieves a single visit by visit ID.
 */
export async function getVisitById(visitId: number): Promise<Visit | null> {
  return executeQuery<Visit, Visit | null>(
    `SELECT
      v.ID,
      v.WorkID,
      v.VisitDate,
      v.BracketChange,
      v.WireBending,
      v.OPG,
      v.Others,
      v.NextVisit,
      v.Elastics,
      v.UpperWireID,
      v.LowerWireID,
      v.PPhoto,
      v.IPhoto,
      v.FPhoto,
      v.ApplianceRemoved,
      v.OperatorID,
      uw.Wire as UpperWireName,
      lw.Wire as LowerWireName,
      e.employeeName as OperatorName
    FROM tblvisits v
    LEFT JOIN tblWires uw ON v.UpperWireID = uw.Wire_ID
    LEFT JOIN tblWires lw ON v.LowerWireID = lw.Wire_ID
    LEFT JOIN tblEmployees e ON v.OperatorID = e.ID
    WHERE v.ID = @VisitID`,
    [['VisitID', TYPES.Int, visitId]],
    mapRowToObject,
    (results) => (results.length > 0 ? results[0] : null)
  );
}

/**
 * Adds a new visit with workId directly (not dependent on active work).
 */
export async function addVisitByWorkId(visitData: VisitData): Promise<{ ID: number } | null> {
  return executeQuery<{ ID: number }, { ID: number } | null>(
    `INSERT INTO tblvisits (
      WorkID, VisitDate, BracketChange, WireBending, OPG, Others,
      NextVisit, Elastics, UpperWireID, LowerWireID, PPhoto, IPhoto,
      FPhoto, ApplianceRemoved, OperatorID
    ) VALUES (
      @WorkID, @VisitDate, @BracketChange, @WireBending, @OPG, @Others,
      @NextVisit, @Elastics, @UpperWireID, @LowerWireID, @PPhoto, @IPhoto,
      @FPhoto, @ApplianceRemoved, @OperatorID
    );
    SELECT SCOPE_IDENTITY() as ID;`,
    [
      ['WorkID', TYPES.Int, visitData.WorkID],
      ['VisitDate', TYPES.DateTime2, visitData.VisitDate],
      ['BracketChange', TYPES.NVarChar, visitData.BracketChange || null],
      ['WireBending', TYPES.NVarChar, visitData.WireBending || null],
      ['OPG', TYPES.Bit, visitData.OPG || false],
      ['Others', TYPES.NVarChar, visitData.Others || null],
      ['NextVisit', TYPES.NVarChar, visitData.NextVisit || null],
      ['Elastics', TYPES.NVarChar, visitData.Elastics || null],
      ['UpperWireID', TYPES.Int, visitData.UpperWireID || null],
      ['LowerWireID', TYPES.Int, visitData.LowerWireID || null],
      ['PPhoto', TYPES.Bit, visitData.PPhoto || false],
      ['IPhoto', TYPES.Bit, visitData.IPhoto || false],
      ['FPhoto', TYPES.Bit, visitData.FPhoto || false],
      ['ApplianceRemoved', TYPES.Bit, visitData.ApplianceRemoved || false],
      ['OperatorID', TYPES.Int, visitData.OperatorID || null],
    ],
    (columns: ColumnValue[]) => ({ ID: columns[0].value as number }),
    (results) => (results.length > 0 ? results[0] : null)
  );
}

/**
 * Updates a visit by visit ID.
 */
export async function updateVisitByWorkId(
  visitId: number,
  visitData: Omit<VisitData, 'WorkID'>
): Promise<{ success: boolean }> {
  return executeQuery<unknown, { success: boolean }>(
    `UPDATE tblvisits SET
      VisitDate = @VisitDate,
      BracketChange = @BracketChange,
      WireBending = @WireBending,
      OPG = @OPG,
      Others = @Others,
      NextVisit = @NextVisit,
      Elastics = @Elastics,
      UpperWireID = @UpperWireID,
      LowerWireID = @LowerWireID,
      PPhoto = @PPhoto,
      IPhoto = @IPhoto,
      FPhoto = @FPhoto,
      ApplianceRemoved = @ApplianceRemoved,
      OperatorID = @OperatorID
    WHERE ID = @VisitID`,
    [
      ['VisitID', TYPES.Int, visitId],
      ['VisitDate', TYPES.DateTime2, visitData.VisitDate],
      ['BracketChange', TYPES.NVarChar, visitData.BracketChange || null],
      ['WireBending', TYPES.NVarChar, visitData.WireBending || null],
      ['OPG', TYPES.Bit, visitData.OPG || false],
      ['Others', TYPES.NVarChar, visitData.Others || null],
      ['NextVisit', TYPES.NVarChar, visitData.NextVisit || null],
      ['Elastics', TYPES.NVarChar, visitData.Elastics || null],
      ['UpperWireID', TYPES.Int, visitData.UpperWireID || null],
      ['LowerWireID', TYPES.Int, visitData.LowerWireID || null],
      ['PPhoto', TYPES.Bit, visitData.PPhoto || false],
      ['IPhoto', TYPES.Bit, visitData.IPhoto || false],
      ['FPhoto', TYPES.Bit, visitData.FPhoto || false],
      ['ApplianceRemoved', TYPES.Bit, visitData.ApplianceRemoved || false],
      ['OperatorID', TYPES.Int, visitData.OperatorID || null],
    ],
    () => ({}),
    () => ({ success: true })
  );
}

/**
 * Deletes a visit by visit ID.
 */
export async function deleteVisitByWorkId(visitId: number): Promise<{ success: boolean }> {
  return executeQuery<unknown, { success: boolean }>(
    'DELETE FROM tblvisits WHERE ID = @VisitID',
    [['VisitID', TYPES.Int, visitId]],
    () => ({}),
    () => ({ success: true })
  );
}
