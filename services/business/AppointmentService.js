/**
 * Appointment Service - Business Logic Layer
 *
 * This service handles all appointment business logic including:
 * - Appointment creation with comprehensive validation
 * - Doctor verification (ensuring employee is actually a doctor)
 * - Conflict detection (preventing duplicate appointments)
 * - Quick check-in operations (creating and checking in simultaneously)
 * - Date/time formatting and normalization
 *
 * This layer sits between route handlers and database queries,
 * encapsulating business rules and validation logic.
 */

import { log } from '../../utils/logger.js';
import * as database from '../database/index.js';
import { getDailyAppointmentsOptimized } from '../database/queries/appointment-queries.js';

/**
 * Validation error class for appointment business logic
 */
export class AppointmentValidationError extends Error {
    constructor(message, code, details = {}) {
        super(message);
        this.name = 'AppointmentValidationError';
        this.code = code;
        this.details = details;
    }
}

/**
 * Validate required fields for appointment creation
 * @param {Object} appointmentData - Appointment data
 * @throws {AppointmentValidationError} If validation fails
 */
function validateAppointmentRequiredFields(appointmentData) {
    const { PersonID, AppDate, AppDetail, DrID } = appointmentData;

    // Validate required fields
    if (!PersonID || !AppDate || !AppDetail || !DrID) {
        throw new AppointmentValidationError(
            'Missing required fields: PersonID, AppDate, AppDetail, DrID',
            'MISSING_REQUIRED_FIELDS'
        );
    }

    // Validate data types
    if (isNaN(parseInt(PersonID)) || isNaN(parseInt(DrID))) {
        throw new AppointmentValidationError(
            'PersonID and DrID must be valid numbers',
            'INVALID_DATA_TYPE'
        );
    }

    // Validate date format
    const appointmentDate = new Date(AppDate);
    if (isNaN(appointmentDate.getTime())) {
        throw new AppointmentValidationError(
            'Invalid date format for AppDate',
            'INVALID_DATE_FORMAT'
        );
    }
}

/**
 * Verify that an employee is a doctor
 * @param {number} drID - Doctor/Employee ID
 * @returns {Promise<Object>} Doctor information
 * @throws {AppointmentValidationError} If employee is not a doctor
 */
export async function verifyDoctor(drID) {
    const doctorCheck = await database.executeQuery(`
        SELECT e.ID, e.employeeName, p.PositionName
        FROM tblEmployees e
        INNER JOIN tblPositions p ON e.Position = p.ID
        WHERE e.ID = @drID AND p.PositionName = 'Doctor'
    `, [['drID', database.TYPES.Int, parseInt(drID)]]);

    if (!doctorCheck || doctorCheck.length === 0) {
        throw new AppointmentValidationError(
            'Invalid doctor ID or employee is not a doctor',
            'INVALID_DOCTOR'
        );
    }

    return doctorCheck[0];
}

/**
 * Check for appointment conflicts (same patient, same day)
 * @param {number} personID - Patient ID
 * @param {string} appDate - Appointment date
 * @returns {Promise<Object|null>} Existing appointment if conflict found, null otherwise
 * @throws {AppointmentValidationError} If conflict exists
 */
export async function checkAppointmentConflict(personID, appDate) {
    const conflictCheck = await database.executeQuery(`
        SELECT appointmentID
        FROM tblappointments
        WHERE PersonID = @personID AND CAST(AppDate AS DATE) = CAST(@appDate AS DATE)
    `, [
        ['personID', database.TYPES.Int, parseInt(personID)],
        ['appDate', database.TYPES.DateTime, appDate]
    ]);

    if (conflictCheck && conflictCheck.length > 0) {
        throw new AppointmentValidationError(
            'Patient already has an appointment on this date',
            'APPOINTMENT_CONFLICT',
            { existingAppointmentID: conflictCheck[0].appointmentID }
        );
    }

    return null;
}

/**
 * Format current date/time for appointment operations
 * @returns {Object} Formatted date strings
 */
function formatCurrentDateTime() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');

    return {
        dateTime: `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`,
        dateOnly: `${year}-${month}-${day}`,
        timeObject: now
    };
}

/**
 * Validate and create a new appointment
 * @param {Object} appointmentData
 * @param {number} appointmentData.PersonID - Patient ID
 * @param {string} appointmentData.AppDate - Appointment date/time
 * @param {string} appointmentData.AppDetail - Appointment detail/reason
 * @param {number} appointmentData.DrID - Doctor ID
 * @returns {Promise<Object>} Created appointment with ID and doctor info
 * @throws {AppointmentValidationError} If validation fails
 */
