/**
 * Photo-session preparation queries (ShwanNew only).
 *
 * Helpers behind the native photo editor's prepare/render + date-picker flow:
 * patient lookup, tblwork Initial/Final photo-date conflict read/override, and the
 * appointment/visit lists used to suggest session dates. None of these touch
 * DolphinPlatform.
 */
import { sql } from 'kysely';
import { getKysely } from '../kysely.js';
import { toDateOnly } from '../../../utils/date.js';
import { getActiveWID } from './patient-queries.js';

// type definitions
interface PatientForPhotoSession {
  firstName: string | null;
  lastName: string | null;
  patientName: string | null;
  dob: string | null;
  gender: number | null;
}

type PhotoSessionAppointment = {
  date: string;
  description: string;
};

type PhotoSessionVisit = {
  visitDate: string;
  hasInitialPhoto: boolean | null;
  hasFinalPhoto: boolean | null;
  hasProgressPhoto: boolean | null;
};

interface ExistingPhotoDate {
  iPhotoDate: string | null;
  fPhotoDate: string | null;
}

/**
 * Get patient info needed to prepare a photo session.
 */
export async function getPatientForPhotoSession(
  personId: string
): Promise<PatientForPhotoSession | null> {
  const row = await getKysely()
    .selectFrom('patients')
    .where('person_id', '=', parseInt(personId, 10))
    .select((eb) => [
      'first_name as firstName',
      'last_name as lastName',
      'patient_name as patientName',
      eb.ref('date_of_birth').as('dob'),
      'gender as gender',
    ])
    .executeTakeFirst();
  return (row as PatientForPhotoSession | undefined) ?? null;
}

/**
 * Fill a patient's English first/last name — but ONLY the columns still empty. Feeds the
 * create-patient background transliteration (Dolphin's patient-name columns are varchar/Latin1
 * and corrupt Arabic to '?', so patients need a Latin name for the sync to be searchable).
 * That backfill can land minutes late on Gemini retries, so it must never clobber a name the
 * front desk typed in the meantime: each column keeps its existing non-empty value atomically,
 * and the WHERE skips the write entirely (no updated_at/CDC churn) when both are already set.
 */
export async function fillMissingPatientName(
  personId: string,
  firstName: string,
  lastName: string
): Promise<void> {
  await getKysely()
    .updateTable('patients')
    .set({
      first_name: sql<string>`coalesce(nullif(first_name, ''), ${firstName})`,
      last_name: sql<string>`coalesce(nullif(last_name, ''), ${lastName})`,
    })
    .where('person_id', '=', parseInt(personId, 10))
    .where((eb) =>
      eb.or([
        eb('first_name', 'is', null),
        eb('first_name', '=', ''),
        eb('last_name', 'is', null),
        eb('last_name', '=', ''),
      ])
    )
    .execute();
}

/**
 * Get appointments for date selection in the photo-session dialog.
 */
export async function getPhotoSessionAppointments(
  personId: string
): Promise<PhotoSessionAppointment[]> {
  // was: ApposforOne — `SELECT CAST(app_date AS date) ... ORDER BY app_date DESC`. The proc returned
  // only the date, so `description` was always '' (the old positional mapper read a non-existent
  // 2nd column). Preserved verbatim. `app_day` is the generated `app_date::date` column.
  const rows = await getKysely()
    .selectFrom('appointments')
    .where('person_id', '=', parseInt(personId, 10))
    .orderBy('app_date', 'desc')
    .select('app_day')
    .execute();
  return rows.map((r) => ({ date: r.app_day as string, description: '' }));
}

/**
 * Get visits with photo flags for date selection. (was: VisitsPhotoforOne)
 *
 * Deviation (flagged for Phase 7): the old positional mapper read the proc's columns in the wrong
 * order (proc emitted `type, visit_date`; the mapper assigned col0→visitDate, col1→hasInitialPhoto…),
 * so the mssql result was effectively garbage (a string in `visitDate`). This returns the
 * interface-correct result the field names intend: the photo-bearing visits of the active work
 * with each visit's real date and photo flags.
 */
export async function getPhotoSessionVisits(personId: string): Promise<PhotoSessionVisit[]> {
  const WID = await getActiveWID(parseInt(personId, 10));
  if (WID == null) return [];
  const rows = await getKysely()
    .selectFrom('visits')
    .where('work_id', '=', WID)
    .where((eb) => eb.or([eb('i_photo', '=', true), eb('f_photo', '=', true), eb('p_photo', '=', true)]))
    .orderBy('visit_date')
    .select(['visit_date', 'i_photo', 'f_photo', 'p_photo'])
    .execute();
  return rows.map((r) => ({
    visitDate: r.visit_date,
    hasInitialPhoto: r.i_photo,
    hasFinalPhoto: r.f_photo,
    hasProgressPhoto: r.p_photo,
  }));
}

/**
 * Get existing i_photo_date/f_photo_date from tblwork for conflict detection.
 */
export async function getExistingPhotoDate(personId: string): Promise<ExistingPhotoDate | null> {
  // i_photo_date/f_photo_date are PG `date` → 'YYYY-MM-DD' strings at runtime; codegen
  // types them `string`, and ExistingPhotoDate matches (`string | null`).
  const row = await getKysely()
    .selectFrom('works')
    .where('person_id', '=', parseInt(personId, 10))
    .where('status', '=', 1)
    .select(['i_photo_date as iPhotoDate', 'f_photo_date as fPhotoDate'])
    .executeTakeFirst();
  return (row as ExistingPhotoDate | undefined) ?? null;
}

/**
 * Update i_photo_date or f_photo_date in tblwork (override existing date).
 */
export async function updatePhotoDate(
  personId: string,
  field: 'i_photo_date' | 'f_photo_date',
  newDate: Date
): Promise<void> {
  const pid = parseInt(personId, 10);
  // Date-only column; bind a 'YYYY-MM-DD' string to avoid a UTC midnight shift.
  const dateStr = toDateOnly(newDate);
  const q = getKysely().updateTable('works').where('person_id', '=', pid).where('status', '=', 1);
  await (field === 'i_photo_date' ? q.set({ i_photo_date: dateStr }) : q.set({ f_photo_date: dateStr })).execute();
}
