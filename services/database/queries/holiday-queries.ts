/**
 * Holiday Queries
 *
 * Database queries for holiday management and validation.
 * Used by appointment validation and calendar display.
 *
 * Migration Phase 4: translated to typed Kysely (PostgreSQL). `Holidaydate` is a PG
 * `date`, so the centralized pg parser (kysely.ts) returns it as a 'YYYY-MM-DD' string
 * — consumers already handle the string form (calendar.ts, AppointmentService via
 * toDateOnly). The mssql-only `CreatedAt` column does not exist in the PG schema
 * (dropped in Phase 2), so `getAllHolidays` no longer returns it.
 */
import { sql } from 'kysely';
import { getKysely } from '../kysely.js';

// Type definitions
interface Holiday {
  ID: number;
  Holidaydate: string;
  HolidayName: string;
  Description: string | null;
}

interface AppointmentOnDate {
  appointmentID: number;
  PersonID: number;
  AppDate: Date;
  AppDetail: string | null;
  PatientName: string;
  Phone: string | null;
}

/**
 * Check if a specific date is a holiday
 */
export async function isDateHoliday(date: string): Promise<Holiday | null> {
  const db = getKysely();
  const row = await db
    .selectFrom('tblholidays')
    // Holidaydate is a PG `date`; pass the 'YYYY-MM-DD' string as a param (PG infers the
    // date type from the comparison). kysely-codegen types `date` as Timestamp(Date), so
    // the value is wrapped to satisfy the static type without changing the emitted SQL.
    .where('Holidaydate', '=', sql<Date>`${date}`)
    .select((eb) => [
      'ID',
      eb.ref('Holidaydate').$castTo<string>().as('Holidaydate'),
      'HolidayName',
      'Description',
    ])
    .executeTakeFirst();

  return row ?? null;
}

/**
 * Get all holidays within a date range
 */
export async function getHolidaysInRange(startDate: string, endDate: string): Promise<Holiday[]> {
  const db = getKysely();
  return db
    .selectFrom('tblholidays')
    .where('Holidaydate', '>=', sql<Date>`${startDate}`)
    .where('Holidaydate', '<=', sql<Date>`${endDate}`)
    .orderBy('Holidaydate')
    .select((eb) => [
      'ID',
      eb.ref('Holidaydate').$castTo<string>().as('Holidaydate'),
      'HolidayName',
      'Description',
    ])
    .execute();
}

/**
 * Get appointments on a specific date (for warning when adding holiday)
 */
export async function getAppointmentsOnDate(date: string): Promise<AppointmentOnDate[]> {
  const db = getKysely();
  return db
    .selectFrom('tblappointments as a')
    .innerJoin('tblpatients as p', 'p.PersonID', 'a.PersonID')
    .where(sql<boolean>`cast(${sql.ref('a.AppDate')} as date) = ${date}`)
    .orderBy('a.AppDate')
    .select(['a.appointmentID', 'a.PersonID', 'a.AppDate', 'a.AppDetail', 'p.PatientName', 'p.Phone'])
    .execute();
}

/**
 * Get all holidays (for admin/listing purposes)
 */
export async function getAllHolidays(): Promise<Holiday[]> {
  const db = getKysely();
  return db
    .selectFrom('tblholidays')
    .orderBy('Holidaydate', 'desc')
    .select((eb) => [
      'ID',
      eb.ref('Holidaydate').$castTo<string>().as('Holidaydate'),
      'HolidayName',
      'Description',
    ])
    .execute();
}