export async function validateAndCreateAppointment(appointmentData) {
    const { PersonID, AppDate, AppDetail, DrID } = appointmentData;

    // Validate required fields
    validateAppointmentRequiredFields(appointmentData);

    // Verify doctor exists and is actually a doctor
    const doctor = await verifyDoctor(DrID);

    // Check for appointment conflicts
    await checkAppointmentConflict(PersonID, AppDate);

    // Insert new appointment
    const insertQuery = `
        INSERT INTO tblappointments (
            PersonID,
            AppDate,
            AppDetail,
            DrID,
            LastUpdated
        ) VALUES (@personID, CAST(@appDate AS datetime2), @appDetail, @drID, GETDATE())
    `;

    const result = await database.executeQuery(insertQuery, [
        ['personID', database.TYPES.Int, parseInt(PersonID)],
        ['appDate', database.TYPES.NVarChar, AppDate],
        ['appDetail', database.TYPES.NVarChar, AppDetail],
        ['drID', database.TYPES.Int, parseInt(DrID)]
    ]);

    const newAppointmentId = result.insertId || result.recordset?.[0]?.appointmentID;

    log.info(`Appointment created: ID ${newAppointmentId}, Patient ${PersonID}, Doctor ${doctor.employeeName}, Date ${AppDate}`);

    return {
        appointmentID: newAppointmentId,
        PersonID: parseInt(PersonID),
        AppDate,
        AppDetail,
        DrID: parseInt(DrID),
        doctorName: doctor.employeeName
    };
}

/**
 * Quick check-in: Create appointment and mark as present in one operation
 *
 * This handles three scenarios:
 * 1. Patient already checked in today - return existing appointment
 * 2. Patient has appointment today but not checked in - update with check-in time
 * 3. Patient has no appointment today - create new appointment with check-in
 *
 * @param {Object} checkInData
 * @param {number} checkInData.PersonID - Patient ID (required)
 * @param {string} checkInData.AppDetail - Appointment detail (optional, defaults to 'Walk-in')
 * @param {number} checkInData.DrID - Doctor ID (optional)
 * @returns {Promise<Object>} Check-in result with appointment details
 * @throws {AppointmentValidationError} If validation fails
 */
export async function quickCheckIn(checkInData) {
    const { PersonID, AppDetail, DrID } = checkInData;

    // Validate PersonID
    if (!PersonID || isNaN(parseInt(PersonID))) {
        throw new AppointmentValidationError(
            'PersonID is required and must be a valid number',
            'INVALID_PERSON_ID'
        );
    }

    // Set defaults for optional fields
    const detail = AppDetail || 'Walk-in';
    const doctorId = DrID ? parseInt(DrID) : null;

    // Get formatted current date/time
    const { dateTime, dateOnly, timeObject } = formatCurrentDateTime();

    // Generate present time string (avoids UTC conversion issue with Date objects)
    const now = new Date();
    const presentTimeString = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

    // Check if patient already has an appointment today
    const existingAppointment = await database.executeQuery(`
        SELECT appointmentID, Present, Seated, Dismissed
        FROM tblappointments
        WHERE PersonID = @personID
          AND CAST(AppDate AS DATE) = @today
    `, [
        ['personID', database.TYPES.Int, parseInt(PersonID)],
        ['today', database.TYPES.NVarChar, dateOnly]
    ]);

    // Scenario 1: Appointment exists and patient already checked in
    if (existingAppointment && existingAppointment.length > 0) {
        const apt = existingAppointment[0];

        if (apt.Present) {
            log.info(`Patient ${PersonID} already checked in today (Appointment ${apt.appointmentID})`);
            return {
                success: true,
                alreadyCheckedIn: true,
                appointmentID: apt.appointmentID,
                message: 'Patient already checked in today',
                appointment: {
                    appointmentID: apt.appointmentID,
                    PersonID: parseInt(PersonID),
                    AppDate: dateTime,
                    Present: apt.Present
                }
            };
        }

        // Scenario 2: Appointment exists but not checked in - update with Present time
        await database.executeQuery(`
            UPDATE tblappointments
            SET Present = @presentTime,
                LastUpdated = GETDATE()
            WHERE appointmentID = @appointmentID
        `, [
            ['presentTime', database.TYPES.VarChar, presentTimeString],
            ['appointmentID', database.TYPES.Int, apt.appointmentID]
        ]);

        log.info(`Patient ${PersonID} checked in to existing appointment ${apt.appointmentID}`);

        return {
            success: true,
            checkedIn: true,
            appointmentID: apt.appointmentID,
            message: 'Patient checked in successfully',
            appointment: {
                appointmentID: apt.appointmentID,
                PersonID: parseInt(PersonID),
                AppDate: dateTime,
                Present: timeObject
            }
        };
    }

    // Scenario 3: No appointment exists - create new with Present time

    // If doctor ID provided, verify it's valid
    if (doctorId) {
        await verifyDoctor(doctorId);
    }

    // Create new appointment with Present time already set
    const insertQuery = `
        INSERT INTO tblappointments (
            PersonID,
            AppDate,
            AppDetail,
            DrID,
            Present,
            LastUpdated
        )
        VALUES (
            @personID,
            CAST(@appDate AS datetime2),
            @appDetail,
            @drID,
            @presentTime,
            GETDATE()
        );
        SELECT SCOPE_IDENTITY() AS appointmentID;
    `;

    const result = await database.executeQuery(insertQuery, [
        ['personID', database.TYPES.Int, parseInt(PersonID)],
        ['appDate', database.TYPES.NVarChar, dateTime],
        ['appDetail', database.TYPES.NVarChar, detail],
        ['drID', database.TYPES.Int, doctorId || null],
        ['presentTime', database.TYPES.VarChar, presentTimeString]
    ], (columns) => ({
        appointmentID: columns[0].value
    }));

    const newAppointmentId = result?.[0]?.appointmentID;

    log.info(`Quick check-in: Created appointment ${newAppointmentId} for patient ${PersonID} with Present time`);

    return {
        success: true,
        created: true,
        checkedIn: true,
        appointmentID: newAppointmentId,
        message: 'Appointment created and patient checked in successfully',
        appointment: {
            appointmentID: newAppointmentId,
            PersonID: parseInt(PersonID),
            AppDate: dateTime,
            AppDetail: detail,
            DrID: doctorId,
            Present: timeObject
        }
    };
}

