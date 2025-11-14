/**
 * Appointment Management Routes
 *
 * This module handles all appointment-related API endpoints including:
 * - Appointment details and types lookup
 * - Daily appointment operations (get all, get present, quick check-in)
 * - Appointment state management (check-in, seated, dismissed, undo)
 * - Full CRUD operations for appointments
 * - Patient appointment history
 * - Real-time appointment updates via WebSocket
 *
 * These routes integrate with appointment queries service and emit WebSocket
 * events for real-time updates across the application.
 */

import express from 'express';
import * as database from '../../services/database/index.js';
import {
    getPresentAps,
    getAllTodayApps,
    getPresentTodayApps,
    updatePresent,
    undoAppointmentState
} from '../../services/database/queries/appointment-queries.js';
import { WebSocketEvents } from '../../services/messaging/websocket-events.js';
import { sendError, ErrorResponses } from '../../utils/error-response.js';
import { log } from '../../utils/logger.js';

const router = express.Router();

// WebSocket emitter will be injected to avoid circular imports
let wsEmitter = null;

/**
 * Set the WebSocket emitter reference
 * @param {EventEmitter} emitter - WebSocket event emitter
 */
export function setWebSocketEmitter(emitter) {
    wsEmitter = emitter;
}

/**
 * Get appointment details/types from tblDetail
 * Used for dropdown menus and appointment type selection
 */
router.get("/appointment-details", async (req, res) => {
    try {
        const query = `SELECT ID, Detail FROM tblDetail ORDER BY Detail`;
        const details = await database.executeQuery(
            query,
            [],
            (columns) => ({
                ID: columns[0].value,
                Detail: columns[1].value
            })
        );
        res.json(details);
    } catch (error) {
        log.error('Error fetching appointment details:', error);
        return ErrorResponses.internalError(res, 'Failed to fetch appointment details', error);
    }
});

/**
 * Notify that appointments were updated
 * Triggers WebSocket event to refresh appointment views across all clients
 */
router.get("/AppsUpdated", async (req, res) => {
    res.sendStatus(200);
    const { PDate } = req.query;
    log.info(`AppsUpdated called with date: ${PDate}`);

    // Emit universal event only
    wsEmitter.emit(WebSocketEvents.DATA_UPDATED, PDate);
});

/**
 * Get current web apps (present appointments)
 * Returns appointments that have been checked in for the specified date
 */
router.get("/getWebApps", async (req, res) => {
    const { PDate } = req.query;
    const result = await getPresentAps(PDate);
    res.json(result);
});

/**
 * Get all today's appointments (not checked in)
 * Returns all scheduled appointments for a date that haven't been checked in yet
 */
router.get("/getAllTodayApps", async (req, res) => {
    try {
        const { AppsDate } = req.query;
        if (!AppsDate) {
            return ErrorResponses.badRequest(res, "Missing required parameter: AppsDate");
        }
        const result = await getAllTodayApps(AppsDate);
        res.json(result);
    } catch (error) {
        log.error("Error fetching all today appointments:", error);
        return ErrorResponses.internalError(res, "Failed to fetch appointments", error);
    }
});

/**
 * Get all present appointments (including dismissed) for daily appointments view
 * Returns all appointments that have been checked in, including those already dismissed
 */
router.get("/getPresentTodayApps", async (req, res) => {
    try {
        const { AppsDate } = req.query;
        if (!AppsDate) {
            return ErrorResponses.badRequest(res, "Missing required parameter: AppsDate");
        }
        const result = await getPresentTodayApps(AppsDate);
        res.json(result);
    } catch (error) {
        log.error("Error fetching present appointments:", error);
        return ErrorResponses.internalError(res, "Failed to fetch present appointments", error);
    }
});

/**
 * Update patient appointment state (Present, Seated, or Dismissed)
 * Records the time when each state transition occurs
 */
