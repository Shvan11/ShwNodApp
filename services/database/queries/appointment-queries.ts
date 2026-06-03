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

// type definitions
export interface AppointmentRow {
  Num: number;
  apptime: string;
  patient_type: string;
  patient_name: string;
  app_detail: string;
  present: string | null;
  seated: string | null;
  dismissed: string | null;
  HasVisit: boolean;
  appointment_id: number;
  person_id?: number;
  phone?: string | null;
  notes?: string | null;
  dr_id?: number | null;
  work_id?: number | null;
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
  appointment_id: number;
  state: string;
  time: string;
}

interface UndoStateResult {
  appointment_id: number;
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
 * (was: PTodayAppsWeb — note its result placed person_id in the `pid`/appointmentID slot; preserved.)
 */
export async function getPresentAps(PDate: string): Promise<AppointmentsResponse> {
  const dateStr = toDateStr(PDate);
  const db = getKysely();

  const rows = await db
    .selectFrom('appointments as a')
    .innerJoin('patients as p', 'p.person_id', 'a.person_id')
    .leftJoin('patient_types as pt', 'pt.id', 'p.patient_type_id')
    .where('a.app_day', '=', sql<string>`${dateStr}::date`)
    .where('a.present', 'is not', null)
    .where('a.dismissed', 'is', null)
    .orderBy('a.present')
    .select([
      'a.appointment_id', 'a.person_id', 'a.app_date', 'a.present', 'a.seated', 'a.dismissed',
      'a.app_detail', 'p.patient_name', 'pt.patient_type',
      sql<boolean>`EXISTS(SELECT 1 FROM "works" w JOIN "visits" v ON v."work_id"=w."work_id" WHERE w."person_id"=a."person_id" AND v."visit_date"=${dateStr}::date)`.as('hasVisit'),
    ])
    .execute();

  const appointments: AppointmentRow[] = rows.map((r, i) => {
    const appDate = r.app_date as unknown as Date;
    return {
      Num: i + 1,
      apptime: isMidnight(appDate) ? (null as unknown as string) : fmtClock(appDate, false),
      patient_type: r.patient_type ?? '',
      patient_name: r.patient_name,
      app_detail: r.app_detail ?? '',
      present: fmtTimeStr(r.present as string | null),
      seated: fmtTimeStr(r.seated as string | null),
      dismissed: fmtTimeStr(r.dismissed as string | null),
      HasVisit: r.hasVisit,
      appointment_id: r.person_id, // preserves the proc's `pid AS <last col>` (consumer reads it here)
    };
  });

  const counts = await db
    .selectFrom('appointments')
    .where('app_day', '=', sql<string>`${dateStr}::date`)
    .select((eb) => [
      eb.fn.countAll<number>().as('all'),
      eb.fn.sum<number>(sql`CASE WHEN "present" IS NOT NULL THEN 1 ELSE 0 END`).as('present'),
      eb.fn.sum<number>(sql`CASE WHEN "present" IS NOT NULL AND "seated" IS NULL THEN 1 ELSE 0 END`).as('waiting'),
      eb.fn.sum<number>(sql`CASE WHEN "dismissed" IS NOT NULL THEN 1 ELSE 0 END`).as('completed'),
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
 * Updates patient appointment state (present, seated, dismissed) with transition guards.
 * (was: UpdatePresent — row-locked, transactional; throws on an invalid transition.)
 */
export async function updatePresent(
  Aid: number,
  state: string,
  Tim: string
): Promise<UpdatePresentResult> {
  await withPgTransaction(async (trx) => {
    const row = await trx
      .selectFrom('appointments')
      .select(['present', 'seated', 'dismissed'])
      .where('appointment_id', '=', Aid)
      .forUpdate()
      .executeTakeFirst();

    if (!row) throw new Error('Appointment not found');
    const present = row.present as string | null;
    const seated = row.seated as string | null;
    const dismissed = row.dismissed as string | null;
    const now = new Date();

    if (state === 'present') {
      if (present !== null || seated !== null || dismissed !== null) {
        throw new Error('[INVALID_STATE_TRANSITION] Cannot check in: patient is already checked in, seated, or dismissed');
      }
      await trx.updateTable('appointments').set({ present: Tim, last_updated: now }).where('appointment_id', '=', Aid).execute();
    } else if (state === 'seated') {
      if (present === null) throw new Error('[INVALID_STATE_TRANSITION] Cannot seat: patient is not checked in');
      if (seated !== null) throw new Error('[INVALID_STATE_TRANSITION] Cannot seat: patient is already seated');
      if (dismissed !== null) throw new Error('[INVALID_STATE_TRANSITION] Cannot seat: patient is already dismissed');
      await trx.updateTable('appointments').set({ seated: Tim, last_updated: now }).where('appointment_id', '=', Aid).execute();
    } else if (state === 'dismissed') {
      if (seated === null) throw new Error('[INVALID_STATE_TRANSITION] Cannot dismiss: patient is not seated');
      if (dismissed !== null) throw new Error('[INVALID_STATE_TRANSITION] Cannot dismiss: patient is already dismissed');
      await trx.updateTable('appointments').set({ dismissed: Tim, last_updated: now }).where('appointment_id', '=', Aid).execute();
    } else {
      throw new Error('Invalid state parameter. Must be present, seated, or dismissed.');
    }
  });
  return { success: true, appointment_id: Aid, state, time: Tim };
}

/**
 * Undo appointment state by setting the field to NULL, with reverse-transition guards.
 * (was: UndoAppointmentState)
 */
export async function undoAppointmentState(
  appointment_id: number,
  stateField: string
): Promise<UndoStateResult> {
  if (stateField !== 'present' && stateField !== 'seated' && stateField !== 'dismissed') {
    throw new Error('Invalid state field. Must be present, seated, or dismissed.');
  }

  await withPgTransaction(async (trx) => {
    const row = await trx
      .selectFrom('appointments')
      .select(['present', 'seated', 'dismissed'])
      .where('appointment_id', '=', appointment_id)
      .forUpdate()
      .executeTakeFirst();

    const seated = (row?.seated as string | null) ?? null;
    const dismissed = (row?.dismissed as string | null) ?? null;
    if (stateField === 'present' && seated !== null) throw new Error('Cannot undo check-in: Patient is already seated');
    if (stateField === 'seated' && dismissed !== null) throw new Error('Cannot undo seated: Patient visit is already completed');

    const set =
      stateField === 'present' ? { present: null } : stateField === 'seated' ? { seated: null } : { dismissed: null };
    await trx.updateTable('appointments').set(set).where('appointment_id', '=', appointment_id).execute();
  });

  return { appointment_id, stateCleared: stateField, success: true };
}

/**
 * Get daily appointments (was: GetDailyAppointmentsOptimized — 3 result sets folded into one query).
 * `allAppointments` = absent (present IS NULL), `checkedInAppointments` = present IS NOT NULL,
 * plus aggregate stats — preserving the proc's exact column names per set.
 */
export async function getDailyAppointmentsOptimized(
  AppsDate: Date | string
): Promise<DailyAppointmentsOptimizedResult> {
  const dateStr = toDateStr(AppsDate);

  const base = await getKysely()
    .selectFrom('appointments as a')
    .innerJoin('patients as p', 'p.person_id', 'a.person_id')
    .leftJoin('patient_types as pt', 'pt.id', 'p.patient_type_id')
    .where('a.app_day', '=', sql<string>`${dateStr}::date`)
    .select([
      'a.appointment_id', 'a.person_id', 'a.app_detail', 'a.present', 'a.seated', 'a.dismissed',
      'a.app_date', 'a.app_cost', 'p.patient_name', 'pt.patient_type',
      sql<boolean>`EXISTS(SELECT 1 FROM "alerts" al WHERE al."person_id"=p."person_id" AND al."is_active"=true)`.as('hasActiveAlert'),
      sql<boolean>`COALESCE((SELECT (w."type_of_work" IN (1,2,11,19,20)) FROM "works" w WHERE w."person_id"=a."person_id" AND w."status"=1 LIMIT 1), false)`.as('isOrthoVisit'),
      sql<boolean>`EXISTS(SELECT 1 FROM "works" w2 JOIN "visits" vis ON vis."work_id"=w2."work_id" WHERE w2."person_id"=a."person_id" AND vis."visit_date"=${dateStr}::date)`.as('hasVisit'),
    ])
    .execute();

  const enriched = base.map((r) => {
    const appDate = r.app_date as unknown as Date;
    return {
      ...r,
      appDate,
      apptime: isMidnight(appDate) ? null : fmtClock(appDate, true),
      presentTime: fmtTimeStr(r.present as string | null),
      seatedTime: fmtTimeStr(r.seated as string | null),
      dismissedTime: fmtTimeStr(r.dismissed as string | null),
    };
  });

  // Result set 1 (proc names it as `allAppointments`): absent — present IS NULL.
  const allAppointments = enriched
    .filter((r) => r.present === null)
    .sort((a, b) => {
      const am = isMidnight(a.appDate) ? 1 : 0;
      const bm = isMidnight(b.appDate) ? 1 : 0;
      return am - bm || a.appDate.getTime() - b.appDate.getTime();
    })
    .map((r) => ({
      appointment_id: r.appointment_id,
      person_id: r.person_id,
      app_detail: r.app_detail,
      app_date: r.appDate,
      patient_type: r.patient_type,
      patient_name: r.patient_name,
      hasActiveAlert: r.hasActiveAlert,
      apptime: r.apptime,
    }));

  // Result set 2: checked-in — present IS NOT NULL, ordered by presentTime.
  const checkedInAppointments = enriched
    .filter((r) => r.present !== null)
    .sort((a, b) => (a.presentTime ?? '').localeCompare(b.presentTime ?? ''))
    .map((r) => ({
      appointment_id: r.appointment_id,
      person_id: r.person_id,
      app_detail: r.app_detail,
      PresentTime: r.presentTime,
      SeatedTime: r.seatedTime,
      DismissedTime: r.dismissedTime,
      app_date: r.appDate,
      app_cost: r.app_cost,
      apptime: r.apptime,
      patient_type: r.patient_type,
      patient_name: r.patient_name,
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
    waiting: enriched.filter((r) => r.present !== null && r.seated === null && r.dismissed === null).length,
  };

  return { allAppointments, checkedInAppointments, stats };
}

export interface AppointmentNotificationRow {
  appointment_id: number;
  app_date: Date;
  patient_name: string;
  phone: string | null;
  person_id: number;
}

/**
 * Insert an appointment (+ AppoPatientType trigger). Returns the new appointmentID.
 *
 * Replaces the raw T-SQL inserts in AppointmentService (which used `CAST(.. AS datetime2)`,
 * `SCOPE_IDENTITY()` and `GETDATE()` — none valid in PG). AppoPatientType: when the new
 * appointment has a real (non-midnight) time and the patient is type 4, promote them to type 3.
 *
 * @param app_date ISO datetime string ('YYYY-MM-DDTHH:MM:SS'); bound to the `timestamp` column.
 * @param present optional 'HH:MM:SS' check-in time (quick check-in path).
 */
export async function createAppointment(data: {
  person_id: number;
  app_date: string;
  app_detail: string | null;
  dr_id: number | null;
  present?: string | null;
}): Promise<number> {
  return withPgTransaction(async (trx) => {
    const row = await trx
      .insertInto('appointments')
      .values({
        person_id: data.person_id,
        app_date: data.app_date,
        app_detail: data.app_detail,
        dr_id: data.dr_id,
        present: data.present ?? null,
        last_updated: new Date(),
      })
      .returning('appointment_id')
      .executeTakeFirstOrThrow();

    // AppoPatientType: promote a type-4 patient to type 3 on a timed appointment.
    const timePart = data.app_date.includes('T') ? data.app_date.split('T')[1] : data.app_date.split(' ')[1];
    const isMidnightAppt = !timePart || /^00:00(:00)?/.test(timePart);
    if (!isMidnightAppt) {
      const patient = await trx
        .selectFrom('patients')
        .select('patient_type_id')
        .where('person_id', '=', data.person_id)
        .executeTakeFirst();
      if (patient?.patient_type_id === 4) {
        await trx.updateTable('patients').set({ patient_type_id: 3 }).where('person_id', '=', data.person_id).execute();
      }
    }

    return row.appointment_id;
  });
}

export interface AppointmentWithPhone {
  appointment_id: number | null;
  person_id: number | null;
  app_detail: string;
  app_day: string;
  patient_type: string;
  patient_name: string;
  phone: string;
  apptime: string;
  employee_name: string;
}

/**
 * Not-yet-present appointments for a date with patient/type/phone/doctor. (was: ProAppsPhones)
 * Used by the appointment-list PDF generator.
 */
export async function getAppointmentsWithPhones(date: string): Promise<AppointmentWithPhone[]> {
  const dateStr = toDateStr(date);
  const rows = await getKysely()
    .selectFrom('appointments as a')
    .innerJoin('patients as p', 'p.person_id', 'a.person_id')
    .leftJoin('patient_types as pt', 'pt.id', 'p.patient_type_id')
    .leftJoin('employees as e', 'e.id', 'a.dr_id')
    .where('a.app_day', '=', sql<string>`${dateStr}::date`)
    .where('a.present', 'is', null)
    .orderBy('a.app_date')
    .select([
      'a.appointment_id', 'a.person_id', 'a.app_detail',
      sql<string>`to_char(a."app_day", 'YYYY-MM-DD')`.as('app_day'),
      'pt.patient_type', 'p.patient_name', 'p.phone',
      sql<string>`to_char(a."app_date", 'HH12:MI')`.as('apptime'),
      'e.employee_name',
    ])
    .execute();
  return rows.map((r) => ({
    appointment_id: r.appointment_id ?? null,
    person_id: r.person_id ?? null,
    app_detail: r.app_detail ?? '',
    app_day: r.app_day ?? '',
    patient_type: r.patient_type ?? '',
    patient_name: r.patient_name ?? '',
    phone: r.phone ?? '',
    apptime: r.apptime ?? '',
    employee_name: r.employee_name ?? '',
  }));
}

export async function getAppointmentForNotification(
  appointmentId: number
): Promise<AppointmentNotificationRow | null> {
  const row = await getKysely()
    .selectFrom('appointments as a')
    .innerJoin('patients as p', 'p.person_id', 'a.person_id')
    .where('a.appointment_id', '=', appointmentId)
    .select(['a.appointment_id as appointment_id', 'a.app_date', 'p.patient_name', 'p.phone', 'p.person_id'])
    .executeTakeFirst();
  return (row as AppointmentNotificationRow | undefined) ?? null;
}
