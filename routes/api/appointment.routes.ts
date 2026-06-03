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
import { sql } from 'kysely';
import { getKysely } from '../../services/database/kysely.js';
import {
  getPresentAps,
  updatePresent,
  undoAppointmentState
} from '../../services/database/queries/appointment-queries.js';
import { InternalEmitterEvents } from '../../services/messaging/websocket-events.js';
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
  appointment_id: number;
  state: string;
  time?: string;
}

interface CreateAppointmentBody {
  person_id: number;
  app_date: string;
  app_detail: string;
  dr_id: number;
}

interface UpdateAppointmentBody {
  person_id: number;
  app_date: string;
  app_detail: string;
  dr_id: number;
}

interface QuickCheckInBody {
  person_id: number;
  app_detail: string;
  dr_id: number;
}

interface AppointmentDetail {
  id: number;
  detail: string;
}

interface AppointmentResult {
  appointment_id: number;
  person_id: number;
  app_date: string;
  app_detail: string;
  dr_id: number;
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
      const db = getKysely();
      const { rows } = await sql<AppointmentDetail>`
        SELECT "id", "detail" FROM "details" ORDER BY "detail"
      `.execute(db);
      res.json(rows);
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
 * Update patient appointment state (present, seated, or dismissed)
 * SIMPLIFIED: Direct update, broadcast date only
 */
router.post(
  '/updateAppointmentState',
  async (
    req: Request<unknown, unknown, AppointmentStateBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { appointment_id, state, time } = req.body;
      if (!appointment_id || !state) {
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
        `Updating appointment ${appointment_id} with state: ${state}, time: ${currentTime}`
      );

      // Direct update - no transaction complexity
      await updatePresent(appointment_id, state, currentTime);

      // Broadcast to WebSocket - just the date, clients will reload
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const appointmentDate = `${year}-${month}-${day}`;

      if (wsEmitter) {
        log.info(`Broadcasting state change for appointment ${appointment_id}`);
        wsEmitter.emit(InternalEmitterEvents.DATA_UPDATED, appointmentDate);
      }

      res.json({
        success: true,
        appointment_id,
        state,
        time: currentTime
      });
    } catch (error) {
      log.error('Error updating appointment state:', error);

      // state-machine rejection from the UpdatePresent proc — the caller's view
      // of the appointment was stale (typical cause: missed WebSocket update).
      const err = error as Error;
      if (err.message && err.message.includes('[INVALID_STATE_TRANSITION]')) {
        ErrorResponses.badRequest(res, err.message, {
          code: 'INVALID_STATE_TRANSITION',
          appointment_id: req.body.appointment_id,
          attempted: req.body.state
        });
        return;
      }

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
      const { appointment_id, state } = req.body;
      if (!appointment_id || !state) {
        ErrorResponses.badRequest(
          res,
          'Missing required parameters: appointmentID, state'
        );
        return;
      }

      log.info(`Undoing appointment ${appointment_id} state: ${state}`);
      const result = await undoAppointmentState(appointment_id, state);

      // Broadcast to WebSocket - just the date, clients will reload
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const appointmentDate = `${year}-${month}-${day}`;

      if (wsEmitter) {
        wsEmitter.emit(InternalEmitterEvents.DATA_UPDATED, appointmentDate);
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
          appointment_id: req.body.appointment_id,
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
      const { person_id, app_date, app_detail, dr_id } = req.body;

      // Delegate to service layer for validation and creation
      const appointment = await validateAndCreateAppointment({
        person_id,
        app_date,
        app_detail,
        dr_id
      });

      // Emit WebSocket event for real-time updates
      if (wsEmitter) {
        // Use the app_date as-is if it's already in YYYY-MM-DD format
        // Otherwise extract date from Date object using local time
        let appointmentDay: string;
        if (
          typeof app_date === 'string' &&
          app_date.match(/^\d{4}-\d{2}-\d{2}$/)
        ) {
          appointmentDay = app_date;
        } else {
          const appointmentDate = new Date(app_date);
          const year = appointmentDate.getFullYear();
          const month = String(appointmentDate.getMonth() + 1).padStart(2, '0');
          const day = String(appointmentDate.getDate()).padStart(2, '0');
          appointmentDay = `${year}-${month}-${day}`;
        }
        wsEmitter.emit(InternalEmitterEvents.DATA_UPDATED, appointmentDay);
      }

      res.json({
        success: true,
        appointment_id: appointment.appointment_id,
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
        ErrorResponses.badRequest(res, 'Invalid person id');
        return;
      }

      const db = getKysely();
      const { rows } = await sql<AppointmentResult>`
            SELECT
                a."appointment_id",
                a."person_id",
                to_char(a."app_date", 'YYYY-MM-DD"T"HH24:MI:SS') AS "app_date",
                a."app_detail",
                a."dr_id",
                e."employee_name" AS "DrName"
            FROM "appointments" a
            LEFT JOIN "employees" e ON a."dr_id" = e."id"
            WHERE a."person_id" = ${parseInt(personId)}
            ORDER BY a."app_date" DESC
        `.execute(db);

      res.json({
        success: true,
        appointments: rows || []
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
 * Get single appointment by id
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
        ErrorResponses.badRequest(res, 'Invalid appointment id');
        return;
      }

      const db = getKysely();
      const { rows } = await sql<AppointmentResult>`
            SELECT
                a."appointment_id",
                a."person_id",
                to_char(a."app_date", 'YYYY-MM-DD"T"HH24:MI:SS') AS "app_date",
                a."app_detail",
                a."dr_id",
                e."employee_name" AS "DrName"
            FROM "appointments" a
            LEFT JOIN "employees" e ON a."dr_id" = e."id"
            WHERE a."appointment_id" = ${parseInt(appointmentId)}
        `.execute(db);

      if (!rows || rows.length === 0) {
        ErrorResponses.notFound(res, 'Appointment');
        return;
      }

      res.json({
        success: true,
        appointment: rows[0]
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
      const { person_id, app_date, app_detail, dr_id } = req.body;

      if (!appointmentId || isNaN(parseInt(appointmentId))) {
        ErrorResponses.badRequest(res, 'Invalid appointment id');
        return;
      }

      // Validate required fields
      if (!person_id || !app_date || !app_detail || !dr_id) {
        ErrorResponses.badRequest(
          res,
          'person_id, app_date, app_detail, and dr_id are required'
        );
        return;
      }

      // Cast the app_date string to timestamp on the PG side to avoid timezone conversion
      const db = getKysely();
      await sql`
            UPDATE "appointments"
            SET "person_id" = ${person_id},
                "app_date" = ${app_date}::timestamp,
                "app_detail" = ${app_detail},
                "dr_id" = ${dr_id}
            WHERE "appointment_id" = ${parseInt(appointmentId)}
        `.execute(db);

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
        ErrorResponses.badRequest(res, 'Invalid appointment id');
        return;
      }

      const db = getKysely();
      await sql`
        DELETE FROM "appointments" WHERE "appointment_id" = ${parseInt(appointmentId)}
      `.execute(db);

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
      const { person_id, app_detail, dr_id } = req.body;

      // Delegate to service layer for quick check-in logic
      const result = await quickCheckIn({
        person_id,
        app_detail,
        dr_id
      });

      // Emit WebSocket event for real-time updates
      if (wsEmitter) {
        // Use local date (not UTC) to match client's date format
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const todayDateOnly = `${year}-${month}-${day}`;
        wsEmitter.emit(InternalEmitterEvents.DATA_UPDATED, todayDateOnly);
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
