/**
 * Alert API Routes
 *
 * Split out of `patient.routes.ts` (C1 — pure move). One table, two surfaces:
 * the per-patient Alerts panel (`/patients/:personId/alerts`) and the app-wide
 * header Tasks bell, which reads the same rows through `task.routes.ts`. The
 * `surface_mode` column is what separates a pushed task from a contextual alert
 * — see the alert-queries module.
 *
 * Mounted at `/api` alongside `patient.routes.ts`, so the paths below are the
 * full ones minus that prefix — unchanged by the move.
 */

import { Router, type Request, type Response } from 'express';
import { log } from '../../utils/logger.js';
import {
  getAlertsByPersonId,
  createAlert,
  setAlertStatus,
  setAlertSnooze,
  updateAlert,
  getAlertAssignedTo
} from '../../services/database/queries/alert-queries.js';
import { employeeIsActive } from '../../services/database/queries/employee-queries.js';
import { notifyTaskAssignment } from '../../services/messaging/task-notify.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { CLINICAL_ROLES } from '../../shared/auth/roles.js';
import { ErrorResponses, sendSuccess, sendData } from '../../utils/error-response.js';
import { validate } from '../../middleware/validate.js';
import * as patientContract from '../../shared/contracts/patient.contract.js';

const router = Router();

const { personIdParams, alertIdParams } = patientContract;


/**
 * Get alerts for a patient
 * GET /patients/:personId/alerts
 */
router.get(
  '/patients/:personId/alerts',
  authenticate,
  async (
    req: Request<{ personId: string }>,
    res: Response
  ): Promise<void> => {
    try {
      const personId = parseInt(req.params.personId, 10);

      if (isNaN(personId)) {
        log.warn('Get alerts invalid patient id', { personId: req.params.personId });
        ErrorResponses.badRequest(res, 'Invalid patient id');
        return;
      }

      const alerts = await getAlertsByPersonId(personId);
      sendData(res, patientContract.alerts.response, alerts);
    } catch (error) {
      log.error('Error fetching patient alerts:', error);
      ErrorResponses.internalError(
        res,
        'Failed to fetch alerts',
        error as Error
      );
    }
  }
);

/**
 * Create a new alert for a patient
 * POST /patients/:personId/alerts
 */
router.post(
  '/patients/:personId/alerts',
  authenticate,
  authorize(CLINICAL_ROLES),
  validate({ params: personIdParams, body: patientContract.alertBody }),
  async (
    req: Request<{ personId: string }, unknown, patientContract.AlertBody>,
    res: Response
  ): Promise<void> => {
    try {
      const personId = parseInt(req.params.personId, 10);
      const { alertTypeId, alertSeverity, alertDetails, surfaceMode, expiresAt, escalateAt, assignedTo } = req.body;

      if (!alertDetails) {
        log.warn('Create alert missing details', { personId });
        ErrorResponses.badRequest(res, 'Alert details are required');
        return;
      }

      // Quit employees can't be newly assigned (hidden everywhere but Settings).
      if (assignedTo != null && !(await employeeIsActive(assignedTo))) {
        ErrorResponses.badRequest(res, 'Cannot assign to an inactive (quit) employee');
        return;
      }

      // Use defaults for quick-add (alertTypeId=1 General). The contract has already
      // coerced both to positive integers, so the old `x ? parseInt(String(x), 10) : d`
      // dance both re-parsed a number and treated id 0 as "unset".
      await createAlert({
        person_id: personId,
        alert_type_id: alertTypeId ?? 1,
        alert_severity: alertSeverity,
        alert_details: alertDetails,
        surface_mode: surfaceMode,
        expires_at: expiresAt,
        escalate_at: escalateAt,
        assigned_to: assignedTo ?? null,
      });

      // Notify the assignee over WhatsApp (fire-and-forget; never blocks/fails the create).
      if (assignedTo != null) {
        void notifyTaskAssignment(assignedTo, alertDetails);
      }

      sendSuccess(res, null, 'Alert created successfully', 201);
    } catch (error) {
      log.error('Error creating alert:', error);
      ErrorResponses.internalError(
        res,
        'Failed to create alert',
        error as Error
      );
    }
  }
);

