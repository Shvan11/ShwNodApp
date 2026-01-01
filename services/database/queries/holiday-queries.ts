/**
 * Holiday Queries
 *
 * Database queries for holiday management and validation.
 * Used by appointment validation and calendar display.
 */
import type { ColumnValue } from '../../../types/database.types.js';
import { executeQuery, TYPES } from '../index.js';

// Type definitions
interface Holiday {
  ID: number;
  Holidaydate: Date;
  HolidayName: string;
  Description: string | null;
  CreatedAt?: Date;
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
 * Helper function to map columns to object
 */
function mapRowToObject<T>(columns: ColumnValue[]): T {
  const item: Record<string, unknown> = {};
  columns.forEach((col) => {
    item[col.metadata.colName] = col.value;
  });
  return item as T;
}

/**
 * Check if a specific date is a holiday
 */
export async function isDateHoliday(date: string): Promise<Holiday | null> {
  const query = `
    SELECT ID, Holidaydate, HolidayName, Description
    FROM dbo.tblHolidays
    WHERE Holidaydate = @date
  `;

  const result = await executeQuery<Holiday>(query, [['date', TYPES.Date, date]], mapRowToObject);

  return result.length > 0 ? result[0] : null;
}

/**
 * Get all holidays within a date range
 */
export async function getHolidaysInRange(startDate: string, endDate: string): Promise<Holiday[]> {
  const query = `
    SELECT ID, Holidaydate, HolidayName, Description
    FROM dbo.tblHolidays
    WHERE Holidaydate BETWEEN @startDate AND @endDate
    ORDER BY Holidaydate
  `;

  return executeQuery<Holiday>(
    query,
    [
      ['startDate', TYPES.Date, startDate],
      ['endDate', TYPES.Date, endDate],
    ],
    mapRowToObject
  );
}

/**
 * Get appointments on a specific date (for warning when adding holiday)
 */
export async function getAppointmentsOnDate(date: string): Promise<AppointmentOnDate[]> {
  const query = `
    SELECT
      a.appointmentID,
      a.PersonID,
      a.AppDate,
      a.AppDetail,
      p.PatientName,
      p.Phone
    FROM dbo.tblappointments a
    INNER JOIN dbo.tblpatients p ON a.PersonID = p.PersonID
    WHERE CAST(a.AppDate AS DATE) = @date
    ORDER BY a.AppDate
  `;

  return executeQuery<AppointmentOnDate>(query, [['date', TYPES.Date, date]], mapRowToObject);
}

/**
 * Get all holidays (for admin/listing purposes)
 */
export async function getAllHolidays(): Promise<Holiday[]> {
  const query = `
    SELECT ID, Holidaydate, HolidayName, Description, CreatedAt
    FROM dbo.tblHolidays
    ORDER BY Holidaydate DESC
  `;

  return executeQuery<Holiday>(query, [], mapRowToObject);
}
