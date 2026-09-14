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
import {
  updatePresent,
  undoAppointmentState,
  listAppointmentDetails,
  getPatientAppointments,
  getAppointmentById,
  deleteAppointment
} from '../../services/database/queries/appointment-queries.js';
import { InternalEmitterEvents } from '../../services/messaging/websocket-events.js';
import { ErrorResponses, sendSuccess, sendData } from '../../utils/error-response.js';
import { validate } from '../../middleware/validate.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { CLINICAL_ROLES } from '../../shared/auth/roles.js';
import * as appointment from '../../shared/contracts/appointment.contract.js';
import { log } from '../../utils/logger.js';
import { toDateOnly } from '../../utils/date.js';
import {
  validateAndCreateAppointment,
  validateAndUpdateAppointment,
  quickCheckIn,
  getDailyAppointments,
  AppointmentValidationError
} from '../../services/business/AppointmentService.js';

const router = Router();

// Every appointment route is clinical (book/check-in/edit/delete), but the
// gate is attached PER ROUTE, never via a pathless router.use(): this router
// is mounted at the /api root (routes/api/index.ts), so a router-level gate
// would also run for every /api/* request merely passing through to a
// later-mounted router — it once 403'd the entire API for a session carrying
// a stale role.
const clinicalOnly = [authenticate, authorize(CLINICAL_ROLES)];

// WebSocket emitter will be injected to avoid circular imports
let wsEmitter: EventEmitter | null = null;

/**
 * Set the WebSocket emitter reference
 */
export function setWebSocketEmitter(emitter: EventEmitter): void {
  wsEmitter = emitter;
}

/**
 * Emit a DATA_UPDATED frame for each distinct day an appointment write touched.
 *
 * Every mutating handler in this file must call this — the realtime refresh is
 * hand-wired per handler, so an omission is invisible until a second staff
 * member's board goes stale. Nulls and duplicates are dropped, so a same-day
 * edit broadcasts once and a row with no `app_day` broadcasts nothing.
 */