/**
 * Get daily appointments with business logic (OPTIMIZED - Phase 2)
 * Fetches all appointment data in single call and structures response
 * @param {string} AppsDate - The date for which to retrieve appointments
 * @returns {Promise<Object>} Structured appointment data with stats
 */
export async function getDailyAppointments(AppsDate) {
    // Validate date parameter
    if (!AppsDate) {
        throw new AppointmentValidationError(
            'AppsDate is required',
            'MISSING_DATE'
        );
    }

    // Validate date format
    const appointmentDate = new Date(AppsDate);
    if (isNaN(appointmentDate.getTime())) {
        throw new AppointmentValidationError(
            'Invalid date format for AppsDate',
            'INVALID_DATE_FORMAT'
        );
    }

    // Get data from database layer
    const resultSets = await getDailyAppointmentsOptimized(AppsDate);

    // Extract and structure result sets
    let allAppointments = [];
    let checkedInAppointments = [];
    let stats = { total: 0, checkedIn: 0, absent: 0, waiting: 0 };

    if (resultSets.length >= 3) {
        // All 3 result sets present
        allAppointments = resultSets[0] || [];
        checkedInAppointments = resultSets[1] || [];
        stats = resultSets[2] && resultSets[2][0] ? resultSets[2][0] : stats;
    } else if (resultSets.length === 2) {
        // One result set might be empty
        if (resultSets[0].length > 0 && resultSets[0][0].hasOwnProperty('appointmentID')) {
            allAppointments = resultSets[0];
            if (resultSets[1].length > 0) {
                if (resultSets[1][0].hasOwnProperty('appointmentID')) {
                    checkedInAppointments = resultSets[1];
                } else if (resultSets[1][0].hasOwnProperty('total')) {
                    stats = resultSets[1][0];
                }
            }
        } else if (resultSets[0].length > 0 && resultSets[0][0].hasOwnProperty('total')) {
            stats = resultSets[0][0];
        }
    } else if (resultSets.length === 1) {
        // Only stats result set
        if (resultSets[0].length > 0 && resultSets[0][0].hasOwnProperty('total')) {
            stats = resultSets[0][0];
        }
    }

    log.info(`Retrieved daily appointments for ${AppsDate}: ${stats.total} total, ${stats.checkedIn} checked in`);

    return {
        allAppointments,
        checkedInAppointments,
        stats
    };
}

export default {
    validateAndCreateAppointment,
    verifyDoctor,
    checkAppointmentConflict,
    quickCheckIn,
    getDailyAppointments,
    AppointmentValidationError
};
