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

import { Router, type Request, type Response } from 'express';
import type { EventEmitter } from 'events';
import * as database from '../../services/database/index.js';
import {
  getPresentAps,
  updatePresent,
  undoAppointmentState
} from '../../services/database/queries/appointment-queries.js';
import { WebSocketEvents } from '../../services/messaging/websocket-events.js';
import { ErrorResponses } from '../../utils/error-response.js';
import { log } from '../../utils/logger.js';
import {
  validateAndCreateAppointment,
  quickCheckIn,
  getDailyAppointments,
  AppointmentValidationError
} from '../../services/business/AppointmentService.js';

const router = Router();

// WebSocket emitter will be injected to avoid circular imports
let wsEmitter: EventEmitter | null = null;

/**
 * Set the WebSocket emitter reference
 */
export function setWebSocketEmitter(emitter: EventEmitter): void {
  wsEmitter = emitter;
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface AppointmentQueryParams {
  PDate?: string;
  AppsDate?: string;
}

interface AppointmentStateBody {
  appointmentID: number;
  state: string;
  time?: string;
}

interface CreateAppointmentBody {
  PersonID: number;
  AppDate: string;
  AppDetail: string;
  DrID: number;
}

interface UpdateAppointmentBody {
  PersonID: number;
  AppDate: string;
  AppDetail: string;
  DrID: number;
}

interface QuickCheckInBody {
  PersonID: number;
  AppDetail: string;
  DrID: number;
}

interface AppointmentDetail {
  ID: number;
  Detail: string;
}

interface AppointmentResult {
  appointmentID: number;
  PersonID: number;
  AppDate: string;
  AppDetail: string;
  DrID: number;
  DrName: string | null;
}

// ============================================================================
// APPOINTMENT LOOKUP ROUTES
// ============================================================================

/**
 * Get appointment details/types from tblDetail
 * Used for dropdown menus and appointment type selection
 */
router.get(
  '/appointment-details',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const query = `SELECT ID, Detail FROM tblDetail ORDER BY Detail`;
      const details = await database.executeQuery<AppointmentDetail>(
        query,
        [],
        (columns) => ({
          ID: columns[0].value as number,
          Detail: columns[1].value as string
        })
      );
      res.json(details);
    } catch (error) {
      log.error('Error fetching appointment details:', error);
      ErrorResponses.internalError(
        res,
        'Failed to fetch appointment details',
        error as Error
      );
    }
  }
);

// ============================================================================
// APPOINTMENT UPDATE NOTIFICATION
// ============================================================================

/**
 * Notify that appointments were updated
 * Triggers WebSocket event to refresh appointment views across all clients
 */
router.get(
  '/AppsUpdated',
  async (
    req: Request<unknown, unknown, unknown, AppointmentQueryParams>,
    res: Response
  ): Promise<void> => {
    res.sendStatus(200);
    const { PDate } = req.query;
    log.info(`AppsUpdated called with date: ${PDate}`);

    // Emit universal event only
    if (wsEmitter) {
      wsEmitter.emit(WebSocketEvents.DATA_UPDATED, PDate);
    }
  }
);

// ============================================================================
// DAILY APPOINTMENTS ROUTES
// ============================================================================

/**
 * Get current web apps (present appointments)
 * Returns appointments that have been checked in for the specified date
 */
router.get(
  '/getWebApps',
  async (
    req: Request<unknown, unknown, unknown, AppointmentQueryParams>,
    res: Response
  ): Promise<void> => {
    const { PDate } = req.query;
    const result = await getPresentAps(PDate as string);
    res.json(result);
  }
);

/**
 * Get daily appointments (OPTIMIZED - Phase 2)
 * Unified endpoint that replaces getAllTodayApps + getPresentTodayApps
 * Returns all appointment data in a single API call with 80% performance improvement
 *
 * Returns:
 * - allAppointments: Appointments not yet checked in
 * - checkedInAppointments: Appointments that have been checked in
 * - stats: Aggregated statistics (total, checkedIn, absent, waiting)
 */
router.get(
  '/getDailyAppointments',
  async (
    req: Request<unknown, unknown, unknown, AppointmentQueryParams>,
    res: Response
  ): Promise<void> => {
    try {
      const { AppsDate } = req.query;

      if (!AppsDate) {
        ErrorResponses.badRequest(res, 'AppsDate query parameter is required');
        return;
      }

      // Delegate to service layer
      const result = await getDailyAppointments(AppsDate);

      res.json(result);
    } catch (error) {
      log.error('Error fetching daily appointments (optimized):', error);

      // Handle validation errors from service layer
      if (error instanceof AppointmentValidationError) {
        ErrorResponses.badRequest(res, error.message, {
          code: error.code,
          ...error.details
        });
        return;
      }

      ErrorResponses.internalError(
        res,
        'Failed to fetch daily appointments',
        error as Error
      );
    }
  }
);

// ============================================================================
// APPOINTMENT STATE MANAGEMENT
// ============================================================================

