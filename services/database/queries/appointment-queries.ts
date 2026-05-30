/**
 * Appointment-related database queries (PostgreSQL / Kysely).
 *
 * Phase 5: the four stored procs (PTodayAppsWeb, UpdatePresent, UndoAppointmentState,
 * GetDailyAppointmentsOptimized) are reimplemented as typed Kysely queries; the T-SQL time
 * formatting + state-machine validation now live in TS. UpdatePresent keeps its row-lock
 * (SELECT … FOR UPDATE) + state-transition guards inside one transaction.
 */
import { sql } from 'kysely';
import { getKysely, withPgTransaction } from '../kysely.js';

// Type definitions
export interface AppointmentRow {
  Num: number;
  apptime: string;
  PatientType: string;
  PatientName: string;
  AppDetail: string;
  Present: string | null;
  Seated: string | null;
  Dismissed: string | null;
  HasVisit: boolean;
  appointmentID: number;
  PersonID?: number;
  Phone?: string | null;
  Notes?: string | null;
  DrID?: number | null;
  WorkID?: number | null;
}

interface AppointmentStats {
  all: number;
  present: number;
  waiting: number;
  completed: number;
  seated?: number;
  dismissed?: number;
}

interface AppointmentsResponse extends AppointmentStats {
  appointments: AppointmentRow[];
}

interface UpdatePresentResult {
  success: boolean;
  appointmentID: number;
  state: string;
  time: string;
}

interface UndoStateResult {
  appointmentID: number;
  stateCleared: string;
  success: boolean;
}

/**
 * Daily appointments optimized result set
 */
export interface DailyAppointmentStats {
  total: number;
  checkedIn: number;
  absent: number;
  waiting: number;
  seated?: number;
  dismissed?: number;
  present?: number;
  completed?: number;
}