/**
 * Activate or deactivate an alert
 * PUT /alerts/:alertId/status
 */
router.put(
  '/alerts/:alertId/status',
  authenticate,
  authorize(CLINICAL_ROLES),
  validate({ params: alertIdParams, body: patientContract.alertStatus.body }),
  async (
    req: Request<{ alertId: string }, unknown, patientContract.AlertStatusBody>,
    res: Response
  ): Promise<void> => {
    try {
      const alertId = parseInt(req.params.alertId, 10);
      const { status } = req.body;

      await setAlertStatus(alertId, status, req.session.username ?? null);

      sendSuccess(res, null, `Alert status updated to ${status}`);
    } catch (error) {
      log.error('Error updating alert status:', error);
      ErrorResponses.internalError(
        res,
        'Failed to update alert status',
        error as Error
      );
    }
  }
);

/**
 * Update an alert
 * PUT /alerts/:alertId
 */
router.put(
  '/alerts/:alertId',
  authenticate,
  authorize(CLINICAL_ROLES),
  validate({ params: alertIdParams, body: patientContract.alertBody }),
  async (
    req: Request<{ alertId: string }, unknown, patientContract.AlertBody>,
    res: Response
  ): Promise<void> => {
    try {
      const alertId = parseInt(req.params.alertId, 10);
      const { alertTypeId, alertSeverity, alertDetails, surfaceMode, expiresAt, escalateAt, assignedTo } = req.body;

      if (isNaN(alertId)) {
        log.warn('Update alert invalid alert id', { alertId: req.params.alertId });
        ErrorResponses.badRequest(res, 'Invalid alert id');
        return;
      }

      if (!alertDetails) {
        log.warn('Update alert missing details', { alertId });
        ErrorResponses.badRequest(res, 'Alert details are required');
        return;
      }

      // Block re-assigning to a quit employee, but allow KEEPING an existing
      // assignment to one — we deliberately leave those in place when an
      // employee quits, so re-saving an already-assigned task must not 400.
      // `isNewAssignee` also gates the WhatsApp notification: only a genuinely
      // changed assignee is notified, so a plain edit/re-save doesn't re-ping them.
      let isNewAssignee = false;
      if (assignedTo != null) {
        const current = await getAlertAssignedTo(alertId);
        isNewAssignee = assignedTo !== current;
        if (isNewAssignee && !(await employeeIsActive(assignedTo))) {
          ErrorResponses.badRequest(res, 'Cannot assign to an inactive (quit) employee');
          return;
        }
      }

      await updateAlert(alertId, {
        alert_type_id: alertTypeId,
        alert_severity: alertSeverity,
        alert_details: alertDetails,
        surface_mode: surfaceMode,
        expires_at: expiresAt,
        escalate_at: escalateAt,
        assigned_to: assignedTo,
      });

      // Notify a newly-assigned employee over WhatsApp (fire-and-forget).
      if (isNewAssignee && assignedTo != null) {
        void notifyTaskAssignment(assignedTo, alertDetails);
      }

      sendSuccess(res, null, 'Alert updated successfully');
    } catch (error) {
      log.error('Error updating alert:', error);
      ErrorResponses.internalError(
        res,
        'Failed to update alert',
        error as Error
      );
    }
  }
);

/**
 * Snooze (or un-snooze) an alert in the header
 * PUT /alerts/:alertId/snooze
 */
router.put(
  '/alerts/:alertId/snooze',
  authenticate,
  authorize(CLINICAL_ROLES),
  validate({ params: alertIdParams, body: patientContract.alertSnooze.body }),
  async (
    req: Request<{ alertId: string }, unknown, patientContract.AlertSnoozeBody>,
    res: Response
  ): Promise<void> => {
    try {
      const alertId = parseInt(req.params.alertId, 10);
      await setAlertSnooze(alertId, req.body.snoozedUntil);
      sendSuccess(res, null, 'Alert snooze updated');
    } catch (error) {
      log.error('Error snoozing alert:', error);
      ErrorResponses.internalError(res, 'Failed to snooze alert', error as Error);
    }
  }
);
export default router;
