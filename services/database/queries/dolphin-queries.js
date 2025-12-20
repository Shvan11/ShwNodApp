/**
 * Dolphin Imaging integration queries
 * Calls stored procedures in ShwanNew that operate on DolphinPlatform database
 */
import { executeQuery, executeStoredProcedure, TYPES } from '../index.js';

/**
 * Check if patient exists in DolphinPlatform database
 * @param {string} personId - The patient ID
 * @returns {Promise<string|null>} - patOtherID if exists, null if not
 */
export async function checkDolphinPatient(personId) {
    const result = await executeStoredProcedure(
        'CheckDolphin',
        [['id', TYPES.VarChar, personId]],
        null,
        (columns) => columns[0]?.value
    );
    return result[0] || null;
}

/**
 * Create patient in DolphinPlatform database
 * @param {string} firstName - Patient first name
 * @param {string} lastName - Patient last name
 * @param {Date} dob - Date of birth
 * @param {string} personId - Patient ID
 * @param {string} gender - Gender ('M' or 'F')
 * @returns {Promise<number>} - Number of rows added (1 if success)
 */
export async function createDolphinPatient(firstName, lastName, dob, personId, gender) {
    const result = await executeStoredProcedure(
        'AddDolph',
        [
            ['FN', TYPES.VarChar, firstName],
            ['LN', TYPES.VarChar, lastName],
            ['BD', TYPES.DateTime, dob],
            ['ID', TYPES.VarChar, personId],
            ['Ge', TYPES.Char, gender]
        ],
        null,
        (columns) => columns[0]?.value
    );
    return result[0] || 0;
}

/**
 * Check if timepoint exists in DolphinPlatform
 * @param {string} personId - Patient ID
 * @param {string} tpName - Timepoint name (Initial/Progress/Final/Retention)
 * @param {Date} tpDate - Timepoint date
 * @returns {Promise<number>} - tpCode if exists, -1 if not
 */
export async function checkTimePoint(personId, tpName, tpDate) {
    const result = await executeStoredProcedure(
        'ChkTimePoint',
        [
            ['ID', TYPES.VarChar, personId],
            ['TPName', TYPES.VarChar, tpName],
            ['TPDate', TYPES.DateTime, tpDate]
        ],
        null,
        (columns) => columns[0]?.value
    );
    return result[0] ?? -1;
}

/**
 * Create timepoint in DolphinPlatform
 * Also updates tblwork.IPhotoDate/FPhotoDate for Initial/Final timepoints
 * @param {string} personId - Patient ID
 * @param {string} tpName - Timepoint name (Initial/Progress/Final/Retention)
 * @param {Date} tpDate - Timepoint date
 * @returns {Promise<number>} - New timepoint code (MyTP)
 */
export async function createTimePoint(personId, tpName, tpDate) {
    const result = await executeStoredProcedure(
        'AddTimePoint',
        [
            ['ID', TYPES.VarChar, personId],
            ['TPName', TYPES.VarChar, tpName],
            ['TPDate', TYPES.DateTime, tpDate]
        ],
        null,
        (columns) => columns[0]?.value
    );
    return result[0];
}

/**
 * Get patient info needed for Dolphin integration
 * @param {string} personId - Patient ID
 * @returns {Promise<Object>} - Patient data with firstName, lastName, dob, gender
 */
export async function getPatientForDolphin(personId) {
    const result = await executeQuery(
        `SELECT FirstName, LastName, DateOfBirth, Gender
         FROM dbo.tblpatients
         WHERE PersonID = @PID`,
        [['PID', TYPES.Int, parseInt(personId, 10)]],
        (columns) => ({
            firstName: columns[0].value,
            lastName: columns[1].value,
            dob: columns[2].value,
            gender: columns[3].value
        })
    );
    return result[0] || null;
}

/**
 * Get appointments for date selection in photo import dialog
 * @param {string} personId - Patient ID
 * @returns {Promise<Array>} - Array of appointments with date and description
 */
export async function getAppointmentsForDolphin(personId) {
    return executeStoredProcedure(
        'ApposforOne',
        [['PID', TYPES.Int, parseInt(personId, 10)]],
        null,
        (columns) => ({
            date: columns[0].value,
            description: columns[1]?.value || ''
        })
    );
}

/**
 * Get visits with photo dates for date selection
 * @param {string} personId - Patient ID
 * @returns {Promise<Array>} - Array of visits with photo dates
 */
export async function getVisitsForDolphin(personId) {
    return executeStoredProcedure(
        'VisitsPhotoforOne',
        [['PID', TYPES.Int, parseInt(personId, 10)]],
        null,
        (columns) => ({
            visitDate: columns[0].value,
            hasInitialPhoto: columns[1]?.value,
            hasFinalPhoto: columns[2]?.value,
            hasProgressPhoto: columns[3]?.value
        })
    );
}
