/**
 * Photo-session preparation queries (ShwanNew only).
 *
 * Helpers behind the native photo editor's prepare/render + date-picker flow:
 * patient lookup, tblwork Initial/Final photo-date conflict read/override, and the
 * appointment/visit lists used to suggest session dates. None of these touch
 * DolphinPlatform.
 */
import type { ColumnValue } from '../../../types/database.types.js';
import { executeQuery, executeStoredProcedure, TYPES } from '../index.js';

// Type definitions
interface PatientForPhotoSession {
  firstName: string | null;
  lastName: string | null;
  dob: Date | null;
  gender: number | null;
}

interface PhotoSessionAppointment {
  date: Date;
  description: string;
}

interface PhotoSessionVisit {
  visitDate: Date;
  hasInitialPhoto: boolean | null;
  hasFinalPhoto: boolean | null;
  hasProgressPhoto: boolean | null;
}

interface ExistingPhotoDate {
  iPhotoDate: Date | null;
  fPhotoDate: Date | null;
}

/**
 * Get patient info needed to prepare a photo session.
 */
export async function getPatientForPhotoSession(
  personId: string
): Promise<PatientForPhotoSession | null> {
  const result = await executeQuery<PatientForPhotoSession>(
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
 * Get appointments for date selection in the photo-session dialog.
 */
export async function getPhotoSessionAppointments(
  personId: string
): Promise<PhotoSessionAppointment[]> {
  return executeStoredProcedure<PhotoSessionAppointment>(
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
 * Get visits with photo flags for date selection.
 */
export async function getPhotoSessionVisits(personId: string): Promise<PhotoSessionVisit[]> {
  return executeStoredProcedure<PhotoSessionVisit>(
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

/**
 * Get existing IPhotoDate/FPhotoDate from tblwork for conflict detection.
 */
export async function getExistingPhotoDate(personId: string): Promise<ExistingPhotoDate | null> {
  const result = await executeQuery<ExistingPhotoDate>(
    `SELECT IPhotoDate, FPhotoDate
     FROM dbo.tblwork
     WHERE PersonID = @PID AND Status = 1`,
    [['PID', TYPES.Int, parseInt(personId, 10)]],
    (columns: ColumnValue[]) => ({
      iPhotoDate: columns[0].value as Date | null,
      fPhotoDate: columns[1].value as Date | null,
    })
  );
  return result[0] || null;
}

/**
 * Update IPhotoDate or FPhotoDate in tblwork (override existing date).
 */
export async function updatePhotoDate(
  personId: string,
  field: 'IPhotoDate' | 'FPhotoDate',
  newDate: Date
): Promise<void> {
  await executeQuery(
    `UPDATE dbo.tblwork
     SET ${field} = @NewDate
     WHERE PersonID = @PID AND Status = 1`,
    [
      ['PID', TYPES.Int, parseInt(personId, 10)],
      ['NewDate', TYPES.DateTime, newDate],
    ]
  );
}
