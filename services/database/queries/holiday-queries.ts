/**
 * Holiday Queries
 *
 * Database queries for holiday management and validation.
 * Used by appointment validation and calendar display.
 *
 * `holiday_date` is a PG `date`, and `db:codegen` runs with `--date-parser string`, so
 * both the generated type and the runtime value (see the pg parser in kysely.ts) are a
 * 'YYYY-MM-DD' string — bind plain strings and select the column directly, no `$castTo`.
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

type AppointmentOnDate = {
  appointment_id: number;
  person_id: number;
  app_date: Date;
  app_detail: string | null;
  patient_name: string;
  phone: string | null;
};

/**
 * Check if a specific date is a holiday
 */
export async function isDateHoliday(date: string): Promise<Holiday | null> {
  const db = getKysely();
  const row = await db
    .selectFrom('holidays')
    .where('holiday_date', '=', date)
    .select(['id', 'holiday_date', 'holiday_name', 'description'])
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
    .where('holiday_date', '>=', startDate)
    .where('holiday_date', '<=', endDate)
    .orderBy('holiday_date')
    .select(['id', 'holiday_date', 'holiday_name', 'description'])
    .execute();
}

/**
 * Get appointments on a specific date (for warning when adding holiday)
 *
 * Filters on the `app_day` generated column (`(app_date)::date`, indexed by `ix_appday`)
 * rather than `cast(app_date as date)` — an expression predicate on `app_date` is
 * non-sargable and seq-scans a table designed to reach ~2M rows. Same pattern as
 * appointment-queries / messaging-queries.
 */
export async function getAppointmentsOnDate(date: string): Promise<AppointmentOnDate[]> {
  const db = getKysely();
  return db
    .selectFrom('appointments as a')
    .innerJoin('patients as p', 'p.person_id', 'a.person_id')
    .where('a.app_day', '=', sql<string>`${date}::date`)
    .orderBy('a.app_date')
    .select(['a.appointment_id', 'a.person_id', 'a.app_date', 'a.app_detail', 'p.patient_name', 'p.phone'])
    .execute();
}
