/**
 * Photo-session preparation queries (ShwanNew only).
 *
 * Helpers behind the native photo editor's prepare/render + date-picker flow:
 * patient lookup, tblwork Initial/Final photo-date conflict read/override, and the
 * appointment/visit lists used to suggest session dates. None of these touch
 * DolphinPlatform.
 */
import { getKysely } from '../kysely.js';
import { toDateOnly } from '../../../utils/date.js';
import { getActiveWID } from './patient-queries.js';

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
  const row = await getKysely()
    .selectFrom('tblpatients')
    .where('PersonID', '=', parseInt(personId, 10))
    .select((eb) => [
      'FirstName as firstName',
      'LastName as lastName',
      eb.ref('DateofBirth').as('dob'),
      'Gender as gender',
    ])
    .executeTakeFirst();
  return (row as PatientForPhotoSession | undefined) ?? null;
}

/**
 * Get appointments for date selection in the photo-session dialog.
 */
export async function getPhotoSessionAppointments(
  personId: string
): Promise<PhotoSessionAppointment[]> {
  // was: ApposforOne — `SELECT CAST(AppDate AS date) ... ORDER BY AppDate DESC`. The proc returned
  // only the date, so `description` was always '' (the old positional mapper read a non-existent
  // 2nd column). Preserved verbatim. `AppDay` is the generated `AppDate::date` column.
  const rows = await getKysely()
    .selectFrom('tblappointments')
    .where('PersonID', '=', parseInt(personId, 10))
    .orderBy('AppDate', 'desc')
    .select('AppDay')
    .execute();
  return rows.map((r) => ({ date: r.AppDay as unknown as Date, description: '' }));
}

/**
 * Get visits with photo flags for date selection. (was: VisitsPhotoforOne)
 *
 * Deviation (flagged for Phase 7): the old positional mapper read the proc's columns in the wrong
 * order (proc emitted `Type, VisitDate`; the mapper assigned col0→visitDate, col1→hasInitialPhoto…),
 * so the mssql result was effectively garbage (a string in `visitDate`). This returns the
 * interface-correct result the field names intend: the photo-bearing visits of the active work
 * with each visit's real date and photo flags.
 */
export async function getPhotoSessionVisits(personId: string): Promise<PhotoSessionVisit[]> {
  const WID = await getActiveWID(parseInt(personId, 10));
  if (WID == null) return [];
  const rows = await getKysely()
    .selectFrom('tblvisits')
    .where('WorkID', '=', WID)
    .where((eb) => eb.or([eb('IPhoto', '=', true), eb('FPhoto', '=', true), eb('PPhoto', '=', true)]))
    .orderBy('VisitDate')
    .select(['VisitDate', 'IPhoto', 'FPhoto', 'PPhoto'])
    .execute();
  return rows.map((r) => ({
    visitDate: r.VisitDate as unknown as Date,
    hasInitialPhoto: r.IPhoto,
    hasFinalPhoto: r.FPhoto,
    hasProgressPhoto: r.PPhoto,
  }));
}

/**
 * Get existing IPhotoDate/FPhotoDate from tblwork for conflict detection.
 */
export async function getExistingPhotoDate(personId: string): Promise<ExistingPhotoDate | null> {
  // IPhotoDate/FPhotoDate are PG `date` → 'YYYY-MM-DD' strings at runtime (typed Date
  // by codegen; declared ExistingPhotoDate types preserved). Phase 6/7 consumer review.
  const row = await getKysely()
    .selectFrom('tblwork')
    .where('PersonID', '=', parseInt(personId, 10))
    .where('Status', '=', 1)
    .select(['IPhotoDate as iPhotoDate', 'FPhotoDate as fPhotoDate'])
    .executeTakeFirst();
  return (row as ExistingPhotoDate | undefined) ?? null;
}

/**
 * Update IPhotoDate or FPhotoDate in tblwork (override existing date).
 */
export async function updatePhotoDate(
  personId: string,
  field: 'IPhotoDate' | 'FPhotoDate',
  newDate: Date
): Promise<void> {
  const pid = parseInt(personId, 10);
  // Date-only column; bind a 'YYYY-MM-DD' string to avoid a UTC midnight shift.
  const dateStr = toDateOnly(newDate);
  const q = getKysely().updateTable('tblwork').where('PersonID', '=', pid).where('Status', '=', 1);
  await (field === 'IPhotoDate' ? q.set({ IPhotoDate: dateStr }) : q.set({ FPhotoDate: dateStr })).execute();
}
