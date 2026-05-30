/**
 * Calendar queries (PostgreSQL / Kysely `sql` tag).
 *
 * Phase 5 reimplementation of the calendar stored procs: ProcWeeklyCalendarOptimized,
 * ProcCalendarStatsOptimized, ProcDay, ProcEnsureCalendarRange and FillCalender (whose VFillCal /
 * CalStep1 / CalStep2 view chain is inlined). Consumed by routes/calendar.ts.
 *
 * SQL Server DATEPART(WEEKDAY) under DATEFIRST=7 used Friday=6; PG EXTRACT(DOW) uses Friday=5 —
 * the Friday-exclusion filters are translated accordingly. Timestamps are emitted as strings
 * (to_char) to keep the route's wall-clock string parsing intact (no UTC conversion).
 */
import { sql } from 'kysely';
import { getKysely, withPgTransaction } from '../kysely.js';

export interface CalendarSlotRow {
  slotDateTime: string;
  calendarDate: string;
  dayName: string;
  dayOfWeek: number;
  appointmentID: number | null;
  appDetail: string | null;
  drID: number | null;
  patientName: string | null;
  personID: number | null;
  slotStatus: string;
  appointmentCount: number;
}

export interface CalendarStatsRow {
  weekStart: string;
  weekEnd: string;
  totalSlots: number;
  availableSlots: number;
  bookedSlots: number;
  pastSlots: number;
  utilizationPercent: number;
}

export interface CalendarDayRow {
  appointmentID: number | null;
  appDetail: string | null;
  drID: number | null;
  patientName: string | null;
  appDate: Date;
  appTime: string;
}

