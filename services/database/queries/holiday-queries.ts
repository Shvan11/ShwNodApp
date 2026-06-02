/**
 * Holiday Queries
 *
 * Database queries for holiday management and validation.
 * Used by appointment validation and calendar display.
 *
 * Migration Phase 4: translated to typed Kysely (PostgreSQL). `holiday_date` is a PG
 * `date`, so the centralized pg parser (kysely.ts) returns it as a 'YYYY-MM-DD' string
 * — consumers already handle the string form (calendar.ts, AppointmentService via
 * toDateOnly). The mssql-only `created_at` column does not exist in the PG schema
 * (dropped in Phase 2), so `getAllHolidays` no longer returns it.
 */
import { sql } from 'kysely';
import { getKysely } from '../kysely.js';

// type definitions
interface Holiday {
  id: number;
  holiday_date: string;
  holiday_name: string;
  description: string | null;
}

interface AppointmentOnDate {
  appointment_id: number;
  person_id: number;
  app_date: Date;
  app_detail: string | null;
  patient_name: string;
  phone: string | null;
}

/**
 * Check if a specific date is a holiday
 */
export async function isDateHoliday(date: string): Promise<Holiday | null> {
  const db = getKysely();
  const row = await db
    .selectFrom('holidays')
    // holiday_date is a PG `date`; pass the 'YYYY-MM-DD' string as a param (PG infers the
    // date type from the comparison). kysely-codegen types `date` as timestamp(Date), so
    // the value is wrapped to satisfy the static type without changing the emitted SQL.
    .where('holiday_date', '=', sql<Date>`${date}`)
    .select((eb) => [
      'id',
      eb.ref('holiday_date').$castTo<string>().as('holiday_date'),
      'holiday_name',
      'description',
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
    .selectFrom('holidays')
    .where('holiday_date', '>=', sql<Date>`${startDate}`)
    .where('holiday_date', '<=', sql<Date>`${endDate}`)
    .orderBy('holiday_date')
    .select((eb) => [
      'id',
      eb.ref('holiday_date').$castTo<string>().as('holiday_date'),
      'holiday_name',
      'description',
    ])
    .execute();
}

/**
 * Get appointments on a specific date (for warning when adding holiday)
 */
export async function getAppointmentsOnDate(date: string): Promise<AppointmentOnDate[]> {
  const db = getKysely();
  return db
    .selectFrom('appointments as a')
    .innerJoin('patients as p', 'p.person_id', 'a.person_id')
    .where(sql<boolean>`cast(${sql.ref('a.app_date')} as date) = ${date}`)
    .orderBy('a.app_date')
    .select(['a.appointment_id', 'a.person_id', 'a.app_date', 'a.app_detail', 'p.patient_name', 'p.phone'])
    .execute();
}

/**
 * Get all holidays (for admin/listing purposes)
 */
export async function getAllHolidays(): Promise<Holiday[]> {
  const db = getKysely();
  return db
    .selectFrom('holidays')
    .orderBy('holiday_date', 'desc')
    .select((eb) => [
      'id',
      eb.ref('holiday_date').$castTo<string>().as('holiday_date'),
      'holiday_name',
      'description',
    ])
    .execute();
}
