/**
 * Appointment-related database queries (PostgreSQL / Kysely).
 *
 * Time formatting and the check-in state-machine validation live in TS, not the DB.
 * `updatePresent` takes a row lock (SELECT … FOR UPDATE) and applies its state-transition
 * guards inside one transaction, so two terminals can't race the same appointment.
 */
import { sql } from 'kysely';
import { getKysely, withPgTransaction } from '../kysely.js';
import { formatClock12, formatTime12 } from '../../../utils/date.js';

// type definitions
interface UpdatePresentResult {
  success: boolean;
  appointment_id: number;
  state: string;
  time: string;
  /** The appointment's OWN day (`YYYY-MM-DD`) — the SSE broadcast key. Not part of the HTTP response. */
  appDay: string | null;
}

interface UndoStateResult {
  appointment_id: number;
  stateCleared: string;
  success: boolean;
  /** The appointment's OWN day (`YYYY-MM-DD`) — the SSE broadcast key. Not part of the HTTP response. */
  appDay: string | null;
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
const fmtClock = formatClock12;

/** Format a PG `time` value ('HH:MM:SS' string) as 'hh:mm' (12-hour leading-zero). */
const fmtTimeStr = (t: string | null): string | null => formatTime12(t);

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
  let appDay: string | null = null;
  await withPgTransaction(async (trx) => {
    const row = await trx
      .selectFrom('appointments')
      .select(['present', 'seated', 'dismissed', 'app_day'])
      .where('appointment_id', '=', Aid)
      .forUpdate()
      .executeTakeFirst();

    if (!row) throw new Error('Appointment not found');
    appDay = row.app_day;
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
  return { success: true, appointment_id: Aid, state, time: Tim, appDay };
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

  let appDay: string | null = null;
  await withPgTransaction(async (trx) => {
    const row = await trx
      .selectFrom('appointments')
      .select(['present', 'seated', 'dismissed', 'app_day'])
      .where('appointment_id', '=', appointment_id)
      .forUpdate()
      .executeTakeFirst();

    appDay = row?.app_day ?? null;
    const seated = (row?.seated as string | null) ?? null;
    const dismissed = (row?.dismissed as string | null) ?? null;
    if (stateField === 'present' && seated !== null) throw new Error('Cannot undo check-in: Patient is already seated');
    if (stateField === 'seated' && dismissed !== null) throw new Error('Cannot undo seated: Patient visit is already completed');

    const set =
      stateField === 'present' ? { present: null } : stateField === 'seated' ? { seated: null } : { dismissed: null };
    await trx.updateTable('appointments').set(set).where('appointment_id', '=', appointment_id).execute();
  });

  return { appointment_id, stateCleared: stateField, success: true, appDay };
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
 * Owns the appointment inserts (formerly raw SQL in AppointmentService, which used `CAST(.. AS datetime2)`,
 * `SCOPE_IDENTITY()` and `GETDATE()`). The legacy AppoPatientType
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
}): Promise<{ appointment_id: number; app_day: string | null }> {
  // `app_day` comes back from the INSERT because it is the realtime broadcast key
  // and it is `GENERATED ALWAYS AS ((app_date)::date) STORED` — so the DB, which
  // owns the timestamp→day cast, is the only thing that can compute it correctly
  // for every `app_date` format the service accepts. Callers used to re-derive it
  // in JS (`split('T')[0]`, a hand-rolled toDateOnly, `new Date()`), which agreed
  // with the row only for the shapes the staff UI happens to send.
  const row = await getKysely()
    .insertInto('appointments')
    .values({
      person_id: data.person_id,
      app_date: data.app_date,
      app_detail: data.app_detail,
      dr_id: data.dr_id,
      present: data.present ?? null,
    })
    .returning(['appointment_id', 'app_day'])
    .executeTakeFirstOrThrow();

  return { appointment_id: row.appointment_id, app_day: row.app_day };
}

export interface AppointmentWithPhone {
  appointment_id: number | null;
  person_id: number | null;
  app_detail: string;
  app_day: string;
  patient_type: string;
  patient_name: string;
  phone: string;
  /** 24-hour `HH:MM`. Render via utils/date#formatTime12 — never re-derive. */
  apptime: string;
  employee_name: string;
  /** Has the patient already checked in? Shown as a marker, not a filter. */
  checked_in: boolean;
}

/**
 * Every appointment booked for a date with patient/type/phone/doctor. (was: ProAppsPhones)
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
    // Every appointment booked for the day, checked-in or not. This used to filter
    // `present IS NULL` (inherited from the legacy ProAppsPhones proc), which made
    // the report self-erasing: regenerate it at noon and everyone who had already
    // arrived silently vanished from the list AND from "Total Appointments".
    .orderBy('a.app_date')
    .select([
      'a.appointment_id', 'a.person_id', 'a.app_detail',
      sql<string>`to_char(a."app_day", 'YYYY-MM-DD')`.as('app_day'),
      'pt.patient_type', 'p.patient_name', 'p.phone', 'a.present',
      // HH24 — the ONLY convention on the wire. Consumers convert to 12-hour via
      // utils/date#formatTime12. This was HH12 with no meridiem, which the PDF
      // generator then read as 24-hour: every PM appointment printed as AM.
      sql<string>`to_char(a."app_date", 'HH24:MI')`.as('apptime'),
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
    checked_in: r.present != null,
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

// ---------------------------------------------------------------------------
// Route-layer reads moved out of `routes/api/appointment.routes.ts` (R9(b)).
// Rows are `type` (not `interface`) so an array of them feeds the contracts'
// `sendData` arg — the index-signature rule (CLAUDE.md / TS2345).
// ---------------------------------------------------------------------------

/** One row of the appointment-type dropdown feed. */
export type AppointmentDetailRow = {
  id: number;
  detail: string;
};

/**
 * One appointment as the patient-history list and the single-appointment read
 * project it. `app_date` is `to_char`-formatted rather than returned as a
 * `Date`: the column is `timestamp` WITHOUT time zone (clinic wall-clock), and
 * letting the driver hand back a `Date` would re-introduce a UTC shift on the
 * way through JSON.
 */
export type AppointmentSummaryRow = {
  appointment_id: number;
  person_id: number;
  app_date: string;
  app_detail: string;
  dr_id: number;
  DrName: string | null;
};

const APPOINTMENT_SUMMARY_SELECT = sql`
        SELECT
            a."appointment_id",
            a."person_id",
            to_char(a."app_date", 'YYYY-MM-DD"T"HH24:MI:SS') AS "app_date",
            a."app_detail",
            a."dr_id",
            e."employee_name" AS "DrName"
        FROM "appointments" a
        LEFT JOIN "employees" e ON a."dr_id" = e."id"
`;

/** Every appointment type, for the booking dropdowns. */
export async function listAppointmentDetails(): Promise<AppointmentDetailRow[]> {
  const { rows } = await sql<AppointmentDetailRow>`
    SELECT "id", "detail" FROM "details" ORDER BY "detail"
  `.execute(getKysely());
  return rows;
}

/** A patient's full appointment history, newest first. */
export async function getPatientAppointments(personId: number): Promise<AppointmentSummaryRow[]> {
  const { rows } = await sql<AppointmentSummaryRow>`
    ${APPOINTMENT_SUMMARY_SELECT}
    WHERE a."person_id" = ${personId}
    ORDER BY a."app_date" DESC
  `.execute(getKysely());
  return rows;
}

/** One appointment by id, or undefined when it doesn't exist. */
export async function getAppointmentById(
  appointmentId: number
): Promise<AppointmentSummaryRow | undefined> {
  const { rows } = await sql<AppointmentSummaryRow>`
    ${APPOINTMENT_SUMMARY_SELECT}
    WHERE a."appointment_id" = ${appointmentId}
  `.execute(getKysely());
  return rows[0];
}

/**
 * Delete an appointment, returning the day it was on.
 *
 * The day is read BEFORE the DELETE — it is the SSE broadcast key, and once the
 * row is gone there is nothing left to read it from. Returns `null` when the
 * appointment did not exist (the caller then broadcasts nothing).
 */
export async function deleteAppointment(appointmentId: number): Promise<string | null> {
  const db = getKysely();
  const { rows: existing } = await sql<{ app_day: string | null }>`
    SELECT "app_day" FROM "appointments" WHERE "appointment_id" = ${appointmentId}
  `.execute(db);

  await sql`
    DELETE FROM "appointments" WHERE "appointment_id" = ${appointmentId}
  `.execute(db);

  return existing[0]?.app_day ?? null;
}

/**
 * The patient portal's "next appointment" row. Narrower than
 * {@link AppointmentSummaryRow} on purpose — the portal is a patient-facing
 * surface, so it gets only what it renders.
 */
export type NextAppointmentRow = {
  appointment_id: number;
  app_date: string;
  app_detail: string | null;
  DrName: string | null;
};

/**
 * A patient's soonest appointment from today onward, or undefined when they
 * have none. Compared against `CURRENT_DATE` (not `LOCALTIMESTAMP`) so an
 * appointment earlier TODAY still counts as "next" for the rest of the day.
 */
export async function getNextAppointmentForPatient(
  personId: number
): Promise<NextAppointmentRow | undefined> {
  const { rows } = await sql<NextAppointmentRow>`
    SELECT
       a."appointment_id",
       to_char(a."app_date", 'YYYY-MM-DD"T"HH24:MI:SS') AS "app_date",
       a."app_detail",
       e."employee_name" AS "DrName"
     FROM "appointments" a
     LEFT JOIN "employees" e ON a."dr_id" = e."id"
     WHERE a."person_id" = ${personId}
       AND a."app_date" >= CURRENT_DATE
     ORDER BY a."app_date" ASC
     LIMIT 1`.execute(getKysely());
  return rows[0];
}