export interface EnsureRangeResult {
  status: string;
  previousMaxDate: string | null;
  newMaxDate: string;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');
const toDateStr = (d: Date): string => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/**
 * Weekly/range calendar slots with per-slot appointment + status. (was: ProcWeeklyCalendarOptimized)
 * `doctorId` null = no doctor filter.
 */
export async function getWeeklyCalendarSlots(
  startDate: string,
  endDate: string,
  doctorId: number | null
): Promise<CalendarSlotRow[]> {
  const { rows } = await sql<CalendarSlotRow>`
    SELECT
      to_char(tc."AppDate", 'YYYY-MM-DD HH24:MI:SS')       AS "slotDateTime",
      to_char(tc."AppDate"::date, 'YYYY-MM-DD')            AS "calendarDate",
      trim(to_char(tc."AppDate", 'FMDay'))                 AS "dayName",
      (EXTRACT(DOW FROM tc."AppDate")::int + 1)            AS "dayOfWeek",
      COALESCE(ta."appointmentID", 0)                      AS "appointmentID",
      COALESCE(ta."AppDetail", '')                         AS "appDetail",
      COALESCE(ta."DrID", 0)                               AS "drID",
      COALESCE(tp."PatientName", '')                       AS "patientName",
      COALESCE(ta."PersonID", 0)                           AS "personID",
      CASE
        WHEN EXISTS (SELECT 1 FROM "tblappointments" tac
                     WHERE tac."AppDate" = tc."AppDate"
                       AND (${doctorId}::int IS NULL OR tac."DrID" = ${doctorId}::int)) THEN 'booked'
        WHEN tc."AppDate" < LOCALTIMESTAMP THEN 'past'
        ELSE 'available'
      END                                                  AS "slotStatus",
      (SELECT COUNT(*)::int FROM "tblappointments" tcnt
       WHERE tcnt."AppDate" = tc."AppDate"
         AND (${doctorId}::int IS NULL OR tcnt."DrID" = ${doctorId}::int)) AS "appointmentCount"
    FROM "tblCalender" tc
    LEFT JOIN "tblappointments" ta
      ON tc."AppDate" = ta."AppDate" AND (${doctorId}::int IS NULL OR ta."DrID" = ${doctorId}::int)
    LEFT JOIN "tblpatients" tp ON ta."PersonID" = tp."PersonID"
    WHERE tc."AppDate" >= ${startDate}::date
      AND tc."AppDate" < (${endDate}::date + INTERVAL '1 day')
      AND EXTRACT(DOW FROM tc."AppDate") <> 5
    ORDER BY tc."AppDate", ta."appointmentID"
  `.execute(getKysely());
  return rows;
}

/**
 * Utilisation statistics for a week/range. (was: ProcCalendarStatsOptimized)
 */
export async function getCalendarStats(startDate: string, endDate: string): Promise<CalendarStatsRow> {
  const { rows } = await sql<CalendarStatsRow>`
    SELECT
      ${startDate}::date AS "weekStart",
      ${endDate}::date   AS "weekEnd",
      COUNT(*)::int      AS "totalSlots",
      COALESCE(SUM(CASE WHEN slotstatus = 'available' THEN 1 ELSE 0 END), 0)::int AS "availableSlots",
      COALESCE(SUM(CASE WHEN slotstatus = 'booked'    THEN 1 ELSE 0 END), 0)::int AS "bookedSlots",
      COALESCE(SUM(CASE WHEN slotstatus = 'past'      THEN 1 ELSE 0 END), 0)::int AS "pastSlots",
      CASE WHEN COUNT(*) > 0
        THEN CAST(SUM(CASE WHEN slotstatus = 'booked' THEN 1.0 ELSE 0 END) / COUNT(*) * 100 AS decimal(5,2))
        ELSE 0 END AS "utilizationPercent"
    FROM (
      SELECT
        CASE
          WHEN EXISTS (SELECT 1 FROM "tblappointments" tac WHERE tac."AppDate" = tc."AppDate") THEN 'booked'
          WHEN tc."AppDate" < LOCALTIMESTAMP THEN 'past'
          ELSE 'available'
        END AS slotstatus
      FROM "tblCalender" tc
      WHERE tc."AppDate"::date BETWEEN ${startDate}::date AND ${endDate}::date
        AND EXTRACT(DOW FROM tc."AppDate") <> 5
    ) s
  `.execute(getKysely());
  return rows[0];
}

/**
 * All calendar slots for a single day with appointment info where booked. (was: ProcDay)
 */
export async function getCalendarDay(date: string): Promise<CalendarDayRow[]> {
  const { rows } = await sql<CalendarDayRow>`
    SELECT
      a."appointmentID"                       AS "appointmentID",
      a."AppDetail"                           AS "appDetail",
      a."DrID"                                AS "drID",
      p."PatientName"                         AS "patientName",
      tc."AppDate"                            AS "appDate",
      to_char(tc."AppDate", 'HH12:MI')        AS "appTime"
    FROM "tblCalender" tc
    LEFT JOIN "tblappointments" a ON a."AppDate" = tc."AppDate"
    LEFT JOIN "tblpatients" p ON a."PersonID" = p."PersonID"
    WHERE tc."AppDate" >= ${date}::date
      AND tc."AppDate" < (${date}::date + INTERVAL '1 day')
    ORDER BY tc."AppDate"
  `.execute(getKysely());
  return rows;
}

/**
 * Report whether the calendar extends far enough ahead. (was: ProcEnsureCalendarRange — report only.)
 */
export async function ensureCalendarRange(daysAhead = 60): Promise<EnsureRangeResult> {
  const future = new Date();
  future.setDate(future.getDate() + daysAhead);
  const futureStr = toDateStr(future);

  const { rows } = await sql<EnsureRangeResult>`
    SELECT
      CASE WHEN m.maxdate IS NULL OR m.maxdate < ${futureStr}::date
        THEN 'Calendar needs updating' ELSE 'Calendar is current' END AS "status",
      to_char(m.maxdate, 'YYYY-MM-DD') AS "previousMaxDate",
      ${futureStr} AS "newMaxDate"
    FROM (SELECT MAX("AppDate"::date) AS maxdate FROM "tblCalender") m
  `.execute(getKysely());
  return rows[0];
}

/**
 * Regenerate calendar slots: drop past entries, add any missing future date×time-slot rows.
 * (was: FillCalender — VFillCal/CalStep1/CalStep2 inlined.) Returns the number of slots added.
 */
export async function fillCalendar(): Promise<{ DaysAdded: number }> {
  return withPgTransaction(async (trx) => {
    await sql`DELETE FROM "tblCalender" WHERE "AppDate" < CURRENT_DATE`.execute(trx);

    const result = await sql`
      INSERT INTO "tblCalender" ("AppDate")
      SELECT (d.precal + t."MyTime")
      FROM (
        SELECT (CURRENT_DATE + n."Mynumber") AS precal
        FROM "tblnumbers" n
        LEFT JOIN "tblholidays" h ON (CURRENT_DATE + n."Mynumber") = h."Holidaydate"
        WHERE h."Holidaydate" IS NULL
          AND EXTRACT(DOW FROM (CURRENT_DATE + n."Mynumber")) <> 5
      ) d
      CROSS JOIN "tbltimes" t
      WHERE NOT EXISTS (
        SELECT 1 FROM "tblCalender" c WHERE c."AppDate" = (d.precal + t."MyTime")
      )
    `.execute(trx);

    return { DaysAdded: Number(result.numAffectedRows ?? 0) };
  });
}