export interface DailyAppointmentsOptimizedResult {
  allAppointments: Record<string, unknown>[];
  checkedInAppointments: Record<string, unknown>[];
  stats: DailyAppointmentStats;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** FORMAT(dt, 'hh:mm' [+ ' tt']) — 12-hour clock, leading-zero hour. */
function fmtClock(date: Date, withMeridiem: boolean): string {
  const h = date.getHours();
  const base = `${pad2(h % 12 || 12)}:${pad2(date.getMinutes())}`;
  return withMeridiem ? `${base} ${h < 12 ? 'AM' : 'PM'}` : base;
}

/** Format a PG `time` value ('HH:MM:SS' string) as 'hh:mm' (12-hour leading-zero). */
function fmtTimeStr(t: string | null): string | null {
  if (!t) return null;
  const [hh, mm] = t.split(':');
  const h = parseInt(hh, 10);
  return `${pad2(h % 12 || 12)}:${mm}`;
}

function isMidnight(date: Date): boolean {
  return date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0;
}

function toDateStr(d: Date | string): string {
  return typeof d === 'string' ? d.slice(0, 10) : `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Retrieves checked-in (present, not dismissed) appointments for a date + the day's counts.
 * (was: PTodayAppsWeb — note its result placed PersonID in the `pid`/appointmentID slot; preserved.)
 */
export async function getPresentAps(PDate: string): Promise<AppointmentsResponse> {
  const dateStr = toDateStr(PDate);
  const db = getKysely();

  const rows = await db
    .selectFrom('tblappointments as a')
    .innerJoin('tblpatients as p', 'p.PersonID', 'a.PersonID')
    .leftJoin('tblPatientType as pt', 'pt.ID', 'p.PatientTypeID')
    .where('a.AppDay', '=', sql<Date>`${dateStr}::date`)
    .where('a.Present', 'is not', null)
    .where('a.Dismissed', 'is', null)
    .orderBy('a.Present')
    .select([
      'a.appointmentID', 'a.PersonID', 'a.AppDate', 'a.Present', 'a.Seated', 'a.Dismissed',
      'a.AppDetail', 'p.PatientName', 'pt.PatientType',
      sql<boolean>`EXISTS(SELECT 1 FROM "tblwork" w JOIN "tblvisits" v ON v."WorkID"=w."workid" WHERE w."PersonID"=a."PersonID" AND v."VisitDate"=${dateStr}::date)`.as('hasVisit'),
    ])
    .execute();

  const appointments: AppointmentRow[] = rows.map((r, i) => {
    const appDate = r.AppDate as unknown as Date;
    return {
      Num: i + 1,
      apptime: isMidnight(appDate) ? (null as unknown as string) : fmtClock(appDate, false),
      PatientType: r.PatientType ?? '',
      PatientName: r.PatientName,
      AppDetail: r.AppDetail ?? '',
      Present: fmtTimeStr(r.Present as string | null),
      Seated: fmtTimeStr(r.Seated as string | null),
      Dismissed: fmtTimeStr(r.Dismissed as string | null),
      HasVisit: r.hasVisit,
      appointmentID: r.PersonID, // preserves the proc's `pid AS <last col>` (consumer reads it here)
    };
  });

  const counts = await db
    .selectFrom('tblappointments')
    .where('AppDay', '=', sql<Date>`${dateStr}::date`)
    .select((eb) => [
      eb.fn.countAll<number>().as('all'),
      eb.fn.sum<number>(sql`CASE WHEN "Present" IS NOT NULL THEN 1 ELSE 0 END`).as('present'),
      eb.fn.sum<number>(sql`CASE WHEN "Present" IS NOT NULL AND "Seated" IS NULL THEN 1 ELSE 0 END`).as('waiting'),
      eb.fn.sum<number>(sql`CASE WHEN "Dismissed" IS NOT NULL THEN 1 ELSE 0 END`).as('completed'),
    ])
    .executeTakeFirst();

  return {
    appointments,
    all: Number(counts?.all ?? 0),
    present: Number(counts?.present ?? 0),
    waiting: Number(counts?.waiting ?? 0),
    completed: Number(counts?.completed ?? 0),
  };
}

/**
 * Updates patient appointment state (Present, Seated, Dismissed) with transition guards.
 * (was: UpdatePresent — row-locked, transactional; throws on an invalid transition.)
 */
export async function updatePresent(
  Aid: number,
  state: string,
  Tim: string
): Promise<UpdatePresentResult> {
  await withPgTransaction(async (trx) => {
    const row = await trx
      .selectFrom('tblappointments')
      .select(['Present', 'Seated', 'Dismissed'])
      .where('appointmentID', '=', Aid)
      .forUpdate()
      .executeTakeFirst();

    if (!row) throw new Error('Appointment not found');
    const present = row.Present as string | null;
    const seated = row.Seated as string | null;
    const dismissed = row.Dismissed as string | null;
    const now = new Date();

    if (state === 'Present') {
      if (present !== null || seated !== null || dismissed !== null) {
        throw new Error('[INVALID_STATE_TRANSITION] Cannot check in: patient is already checked in, seated, or dismissed');
      }
      await trx.updateTable('tblappointments').set({ Present: Tim, LastUpdated: now }).where('appointmentID', '=', Aid).execute();
    } else if (state === 'Seated') {
      if (present === null) throw new Error('[INVALID_STATE_TRANSITION] Cannot seat: patient is not checked in');
      if (seated !== null) throw new Error('[INVALID_STATE_TRANSITION] Cannot seat: patient is already seated');
      if (dismissed !== null) throw new Error('[INVALID_STATE_TRANSITION] Cannot seat: patient is already dismissed');
      await trx.updateTable('tblappointments').set({ Seated: Tim, LastUpdated: now }).where('appointmentID', '=', Aid).execute();
    } else if (state === 'Dismissed') {
      if (seated === null) throw new Error('[INVALID_STATE_TRANSITION] Cannot dismiss: patient is not seated');
      if (dismissed !== null) throw new Error('[INVALID_STATE_TRANSITION] Cannot dismiss: patient is already dismissed');
      await trx.updateTable('tblappointments').set({ Dismissed: Tim, LastUpdated: now }).where('appointmentID', '=', Aid).execute();
    } else {
      throw new Error('Invalid state parameter. Must be Present, Seated, or Dismissed.');
    }
  });
  return { success: true, appointmentID: Aid, state, time: Tim };
}

/**
 * Undo appointment state by setting the field to NULL, with reverse-transition guards.
 * (was: UndoAppointmentState)
 */
export async function undoAppointmentState(
  appointmentID: number,
  stateField: string
): Promise<UndoStateResult> {
  if (stateField !== 'Present' && stateField !== 'Seated' && stateField !== 'Dismissed') {
    throw new Error('Invalid state field. Must be Present, Seated, or Dismissed.');
  }

  await withPgTransaction(async (trx) => {
    const row = await trx
      .selectFrom('tblappointments')
      .select(['Present', 'Seated', 'Dismissed'])
      .where('appointmentID', '=', appointmentID)
      .forUpdate()
      .executeTakeFirst();

    const seated = (row?.Seated as string | null) ?? null;
    const dismissed = (row?.Dismissed as string | null) ?? null;
    if (stateField === 'Present' && seated !== null) throw new Error('Cannot undo check-in: Patient is already seated');
    if (stateField === 'Seated' && dismissed !== null) throw new Error('Cannot undo seated: Patient visit is already completed');

    const set =
      stateField === 'Present' ? { Present: null } : stateField === 'Seated' ? { Seated: null } : { Dismissed: null };
    await trx.updateTable('tblappointments').set(set).where('appointmentID', '=', appointmentID).execute();
  });

  return { appointmentID, stateCleared: stateField, success: true };
}

/**
 * Get daily appointments (was: GetDailyAppointmentsOptimized — 3 result sets folded into one query).
 * `allAppointments` = absent (Present IS NULL), `checkedInAppointments` = Present IS NOT NULL,
 * plus aggregate stats — preserving the proc's exact column names per set.
 */
export async function getDailyAppointmentsOptimized(
  AppsDate: Date | string
): Promise<DailyAppointmentsOptimizedResult> {
  const dateStr = toDateStr(AppsDate);

  const base = await getKysely()
    .selectFrom('tblappointments as a')
    .innerJoin('tblpatients as p', 'p.PersonID', 'a.PersonID')
    .leftJoin('tblPatientType as pt', 'pt.ID', 'p.PatientTypeID')
    .where('a.AppDay', '=', sql<Date>`${dateStr}::date`)
    .select([
      'a.appointmentID', 'a.PersonID', 'a.AppDetail', 'a.Present', 'a.Seated', 'a.Dismissed',
      'a.AppDate', 'a.AppCost', 'p.PatientName', 'pt.PatientType',
      sql<boolean>`EXISTS(SELECT 1 FROM "tblAlerts" al WHERE al."PersonID"=p."PersonID" AND al."IsActive"=true)`.as('hasActiveAlert'),
      sql<boolean>`COALESCE((SELECT (w."Typeofwork" IN (1,2,11,19,20)) FROM "tblwork" w WHERE w."PersonID"=a."PersonID" AND w."Status"=1 LIMIT 1), false)`.as('isOrthoVisit'),
      sql<boolean>`EXISTS(SELECT 1 FROM "tblwork" w2 JOIN "tblvisits" vis ON vis."WorkID"=w2."workid" WHERE w2."PersonID"=a."PersonID" AND vis."VisitDate"=${dateStr}::date)`.as('hasVisit'),
    ])
    .execute();

  const enriched = base.map((r) => {
    const appDate = r.AppDate as unknown as Date;
    return {
      ...r,
      appDate,
      apptime: isMidnight(appDate) ? null : fmtClock(appDate, true),
      presentTime: fmtTimeStr(r.Present as string | null),
      seatedTime: fmtTimeStr(r.Seated as string | null),
      dismissedTime: fmtTimeStr(r.Dismissed as string | null),
    };
  });

  // Result set 1 (proc names it as `allAppointments`): absent — Present IS NULL.
  const allAppointments = enriched
    .filter((r) => r.Present === null)
    .sort((a, b) => {
      const am = isMidnight(a.appDate) ? 1 : 0;
      const bm = isMidnight(b.appDate) ? 1 : 0;
      return am - bm || a.appDate.getTime() - b.appDate.getTime();
    })
    .map((r) => ({
      appointmentID: r.appointmentID,
      PersonID: r.PersonID,
      AppDetail: r.AppDetail,
      AppDate: r.appDate,
      PatientType: r.PatientType,
      PatientName: r.PatientName,
      hasActiveAlert: r.hasActiveAlert,
      apptime: r.apptime,
    }));

  // Result set 2: checked-in — Present IS NOT NULL, ordered by presentTime.
  const checkedInAppointments = enriched
    .filter((r) => r.Present !== null)
    .sort((a, b) => (a.presentTime ?? '').localeCompare(b.presentTime ?? ''))
    .map((r) => ({
      appointmentID: r.appointmentID,
      PersonID: r.PersonID,
      AppDetail: r.AppDetail,
      PresentTime: r.presentTime,
      SeatedTime: r.seatedTime,
      DismissedTime: r.dismissedTime,
      AppDate: r.appDate,
      AppCost: r.AppCost,
      apptime: r.apptime,
      PatientType: r.PatientType,
      PatientName: r.PatientName,
      hasActiveAlert: r.hasActiveAlert,
      HasVisit: r.hasVisit,
      IsOrthoVisit: r.isOrthoVisit,
    }));

  const total = enriched.length;
  const checkedIn = checkedInAppointments.length;
  const stats: DailyAppointmentStats = {
    total,
    checkedIn,
    absent: total - checkedIn,
    waiting: enriched.filter((r) => r.Present !== null && r.Seated === null && r.Dismissed === null).length,
  };

  return { allAppointments, checkedInAppointments, stats };
}

export interface AppointmentNotificationRow {
  AppointmentID: number;
  AppDate: Date;
  PatientName: string;
  Phone: string | null;
  PersonID: number;
}

/**
 * Insert an appointment (+ AppoPatientType trigger). Returns the new appointmentID.
 *
 * Replaces the raw T-SQL inserts in AppointmentService (which used `CAST(.. AS datetime2)`,
 * `SCOPE_IDENTITY()` and `GETDATE()` — none valid in PG). AppoPatientType: when the new
 * appointment has a real (non-midnight) time and the patient is type 4, promote them to type 3.
 *
 * @param AppDate ISO datetime string ('YYYY-MM-DDTHH:MM:SS'); bound to the `timestamp` column.
 * @param Present optional 'HH:MM:SS' check-in time (quick check-in path).
 */
export async function createAppointment(data: {
  PersonID: number;
  AppDate: string;
  AppDetail: string | null;
  DrID: number | null;
  Present?: string | null;
}): Promise<number> {
  return withPgTransaction(async (trx) => {
    const row = await trx
      .insertInto('tblappointments')
      .values({
        PersonID: data.PersonID,
        AppDate: data.AppDate,
        AppDetail: data.AppDetail,
        DrID: data.DrID,
        Present: data.Present ?? null,
        LastUpdated: new Date(),
      })
      .returning('appointmentID')
      .executeTakeFirstOrThrow();

    // AppoPatientType: promote a type-4 patient to type 3 on a timed appointment.
    const timePart = data.AppDate.includes('T') ? data.AppDate.split('T')[1] : data.AppDate.split(' ')[1];
    const isMidnightAppt = !timePart || /^00:00(:00)?/.test(timePart);
    if (!isMidnightAppt) {
      const patient = await trx
        .selectFrom('tblpatients')
        .select('PatientTypeID')
        .where('PersonID', '=', data.PersonID)
        .executeTakeFirst();
      if (patient?.PatientTypeID === 4) {
        await trx.updateTable('tblpatients').set({ PatientTypeID: 3 }).where('PersonID', '=', data.PersonID).execute();
      }
    }

    return row.appointmentID;
  });
}

export interface AppointmentWithPhone {
  appointmentID: number | null;
  PersonID: number | null;
  AppDetail: string;
  AppDay: string;
  PatientType: string;
  PatientName: string;
  Phone: string;
  apptime: string;
  employeeName: string;
}

/**
 * Not-yet-present appointments for a date with patient/type/phone/doctor. (was: ProAppsPhones)
 * Used by the appointment-list PDF generator.
 */
export async function getAppointmentsWithPhones(date: string): Promise<AppointmentWithPhone[]> {
  const dateStr = toDateStr(date);
  const rows = await getKysely()
    .selectFrom('tblappointments as a')
    .innerJoin('tblpatients as p', 'p.PersonID', 'a.PersonID')
    .leftJoin('tblPatientType as pt', 'pt.ID', 'p.PatientTypeID')
    .leftJoin('tblEmployees as e', 'e.ID', 'a.DrID')
    .where('a.AppDay', '=', sql<Date>`${dateStr}::date`)
    .where('a.Present', 'is', null)
    .orderBy('a.AppDate')
    .select([
      'a.appointmentID', 'a.PersonID', 'a.AppDetail',
      sql<string>`to_char(a."AppDay", 'YYYY-MM-DD')`.as('AppDay'),
      'pt.PatientType', 'p.PatientName', 'p.Phone',
      sql<string>`to_char(a."AppDate", 'HH12:MI')`.as('apptime'),
      'e.employeeName',
    ])
    .execute();
  return rows.map((r) => ({
    appointmentID: r.appointmentID ?? null,
    PersonID: r.PersonID ?? null,
    AppDetail: r.AppDetail ?? '',
    AppDay: r.AppDay ?? '',
    PatientType: r.PatientType ?? '',
    PatientName: r.PatientName ?? '',
    Phone: r.Phone ?? '',
    apptime: r.apptime ?? '',
    employeeName: r.employeeName ?? '',
  }));
}

export async function getAppointmentForNotification(
  appointmentId: number
): Promise<AppointmentNotificationRow | null> {
  const row = await getKysely()
    .selectFrom('tblappointments as a')
    .innerJoin('tblpatients as p', 'p.PersonID', 'a.PersonID')
    .where('a.appointmentID', '=', appointmentId)
    .select(['a.appointmentID as AppointmentID', 'a.AppDate', 'p.PatientName', 'p.Phone', 'p.PersonID'])
    .executeTakeFirst();
  return (row as AppointmentNotificationRow | undefined) ?? null;
}