/**
 * Update patient appointment state (Present, Seated, or Dismissed)
 * SIMPLIFIED: Direct update, broadcast date only
 */
router.post(
  '/updateAppointmentState',
  async (
    req: Request<unknown, unknown, AppointmentStateBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { appointmentID, state, time } = req.body;
      if (!appointmentID || !state) {
        ErrorResponses.badRequest(
          res,
          'Missing required parameters: appointmentID, state'
        );
        return;
      }

      const now = new Date();
      const currentTime =
        time ||
        `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      log.info(
        `Updating appointment ${appointmentID} with state: ${state}, time: ${currentTime}`
      );

      // Direct update - no transaction complexity
      await updatePresent(appointmentID, state, currentTime);

      // Broadcast to WebSocket - just the date, clients will reload
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const appointmentDate = `${year}-${month}-${day}`;

      if (wsEmitter) {
        log.info(`Broadcasting state change for appointment ${appointmentID}`);
        wsEmitter.emit(WebSocketEvents.DATA_UPDATED, appointmentDate);
      }

      res.json({
        success: true,
        appointmentID,
        state,
        time: currentTime
      });
    } catch (error) {
      log.error('Error updating appointment state:', error);
      ErrorResponses.internalError(
        res,
        'Failed to update appointment state',
        error as Error
      );
    }
  }
);

/**
 * Undo appointment state by setting field to NULL
 * SIMPLIFIED: Direct undo, broadcast date only
 */
router.post(
  '/undoAppointmentState',
  async (
    req: Request<unknown, unknown, AppointmentStateBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { appointmentID, state } = req.body;
      if (!appointmentID || !state) {
        ErrorResponses.badRequest(
          res,
          'Missing required parameters: appointmentID, state'
        );
        return;
      }

      log.info(`Undoing appointment ${appointmentID} state: ${state}`);
      const result = await undoAppointmentState(appointmentID, state);

      // Broadcast to WebSocket - just the date, clients will reload
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const appointmentDate = `${year}-${month}-${day}`;

      if (wsEmitter) {
        wsEmitter.emit(WebSocketEvents.DATA_UPDATED, appointmentDate);
      }

      res.json(result);
    } catch (error) {
      log.error('Error undoing appointment state:', error);

      // Check for validation errors from stored procedure
      const err = error as Error;
      if (
        err.message &&
        (err.message.includes('Cannot undo check-in') ||
          err.message.includes('Cannot undo seated'))
      ) {
        ErrorResponses.badRequest(res, err.message, {
          code: 'INVALID_STATE_TRANSITION',
          appointmentID: req.body.appointmentID,
          state: req.body.state
        });
        return;
      }

      ErrorResponses.internalError(
        res,
        'Failed to undo appointment state',
        error as Error
      );
    }
  }
);

// ============================================================================
// APPOINTMENT CRUD OPERATIONS
// ============================================================================

/**
 * Create new appointment
 * Validates patient, doctor, date, and checks for conflicts before creating
 */
router.post(
  '/appointments',
  async (
    req: Request<unknown, unknown, CreateAppointmentBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { PersonID, AppDate, AppDetail, DrID } = req.body;

      // Delegate to service layer for validation and creation
      const appointment = await validateAndCreateAppointment({
        PersonID,
        AppDate,
        AppDetail,
        DrID
      });

      // Emit WebSocket event for real-time updates
      if (wsEmitter) {
        // Use the AppDate as-is if it's already in YYYY-MM-DD format
        // Otherwise extract date from Date object using local time
        let appointmentDay: string;
        if (
          typeof AppDate === 'string' &&
          AppDate.match(/^\d{4}-\d{2}-\d{2}$/)
        ) {
          appointmentDay = AppDate;
        } else {
          const appointmentDate = new Date(AppDate);
          const year = appointmentDate.getFullYear();
          const month = String(appointmentDate.getMonth() + 1).padStart(2, '0');
          const day = String(appointmentDate.getDate()).padStart(2, '0');
          appointmentDay = `${year}-${month}-${day}`;
        }
        wsEmitter.emit(WebSocketEvents.DATA_UPDATED, appointmentDay);
      }

      res.json({
        success: true,
        appointmentID: appointment.appointmentID,
        message: 'Appointment created successfully',
        appointment
      });
    } catch (error) {
      log.error('Error creating appointment:', error);

      // Handle validation errors from service layer
      if (error instanceof AppointmentValidationError) {
        if (error.code === 'APPOINTMENT_CONFLICT') {
          ErrorResponses.conflict(res, error.message, error.details);
          return;
        }
        ErrorResponses.badRequest(res, error.message, {
          code: error.code,
          ...error.details
        });
        return;
      }

      ErrorResponses.internalError(
        res,
        'Failed to create appointment',
        error as Error
      );
    }
  }
);

/**
 * Get all appointments for a specific patient
 * Returns appointment history ordered by date (newest first)
 */
router.get(
  '/patient-appointments/:personId',
  async (
    req: Request<{ personId: string }>,
    res: Response
  ): Promise<void> => {
    try {
      const { personId } = req.params;

      if (!personId || isNaN(parseInt(personId))) {
        ErrorResponses.badRequest(res, 'Invalid person ID');
        return;
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

      const appointments = await database.executeQuery<AppointmentResult>(
        query,
        [['personID', database.TYPES.Int, parseInt(personId)]],
        (columns) => ({
          appointmentID: columns[0].value as number,
          PersonID: columns[1].value as number,
          AppDate: columns[2].value as string,
          AppDetail: columns[3].value as string,
          DrID: columns[4].value as number,
          DrName: columns[5].value as string | null
        })
      );

      res.json({
        success: true,
        appointments: appointments || []
      });
    } catch (error) {
      log.error('Error fetching patient appointments:', error);
      ErrorResponses.internalError(
        res,
        'Failed to fetch appointments',
        error as Error
      );
    }
  }
);

/**
 * Get single appointment by ID
 * Returns detailed information for a specific appointment
 */
router.get(
  '/appointments/:appointmentId',
  async (
    req: Request<{ appointmentId: string }>,
    res: Response
  ): Promise<void> => {
    try {
      const { appointmentId } = req.params;

      if (!appointmentId || isNaN(parseInt(appointmentId))) {
        ErrorResponses.badRequest(res, 'Invalid appointment ID');
        return;
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

      const result = await database.executeQuery<AppointmentResult>(query, [
        ['appointmentId', database.TYPES.Int, parseInt(appointmentId)]
      ]);

      if (!result || result.length === 0) {
        ErrorResponses.notFound(res, 'Appointment');
        return;
      }

      res.json({
        success: true,
        appointment: result[0]
      });
    } catch (error) {
      log.error('Error fetching appointment:', error);
      ErrorResponses.internalError(
        res,
        'Failed to fetch appointment',
        error as Error
      );
    }
  }
);

/**
 * Update appointment
 * Modifies existing appointment details
 */
router.put(
  '/appointments/:appointmentId',
  async (
    req: Request<{ appointmentId: string }, unknown, UpdateAppointmentBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { appointmentId } = req.params;
      const { PersonID, AppDate, AppDetail, DrID } = req.body;

      if (!appointmentId || isNaN(parseInt(appointmentId))) {
        ErrorResponses.badRequest(res, 'Invalid appointment ID');
        return;
      }

      // Validate required fields
      if (!PersonID || !AppDate || !AppDetail || !DrID) {
        ErrorResponses.badRequest(
          res,
          'PersonID, AppDate, AppDetail, and DrID are required'
        );
        return;
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
        ['PersonID', database.TYPES.Int, PersonID],
        ['AppDate', database.TYPES.NVarChar, AppDate], // Pass as string, SQL Server will cast
        ['AppDetail', database.TYPES.NVarChar, AppDetail],
        ['DrID', database.TYPES.Int, DrID]
      ]);

      res.json({
        success: true,
        message: 'Appointment updated successfully'
      });
    } catch (error) {
      log.error('Error updating appointment:', error);
      ErrorResponses.internalError(
        res,
        'Failed to update appointment',
        error as Error
      );
    }
  }
);

/**
 * Delete appointment
 * Removes an appointment from the system
 */
router.delete(
  '/appointments/:appointmentId',
  async (
    req: Request<{ appointmentId: string }>,
    res: Response
  ): Promise<void> => {
    try {
      const { appointmentId } = req.params;

      if (!appointmentId || isNaN(parseInt(appointmentId))) {
        ErrorResponses.badRequest(res, 'Invalid appointment ID');
        return;
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
      ErrorResponses.internalError(
        res,
        'Failed to delete appointment',
        error as Error
      );
    }
  }
);

// ============================================================================
// QUICK CHECK-IN
// ============================================================================

/**
 * Quick check-in: Add patient to today's appointments and mark as present
 * Creates appointment and checks in patient in a single operation
 * If appointment exists for today, just marks as present
 */
router.post(
  '/appointments/quick-checkin',
  async (
    req: Request<unknown, unknown, QuickCheckInBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { PersonID, AppDetail, DrID } = req.body;

      // Delegate to service layer for quick check-in logic
      const result = await quickCheckIn({
        PersonID,
        AppDetail,
        DrID
      });

      // Emit WebSocket event for real-time updates
      if (wsEmitter) {
        // Use local date (not UTC) to match client's date format
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const todayDateOnly = `${year}-${month}-${day}`;
        wsEmitter.emit(WebSocketEvents.DATA_UPDATED, todayDateOnly);
      }

      res.json(result);
    } catch (error) {
      log.error('Error in quick check-in:', error);

      // Handle validation errors from service layer
      if (error instanceof AppointmentValidationError) {
        ErrorResponses.badRequest(res, error.message, {
          code: error.code,
          ...error.details
        });
        return;
      }

      ErrorResponses.internalError(
        res,
        'Failed to check in patient',
        error as Error
      );
    }
  }
);

export default router;