router.post("/updateAppointmentState", async (req, res) => {
    try {
        const { appointmentID, state, time } = req.body;
        if (!appointmentID || !state) {
            return ErrorResponses.badRequest(res, "Missing required parameters: appointmentID, state");
        }

        // Format time as string for the modified stored procedure
        const now = new Date();
        const currentTime = time || `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        log.info(`Updating appointment ${appointmentID} with state: ${state}, time: ${currentTime}`);
        const result = await updatePresent(appointmentID, state, currentTime);

        wsEmitter.emit(WebSocketEvents.DATA_UPDATED, new Date().toISOString().split('T')[0]);

        res.json(result);
    } catch (error) {
        log.error("Error updating appointment state:", error);
        return ErrorResponses.internalError(res, "Failed to update appointment state", error);
    }
});

/**
 * Undo appointment state by setting field to NULL
 * Uses dedicated UndoAppointmentState procedure to revert state changes
 */
router.post("/undoAppointmentState", async (req, res) => {
    try {
        const { appointmentID, state } = req.body;
        if (!appointmentID || !state) {
            return ErrorResponses.badRequest(res, "Missing required parameters: appointmentID, state");
        }

        // Use dedicated undo procedure that doesn't affect other applications
        log.info(`Undoing appointment ${appointmentID} state: ${state}`);
        const result = await undoAppointmentState(appointmentID, state);

        wsEmitter.emit(WebSocketEvents.DATA_UPDATED, new Date().toISOString().split('T')[0]);

        res.json(result);
    } catch (error) {
        log.error("Error undoing appointment state:", error);
        return ErrorResponses.internalError(res, "Failed to undo appointment state", error);
    }
});

/**
 * Create new appointment
 * Validates patient, doctor, date, and checks for conflicts before creating
 */
router.post("/appointments", async (req, res) => {
    try {
        const { PersonID, AppDate, AppDetail, DrID } = req.body;

        // Validate required fields
        if (!PersonID || !AppDate || !AppDetail || !DrID) {
            return ErrorResponses.badRequest(res, 'Missing required fields: PersonID, AppDate, AppDetail, DrID');
        }

        // Validate data types
        if (isNaN(parseInt(PersonID)) || isNaN(parseInt(DrID))) {
            return ErrorResponses.badRequest(res, 'PersonID and DrID must be valid numbers');
        }

        // Validate date format
        const appointmentDate = new Date(AppDate);
        if (isNaN(appointmentDate.getTime())) {
            return ErrorResponses.badRequest(res, 'Invalid date format for AppDate');
        }

        // Check if doctor exists and is actually a doctor
        const doctorCheck = await database.executeQuery(`
            SELECT e.ID, e.employeeName, p.PositionName
            FROM tblEmployees e
            INNER JOIN tblPositions p ON e.Position = p.ID
            WHERE e.ID = @drID AND p.PositionName = 'Doctor'
        `, [['drID', database.TYPES.Int, parseInt(DrID)]]);

        if (!doctorCheck || doctorCheck.length === 0) {
            return ErrorResponses.badRequest(res, 'Invalid doctor ID or employee is not a doctor');
        }

        // Check for appointment conflicts (same patient, same day)
        const conflictCheck = await database.executeQuery(`
            SELECT appointmentID
            FROM tblappointments
            WHERE PersonID = @personID AND CAST(AppDate AS DATE) = CAST(@appDate AS DATE)
        `, [
            ['personID', database.TYPES.Int, parseInt(PersonID)],
            ['appDate', database.TYPES.DateTime, AppDate]
        ]);

        if (conflictCheck && conflictCheck.length > 0) {
            return ErrorResponses.conflict(res, 'Patient already has an appointment on this date');
        }

        // Insert new appointment (defaults will be applied automatically)
        // Use CAST to convert string to datetime2 on SQL Server side to avoid timezone conversion
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
            ['appDate', database.TYPES.NVarChar, AppDate], // Pass as string, SQL Server will cast
            ['appDetail', database.TYPES.NVarChar, AppDetail],
            ['drID', database.TYPES.Int, parseInt(DrID)]
        ]);

        // Get the newly created appointment ID
        const newAppointmentId = result.insertId || result.recordset?.[0]?.appointmentID;

        log.info(`New appointment created - ID: ${newAppointmentId}, Patient: ${PersonID}, Doctor: ${doctorCheck[0]?.employeeName || 'Unknown'}, Date: ${AppDate}`);
        log.info('Result object:', result);
        log.info('Doctor check result:', doctorCheck);

        // Emit WebSocket event for real-time updates
        if (wsEmitter) {
            const appointmentDay = appointmentDate.toISOString().split('T')[0];
            wsEmitter.emit('appointments_updated', appointmentDay);
        }

        res.json({
            success: true,
            appointmentID: newAppointmentId,
            message: 'Appointment created successfully',
            appointment: {
                PersonID: parseInt(PersonID),
                AppDate,
                AppDetail,
                DrID: parseInt(DrID),
                doctorName: doctorCheck[0].employeeName
            }
        });

    } catch (error) {
        log.error('Error creating appointment:', error);
        return ErrorResponses.internalError(res, 'Failed to create appointment', error);
    }
});

/**
 * Get all appointments for a specific patient
 * Returns appointment history ordered by date (newest first)
 */
router.get("/patient-appointments/:patientId", async (req, res) => {
    try {
        const { patientId } = req.params;

        if (!patientId || isNaN(parseInt(patientId))) {
            return ErrorResponses.badRequest(res, 'Invalid patient ID');
        }

        const query = `
            SELECT
                a.appointmentID,
                a.PersonID,
                FORMAT(a.AppDate, 'yyyy-MM-ddTHH:mm:ss') as AppDate,
                a.AppDetail,
                a.DrID,
                e.employeeName as DrName
            FROM tblappointments a
            LEFT JOIN tblEmployees e ON a.DrID = e.ID
            WHERE a.PersonID = @personID
            ORDER BY a.AppDate DESC
        `;

        const appointments = await database.executeQuery(
            query,
            [['personID', database.TYPES.Int, parseInt(patientId)]],
            (columns) => ({
                appointmentID: columns[0].value,
                PersonID: columns[1].value,
                AppDate: columns[2].value, // Already formatted as string without timezone
                AppDetail: columns[3].value,
                DrID: columns[4].value,
                DrName: columns[5].value
            })
        );

        res.json({
            success: true,
            appointments: appointments || []
        });

    } catch (error) {
        log.error('Error fetching patient appointments:', error);
        return ErrorResponses.internalError(res, 'Failed to fetch appointments', error);
    }
});

/**
 * Get single appointment by ID
 * Returns detailed information for a specific appointment
 */
router.get("/appointments/:appointmentId", async (req, res) => {
    try {
        const { appointmentId } = req.params;

        if (!appointmentId || isNaN(parseInt(appointmentId))) {
            return ErrorResponses.badRequest(res, 'Invalid appointment ID');
        }

        const query = `
            SELECT
                a.appointmentID,
                a.PersonID,
                FORMAT(a.AppDate, 'yyyy-MM-ddTHH:mm:ss') as AppDate,
                a.AppDetail,
                a.DrID,
                e.employeeName as DrName
            FROM tblappointments a
            LEFT JOIN tblemployees e ON a.DrID = e.ID
            WHERE a.appointmentID = @appointmentId
        `;

        const result = await database.executeQuery(query, [
            ['appointmentId', database.TYPES.Int, parseInt(appointmentId)]
        ]);

        if (!result || result.length === 0) {
            return ErrorResponses.notFound(res, 'Appointment');
        }

        res.json({
            success: true,
            appointment: result[0]
        });

    } catch (error) {
        log.error('Error fetching appointment:', error);
        return ErrorResponses.internalError(res, 'Failed to fetch appointment', error);
    }
});

/**
 * Update appointment
 * Modifies existing appointment details
 */
router.put("/appointments/:appointmentId", async (req, res) => {
    try {
        const { appointmentId } = req.params;
        const { PersonID, AppDate, AppDetail, DrID } = req.body;

        if (!appointmentId || isNaN(parseInt(appointmentId))) {
            return ErrorResponses.badRequest(res, 'Invalid appointment ID');
        }

        // Validate required fields
        if (!PersonID || !AppDate || !AppDetail || !DrID) {
            return ErrorResponses.badRequest(res, 'PersonID, AppDate, AppDetail, and DrID are required');
        }

        // Use CAST to convert string to datetime2 on SQL Server side to avoid timezone conversion
        const query = `
            UPDATE tblappointments
            SET PersonID = @PersonID,
                AppDate = CAST(@AppDate AS datetime2),
                AppDetail = @AppDetail,
                DrID = @DrID
            WHERE appointmentID = @appointmentId
        `;

        await database.executeQuery(query, [
            ['appointmentId', database.TYPES.Int, parseInt(appointmentId)],
            ['PersonID', database.TYPES.Int, parseInt(PersonID)],
            ['AppDate', database.TYPES.NVarChar, AppDate], // Pass as string, SQL Server will cast
            ['AppDetail', database.TYPES.NVarChar, AppDetail],
            ['DrID', database.TYPES.Int, parseInt(DrID)]
        ]);

        res.json({
            success: true,
            message: 'Appointment updated successfully'
        });

    } catch (error) {
        log.error('Error updating appointment:', error);
        return ErrorResponses.internalError(res, 'Failed to update appointment', error);
    }
});

/**
 * Delete appointment
 * Removes an appointment from the system
 */
router.delete("/appointments/:appointmentId", async (req, res) => {
    try {
        const { appointmentId } = req.params;

        if (!appointmentId || isNaN(parseInt(appointmentId))) {
            return ErrorResponses.badRequest(res, 'Invalid appointment ID');
        }

        const query = `DELETE FROM tblappointments WHERE appointmentID = @appointmentId`;

        await database.executeQuery(query, [
            ['appointmentId', database.TYPES.Int, parseInt(appointmentId)]
        ]);

        res.json({
            success: true,
            message: 'Appointment deleted successfully'
        });

    } catch (error) {
        log.error('Error deleting appointment:', error);
        return ErrorResponses.internalError(res, 'Failed to delete appointment', error);
    }
});

/**
 * Quick check-in: Add patient to today's appointments and mark as present
 * Creates appointment and checks in patient in a single operation
 * If appointment exists for today, just marks as present
 */
router.post("/appointments/quick-checkin", async (req, res) => {
    try {
        const { PersonID, AppDetail, DrID } = req.body;

        // Validate required fields
        if (!PersonID) {
            return ErrorResponses.badRequest(res, 'PersonID is required');
        }

        // Validate PersonID is a number
        if (isNaN(parseInt(PersonID))) {
            return ErrorResponses.badRequest(res, 'PersonID must be a valid number');
        }

        // Set defaults for optional fields
        const detail = AppDetail || 'Walk-in';
        const doctorId = DrID ? parseInt(DrID) : null;

        // Get today's date at current time for the appointment
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');

        // Format as string to avoid timezone conversion
        const todayDateTime = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
        const todayDateOnly = `${year}-${month}-${day}`;

        // Get current time for Present field - tedious TYPES.Time expects a Date object
        const currentTime = new Date();

        // Check if patient already has an appointment today
        const existingAppointment = await database.executeQuery(`
            SELECT appointmentID, Present, Seated, Dismissed
            FROM tblappointments
            WHERE PersonID = @personID
              AND CAST(AppDate AS DATE) = @today
        `, [
            ['personID', database.TYPES.Int, parseInt(PersonID)],
            ['today', database.TYPES.NVarChar, todayDateOnly]
        ]);

        // If appointment exists, just update the Present time if not already set
        if (existingAppointment && existingAppointment.length > 0) {
            const apt = existingAppointment[0];

            if (apt.Present) {
                return res.json({
                    success: true,
                    alreadyCheckedIn: true,
                    appointmentID: apt.appointmentID,
                    message: 'Patient already checked in today',
                    presentTime: apt.Present,
                    appointment: {
                        appointmentID: apt.appointmentID,
                        PersonID: parseInt(PersonID),
                        AppDate: todayDateTime,
                        Present: apt.Present
                    }
                });
            } else {
                // Update existing appointment with check-in time
                await database.executeQuery(`
                    UPDATE tblappointments
                    SET Present = @presentTime,
                        LastUpdated = GETDATE()
                    WHERE appointmentID = @appointmentID
                `, [
                    ['presentTime', database.TYPES.Time, currentTime],
                    ['appointmentID', database.TYPES.Int, apt.appointmentID]
                ]);

                log.info(`Patient ${PersonID} checked in to existing appointment ${apt.appointmentID} at ${currentTime}`);

                // Emit WebSocket event for real-time updates
                if (wsEmitter) {
                    wsEmitter.emit('appointments_updated', todayDateOnly);
                }

                return res.json({
                    success: true,
                    checkedIn: true,
                    appointmentID: apt.appointmentID,
                    message: 'Patient checked in successfully',
                    appointment: {
                        appointmentID: apt.appointmentID,
                        PersonID: parseInt(PersonID),
                        AppDate: todayDateTime,
                        Present: currentTime
                    }
                });
            }
        }

        // If doctor ID provided, verify it's valid
        if (doctorId) {
            const doctorCheck = await database.executeQuery(`
                SELECT e.ID, e.employeeName, p.PositionName
                FROM tblEmployees e
                INNER JOIN tblPositions p ON e.Position = p.ID
                WHERE e.ID = @drID AND p.PositionName = 'Doctor'
            `, [['drID', database.TYPES.Int, doctorId]]);

            if (!doctorCheck || doctorCheck.length === 0) {
                return ErrorResponses.badRequest(res, 'Invalid doctor ID or employee is not a doctor');
            }
        }

        // Create new appointment with Present time already set
        // Note: Can't use OUTPUT clause due to triggers, use SCOPE_IDENTITY() instead
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
            ['appDate', database.TYPES.NVarChar, todayDateTime],
            ['appDetail', database.TYPES.NVarChar, detail],
            ['drID', database.TYPES.Int, doctorId || null],
            ['presentTime', database.TYPES.Time, currentTime]
        ], (columns) => ({
            appointmentID: columns[0].value
        }));

        const newAppointmentId = result?.[0]?.appointmentID;

        log.info(`Quick check-in: Created appointment ${newAppointmentId} for patient ${PersonID} and marked present at ${currentTime}`);

        // Emit WebSocket event for real-time updates
        if (wsEmitter) {
            wsEmitter.emit('appointments_updated', todayDateOnly);
        }

        res.json({
            success: true,
            created: true,
            checkedIn: true,
            appointmentID: newAppointmentId,
            message: 'Appointment created and patient checked in successfully',
            appointment: {
                appointmentID: newAppointmentId,
                PersonID: parseInt(PersonID),
                AppDate: todayDateTime,
                AppDetail: detail,
                DrID: doctorId,
                Present: currentTime
            }
        });

    } catch (error) {
        log.error('Error in quick check-in:', error);
        return ErrorResponses.internalError(res, 'Failed to check in patient', error);
    }
});

export default router;
