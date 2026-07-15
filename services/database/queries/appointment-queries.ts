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

// A daily-appointments row: `appointment_id` is typed (matching the contract's
// looseObject row); the remaining columns ride the index signature. A `type`
// (not `interface`) so it stays assignable to the contract's looseObject
// `z.input` — sendData would reject an interface (TS2345, string index sig).
type DailyAppointmentRow = { appointment_id: number; [key: string]: unknown };

export type DailyAppointmentsOptimizedResult = {
  allAppointments: DailyAppointmentRow[];
  checkedInAppointments: DailyAppointmentRow[];
  stats: DailyAppointmentStats;
};

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

    if (state === 'present') {
      if (present !== null || seated !== null || dismissed !== null) {
        throw new Error('[INVALID_STATE_TRANSITION] Cannot check in: patient is already checked in, seated, or dismissed');
      }
      await trx.updateTable('appointments').set({ present: Tim }).where('appointment_id', '=', Aid).execute();
    } else if (state === 'seated') {
      if (present === null) throw new Error('[INVALID_STATE_TRANSITION] Cannot seat: patient is not checked in');
      if (seated !== null) throw new Error('[INVALID_STATE_TRANSITION] Cannot seat: patient is already seated');
      if (dismissed !== null) throw new Error('[INVALID_STATE_TRANSITION] Cannot seat: patient is already dismissed');
      await trx.updateTable('appointments').set({ seated: Tim }).where('appointment_id', '=', Aid).execute();
    } else if (state === 'dismissed') {
      if (seated === null) throw new Error('[INVALID_STATE_TRANSITION] Cannot dismiss: patient is not seated');
      if (dismissed !== null) throw new Error('[INVALID_STATE_TRANSITION] Cannot dismiss: patient is already dismissed');
      await trx.updateTable('appointments').set({ dismissed: Tim }).where('appointment_id', '=', Aid).execute();
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
      'a.app_date', 'a.app_cost', 'a.dr_id', 'p.patient_name', 'p.patient_type_id',
      'pt.patient_type', 'pt.patient_type_name_ar',
      sql<boolean>`EXISTS(SELECT 1 FROM "alerts" al WHERE al."person_id"=p."person_id" AND al."status"='active' AND (al."expires_at" IS NULL OR al."expires_at" >= CURRENT_DATE))`.as('hasActiveAlert'),
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
      dr_id: r.dr_id,
      app_detail: r.app_detail,
      app_date: r.appDate,
      patient_type: r.patient_type,
      patient_type_id: r.patient_type_id,
      patient_type_name_ar: r.patient_type_name_ar,
      patient_name: r.patient_name,
      hasActiveAlert: r.hasActiveAlert,
      apptime: r.apptime,
      has_visit: r.hasVisit,
    }));

  // Result set 2: checked-in — present IS NOT NULL, ordered by check-in time.
  // Sort on the raw 24-h `present` ('HH:MM:SS') value, NOT the 12-h display
  // string presentTime (13:45→'01:45') which would collate PM check-ins before AM.
  const checkedInAppointments = enriched
    .filter((r) => r.present !== null)
    .sort((a, b) =>
      ((a.present as string | null) ?? '').localeCompare((b.present as string | null) ?? '')
    )
    .map((r) => ({
      appointment_id: r.appointment_id,
      person_id: r.person_id,
      dr_id: r.dr_id,
      app_detail: r.app_detail,
      present_time: r.presentTime,
      seated_time: r.seatedTime,
      dismissed_time: r.dismissedTime,
      app_date: r.appDate,
      app_cost: r.app_cost,
      apptime: r.apptime,
      patient_type: r.patient_type,
      patient_type_id: r.patient_type_id,
      patient_type_name_ar: r.patient_type_name_ar,
      patient_name: r.patient_name,
      hasActiveAlert: r.hasActiveAlert,
      has_visit: r.hasVisit,
      is_ortho_visit: r.isOrthoVisit,
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
 * Insert an appointment. Returns the new appointmentID.
 *
 * Replaces the raw T-SQL inserts in AppointmentService (which used `CAST(.. AS datetime2)`,
 * `SCOPE_IDENTITY()` and `GETDATE()` — none valid in PG). The legacy AppoPatientType
 * transition (timed appointment promotes a Consult patient to New) is GONE: patient type
 * is now derived from a patient's works by classifyPatient(), not their appointments.
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
  const row = await getKysely()
    .insertInto('appointments')
    .values({
      person_id: data.person_id,
      app_date: data.app_date,
      app_detail: data.app_detail,
      dr_id: data.dr_id,
      present: data.present ?? null,
    })
    .returning('appointment_id')
    .executeTakeFirstOrThrow();

  return row.appointment_id;
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