function broadcastDays(...days: (string | null | undefined)[]): void {
  if (!wsEmitter) return;
  for (const day of new Set(days.filter((d): d is string => !!d))) {
    wsEmitter.emit(InternalEmitterEvents.DATA_UPDATED, day);
  }
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

type AppointmentQueryParams = appointment.AppointmentQueryParams;

type QuickCheckInBody = appointment.QuickCheckinBody;

// ============================================================================
// APPOINTMENT LOOKUP ROUTES
// ============================================================================

/**
 * Get appointment details/types from tblDetail
 * Used for dropdown menus and appointment type selection
 */
router.get(
  '/appointment-details',
  clinicalOnly,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      sendData(res, appointment.appointmentDetails.response, await listAppointmentDetails());
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
  clinicalOnly,
  validate({ query: appointment.appointmentQuery }),
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

      sendData(res, appointment.dailyAppointments.response, result);
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
  clinicalOnly,
  validate({ body: appointment.updateAppointmentState.body }),
  async (
    req: Request<unknown, unknown, appointment.AppointmentStateBody>,
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
      const { appDay } = await updatePresent(appointment_id, state, currentTime);

      // Broadcast the APPOINTMENT's own day, not today's. Checking a patient in
      // for another day used to refresh today's viewers while the day that
      // actually changed never updated. `app_day` is a `date` column, so the pg
      // parser already hands it back as 'YYYY-MM-DD' — the broadcast key's exact
      // shape. Falling back to today only covers a NULL `app_day`.
      log.info(`Broadcasting state change for appointment ${appointment_id}`);
      broadcastDays(appDay ?? toDateOnly(now));

      sendData(res, appointment.updateAppointmentState.response, {
        appointment_id,
        state,
        time: currentTime,
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
  clinicalOnly,
  validate({ body: appointment.undoAppointmentState.body }),
  async (
    req: Request<unknown, unknown, appointment.AppointmentStateBody>,
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
      // `appDay` is the SSE broadcast key and is deliberately NOT part of the
      // contracted response — split it off here (same reasoning as the check-in
      // handler above: broadcast the appointment's day, not the server's today).
      const { appDay, ...result } = await undoAppointmentState(appointment_id, state);
      broadcastDays(appDay ?? toDateOnly(new Date()));

      sendData(res, appointment.undoAppointmentState.response, result);
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
  clinicalOnly,
  validate({ body: appointment.createAppointment.body }),
  async (
    req: Request<unknown, unknown, appointment.CreateAppointmentBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { person_id, app_date, app_detail, dr_id } = req.body;

      // Delegate to service layer for validation and creation
      // (named `createdAppointment` to avoid shadowing the `appointment` contract import)
      const createdAppointment = await validateAndCreateAppointment({
        person_id,
        app_date,
        app_detail,
        dr_id
      });

      // `appDay` is the row's own generated day, split off here so the contracted
      // payload is unchanged. It replaces a 12-line hand-rolled copy of
      // `toDateOnly` that parsed the REQUEST's `app_date` — correct for the shapes
      // the staff forms send, and one more place to fix when they change.
      const { appDay, ...createdAppointmentPayload } = createdAppointment;
      broadcastDays(appDay);

      sendData(
        res,
        appointment.createAppointment.response,
        {
          appointment_id: createdAppointmentPayload.appointment_id,
          appointment: createdAppointmentPayload,
        },
        'Appointment created successfully'
      );
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
  clinicalOnly,
  async (
    req: Request<{ personId: string }>,
    res: Response
  ): Promise<void> => {
    try {
      const { personId } = req.params;

      if (!personId || isNaN(parseInt(personId, 10))) {
        ErrorResponses.badRequest(res, 'Invalid person id');
        return;
      }

      const appointments = await getPatientAppointments(parseInt(personId, 10));

      sendData(res, appointment.patientAppointments.response, { appointments });
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
  clinicalOnly,
  async (
    req: Request<{ appointmentId: string }>,
    res: Response
  ): Promise<void> => {
    try {
      const { appointmentId } = req.params;

      if (!appointmentId || isNaN(parseInt(appointmentId, 10))) {
        ErrorResponses.badRequest(res, 'Invalid appointment id');
        return;
      }

      const row = await getAppointmentById(parseInt(appointmentId, 10));

      if (!row) {
        ErrorResponses.notFound(res, 'Appointment');
        return;
      }

      sendData(res, appointment.appointmentById.response, { appointment: row });
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
  clinicalOnly,
  validate({ params: appointment.updateAppointment.params, body: appointment.updateAppointment.body }),
  async (
    req: Request<{ appointmentId: string }, unknown, appointment.UpdateAppointmentBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { appointmentId } = req.params;
      const { person_id, app_date, app_detail, dr_id } = req.body;

      // params + body are validated by the validate() middleware above
      // (appointment.updateAppointment.params + .body): appointmentId is a
      // digit string, the ids are positive ints, and app_date/app_detail are
      // non-empty strings — so no manual re-check is needed here.
      //
      // The service runs the SAME holiday / doctor / double-booking checks the
      // POST path runs. Without them a slot that could not be booked directly
      // was reachable by booking elsewhere and editing into it.
      const { previousDay, newDay } = await validateAndUpdateAppointment(
        parseInt(appointmentId, 10),
        { person_id, app_date, app_detail, dr_id }
      );

      // Refresh viewers of BOTH days — the one the appointment left and the one
      // it landed on. This used to broadcast nothing at all, so an edited
      // appointment stayed on every other board until a manual reload.
      broadcastDays(previousDay, newDay);

      sendSuccess(res, null, 'Appointment updated successfully');
    } catch (error) {
      if (error instanceof AppointmentValidationError) {
        if (error.code === 'APPOINTMENT_NOT_FOUND') {
          ErrorResponses.notFound(res, 'Appointment');
          return;
        }
        ErrorResponses.badRequest(res, error.message, {
          code: error.code,
          ...(error.details ?? {}),
        });
        return;
      }
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
  clinicalOnly,
  validate({ params: appointment.deleteAppointment.params }),
  async (
    req: Request<{ appointmentId: string }>,
    res: Response
  ): Promise<void> => {
    try {
      const { appointmentId } = req.params;

      if (!appointmentId || isNaN(parseInt(appointmentId, 10))) {
        ErrorResponses.badRequest(res, 'Invalid appointment id');
        return;
      }

      // The deleted appointment's day is the broadcast key; the query reads it
      // BEFORE the DELETE, since after it there is no row left to read it from.
      // (This handler used to broadcast nothing, so a cancelled appointment
      // stayed on every other staff member's board until they reloaded.)
      const deletedDay = await deleteAppointment(parseInt(appointmentId, 10));

      broadcastDays(deletedDay);

      sendSuccess(res, null, 'Appointment deleted successfully');
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
  clinicalOnly,
  validate({ body: appointment.quickCheckin.body }),
  async (
    req: Request<unknown, unknown, QuickCheckInBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { person_id, app_detail, dr_id } = req.body;

      // Delegate to service layer for quick check-in logic. `appDay` is the touched
      // row's own day (split off — not part of the contracted response); it replaces
      // a freshly computed "today", which was right only because the walk-in lookup
      // filters on today anyway.
      const { appDay, ...result } = await quickCheckIn({
        person_id,
        app_detail,
        dr_id
      });

      broadcastDays(appDay);

      sendData(res, appointment.quickCheckin.response, result);
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
