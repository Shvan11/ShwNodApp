/**
 * Dolphin Imaging integration queries
 * Calls stored procedures in ShwanNew that operate on DolphinPlatform database
 */
import type { ColumnValue } from '../../../types/database.types.js';
import { executeQuery, executeStoredProcedure, TYPES } from '../index.js';

// Type definitions
interface PatientForDolphin {
  firstName: string | null;
  lastName: string | null;
  dob: Date | null;
  gender: number | null;
}

interface AppointmentForDolphin {
  date: Date;
  description: string;
}

interface VisitForDolphin {
  visitDate: Date;
  hasInitialPhoto: boolean | null;
  hasFinalPhoto: boolean | null;
  hasProgressPhoto: boolean | null;
}

/**
 * Check if patient exists in DolphinPlatform database
 */
export async function checkDolphinPatient(personId: string): Promise<string | null> {
  const result = await executeStoredProcedure<string>(
    'CheckDolphin',
    [['id', TYPES.VarChar, personId]],
    undefined,
    (columns: ColumnValue[]) => columns[0]?.value as string
  );
  return result[0] || null;
}

/**
 * Create patient in DolphinPlatform database
 */
export async function createDolphinPatient(
  firstName: string,
  lastName: string,
  dob: Date,
  personId: string,
  gender: string
): Promise<number> {
  const result = await executeStoredProcedure<number>(
    'AddDolph',
    [
      ['FN', TYPES.VarChar, firstName],
      ['LN', TYPES.VarChar, lastName],
      ['BD', TYPES.DateTime, dob],
      ['ID', TYPES.VarChar, personId],
      ['Ge', TYPES.Char, gender],
    ],
    undefined,
    (columns: ColumnValue[]) => columns[0]?.value as number
  );
  return result[0] || 0;
}

/**
 * Check if timepoint exists in DolphinPlatform
 */
export async function checkTimePoint(
  personId: string,
  tpName: string,
  tpDate: Date
): Promise<number> {
  const result = await executeStoredProcedure<number>(
    'ChkTimePoint',
    [
      ['ID', TYPES.VarChar, personId],
      ['TPName', TYPES.VarChar, tpName],
      ['TPDate', TYPES.DateTime, tpDate],
    ],
    undefined,
    (columns: ColumnValue[]) => columns[0]?.value as number
  );
  return result[0] ?? -1;
}

/**
 * Create timepoint in DolphinPlatform
 * Also updates tblwork.IPhotoDate/FPhotoDate for Initial/Final timepoints
 */
export async function createTimePoint(
  personId: string,
  tpName: string,
  tpDate: Date
): Promise<number> {
  const result = await executeStoredProcedure<number>(
    'AddTimePoint',
    [
      ['ID', TYPES.VarChar, personId],
      ['TPName', TYPES.VarChar, tpName],
      ['TPDate', TYPES.DateTime, tpDate],
    ],
    undefined,
    (columns: ColumnValue[]) => columns[0]?.value as number
  );
  return result?.[0] ?? 0;
}

/**
 * Get patient info needed for Dolphin integration
 */
export async function getPatientForDolphin(personId: string): Promise<PatientForDolphin | null> {
  const result = await executeQuery<PatientForDolphin>(
    `SELECT FirstName, LastName, DateOfBirth, Gender
     FROM dbo.tblpatients
     WHERE PersonID = @PID`,
    [['PID', TYPES.Int, parseInt(personId, 10)]],
    (columns: ColumnValue[]) => ({
      firstName: columns[0].value as string | null,
      lastName: columns[1].value as string | null,
      dob: columns[2].value as Date | null,
      gender: columns[3].value as number | null,
    })
  );
  return result[0] || null;
}

/**
 * Get appointments for date selection in photo import dialog
 */
export async function getAppointmentsForDolphin(
  personId: string
): Promise<AppointmentForDolphin[]> {
  return executeStoredProcedure<AppointmentForDolphin>(
    'ApposforOne',
    [['ID', TYPES.Int, parseInt(personId, 10)]],
    undefined,
    (columns: ColumnValue[]) => ({
      date: columns[0].value as Date,
      description: (columns[1]?.value as string) || '',
    })
  );
}

/**
 * Get visits with photo dates for date selection
 */
export async function getVisitsForDolphin(personId: string): Promise<VisitForDolphin[]> {
  return executeStoredProcedure<VisitForDolphin>(
    'VisitsPhotoforOne',
    [['ID', TYPES.Int, parseInt(personId, 10)]],
    undefined,
    (columns: ColumnValue[]) => ({
      visitDate: columns[0].value as Date,
      hasInitialPhoto: columns[1]?.value as boolean | null,
      hasFinalPhoto: columns[2]?.value as boolean | null,
      hasProgressPhoto: columns[3]?.value as boolean | null,
    })
  );
}
