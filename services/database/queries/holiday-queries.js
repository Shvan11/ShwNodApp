/**
 * Holiday Queries
 *
 * Database queries for holiday management and validation.
 * Used by appointment validation and calendar display.
 */

import { executeQuery, TYPES } from '../index.js';

/**
 * Check if a specific date is a holiday
 * @param {string} date - Date in YYYY-MM-DD format
 * @returns {Promise<Object|null>} Holiday object if found, null otherwise
 */
export async function isDateHoliday(date) {
    const query = `
        SELECT ID, Holidaydate, HolidayName, Description
        FROM dbo.tblHolidays
        WHERE Holidaydate = @date
    `;

    const result = await executeQuery(
        query,
        [['date', TYPES.Date, date]],
        (columns) => {
            const item = {};
            columns.forEach((col) => {
                item[col.metadata.colName] = col.value;
            });
            return item;
        }
    );

    return result.length > 0 ? result[0] : null;
}

/**
 * Get all holidays within a date range
 * @param {string} startDate - Start date YYYY-MM-DD
 * @param {string} endDate - End date YYYY-MM-DD
 * @returns {Promise<Array>} Array of holidays
 */
export async function getHolidaysInRange(startDate, endDate) {
    const query = `
        SELECT ID, Holidaydate, HolidayName, Description
        FROM dbo.tblHolidays
        WHERE Holidaydate BETWEEN @startDate AND @endDate
        ORDER BY Holidaydate
    `;

    return executeQuery(
        query,
        [
            ['startDate', TYPES.Date, startDate],
            ['endDate', TYPES.Date, endDate]
        ],
        (columns) => {
            const item = {};
            columns.forEach((col) => {
                item[col.metadata.colName] = col.value;
            });
            return item;
        }
    );
}

/**
 * Get appointments on a specific date (for warning when adding holiday)
 * @param {string} date - Date in YYYY-MM-DD format
 * @returns {Promise<Array>} Array of appointments with patient info
 */
export async function getAppointmentsOnDate(date) {
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

    return executeQuery(
        query,
        [['date', TYPES.Date, date]],
        (columns) => {
            const item = {};
            columns.forEach((col) => {
                item[col.metadata.colName] = col.value;
            });
            return item;
        }
    );
}

/**
 * Get all holidays (for admin/listing purposes)
 * @returns {Promise<Array>} Array of all holidays ordered by date
 */
export async function getAllHolidays() {
    const query = `
        SELECT ID, Holidaydate, HolidayName, Description, CreatedAt
        FROM dbo.tblHolidays
        ORDER BY Holidaydate DESC
    `;

    return executeQuery(
        query,
        [],
        (columns) => {
            const item = {};
            columns.forEach((col) => {
                item[col.metadata.colName] = col.value;
            });
            return item;
        }
    );
}
