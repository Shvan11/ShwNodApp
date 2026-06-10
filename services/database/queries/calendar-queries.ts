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
  appointment_id: number | null;
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
      to_char(tc."app_date", 'YYYY-MM-DD HH24:MI:SS')       AS "slotDateTime",
      to_char(tc."app_date"::date, 'YYYY-MM-DD')            AS "calendarDate",
      trim(to_char(tc."app_date", 'FMDay'))                 AS "dayName",
      (EXTRACT(DOW FROM tc."app_date")::int + 1)            AS "dayOfWeek",
      COALESCE(ta."appointment_id", 0)                      AS "appointment_id",
      COALESCE(ta."app_detail", '')                         AS "appDetail",
      COALESCE(ta."dr_id", 0)                               AS "drID",
      COALESCE(tp."patient_name", '')                       AS "patientName",
      COALESCE(ta."person_id", 0)                           AS "personID",
      CASE
        WHEN EXISTS (SELECT 1 FROM "appointments" tac
                     WHERE tac."app_date" = tc."app_date"
                       AND (${doctorId}::int IS NULL OR tac."dr_id" = ${doctorId}::int)) THEN 'booked'
        WHEN tc."app_date" < LOCALTIMESTAMP THEN 'past'
        ELSE 'available'
      END                                                  AS "slotStatus",
      (SELECT COUNT(*)::int FROM "appointments" tcnt
       WHERE tcnt."app_date" = tc."app_date"
         AND (${doctorId}::int IS NULL OR tcnt."dr_id" = ${doctorId}::int)) AS "appointmentCount"
    FROM "calendar" tc
    LEFT JOIN "appointments" ta
      ON tc."app_date" = ta."app_date" AND (${doctorId}::int IS NULL OR ta."dr_id" = ${doctorId}::int)
    LEFT JOIN "patients" tp ON ta."person_id" = tp."person_id"
    WHERE tc."app_date" >= ${startDate}::date
      AND tc."app_date" < (${endDate}::date + INTERVAL '1 day')
      AND EXTRACT(DOW FROM tc."app_date") <> 5
    ORDER BY tc."app_date", ta."appointment_id"
  `.execute(getKysely());
  return rows;
}

/**
 * The configured appointment time slots ('HH:MM'), ascending — the source of
 * truth for the grid's time rows. Edited in Calendar Times settings (the `times`
 * table), so add/delete reflects immediately, unlike the materialised `calendar`
 * table which only changes on regenerate.
 */
export async function getConfiguredTimeSlots(): Promise<string[]> {
  const { rows } = await sql<{ t: string }>`
    SELECT to_char("my_time", 'HH24:MI') AS t FROM "times" ORDER BY "my_time"
  `.execute(getKysely());
  return rows.map((r) => r.t);
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
          WHEN EXISTS (SELECT 1 FROM "appointments" tac WHERE tac."app_date" = tc."app_date") THEN 'booked'
          WHEN tc."app_date" < LOCALTIMESTAMP THEN 'past'
          ELSE 'available'
        END AS slotstatus
      FROM "calendar" tc
      WHERE tc."app_date"::date BETWEEN ${startDate}::date AND ${endDate}::date
        AND EXTRACT(DOW FROM tc."app_date") <> 5
    ) s
  `.execute(getKysely());
  return rows[0];
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
    FROM (SELECT MAX("app_date"::date) AS maxdate FROM "calendar") m
  `.execute(getKysely());
  return rows[0];
}

/**
 * Regenerate calendar slots: drop past entries, add any missing future date×time-slot rows.
 * (was: FillCalender — VFillCal/CalStep1/CalStep2 inlined.) Returns the number of slots added.
 */
export async function fillCalendar(): Promise<{ DaysAdded: number }> {
  return withPgTransaction(async (trx) => {
    await sql`DELETE FROM "calendar" WHERE "app_date" < CURRENT_DATE`.execute(trx);

    const result = await sql`
      INSERT INTO "calendar" ("app_date")
      SELECT (d.precal + t."my_time")
      FROM (
        SELECT (CURRENT_DATE + n."my_number") AS precal
        FROM "numbers" n
        LEFT JOIN "holidays" h ON (CURRENT_DATE + n."my_number") = h."holiday_date"
        WHERE h."holiday_date" IS NULL
          AND EXTRACT(DOW FROM (CURRENT_DATE + n."my_number")) <> 5
      ) d
      CROSS JOIN "times" t
      WHERE NOT EXISTS (
        SELECT 1 FROM "calendar" c WHERE c."app_date" = (d.precal + t."my_time")
      )
    `.execute(trx);

    return { DaysAdded: Number(result.numAffectedRows ?? 0) };
  });
}
