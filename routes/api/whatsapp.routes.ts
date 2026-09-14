/**
 * WhatsApp message-sending routes + the daily-appointments group settings.
 *
 * This module contains:
 * - Message sending (batch by date, receipt, appointment, resend)
 * - The appointments-PDF group settings the batch send reads
 *
 * Two sibling routers were split out of this file (S2/C6) and mount at the same
 * `/api/wa` prefix immediately after it: `whatsapp-media.routes.ts` (the /sendmedia*
 * uploads) and `whatsapp-session.routes.ts` (QR/status + client lifecycle).
 *
 * All routes support real-time SSE updates for status changes.
 */

import { Router, type Request, type Response } from 'express';

// Services
import whatsapp from '../../services/messaging/whatsapp.js';
import { getGroupSettings, saveGroupSettings } from '../../services/messaging/group-settings.js';
import { getReceiptData } from '../../services/templates/receipt-service.js';
import { getAppointmentForNotification } from '../../services/database/queries/appointment-queries.js';
import { getNewAppointmentMessage } from '../../services/database/queries/messaging-queries.js';
import { toDateOnly } from '../../utils/date.js';

// Utilities
import PhoneFormatter from '../../utils/phone-formatter.js';
import { sendData, sendError, ErrorResponses } from '../../utils/error-response.js';
import { log } from '../../utils/logger.js';
import { timeouts } from '../../middleware/timeout.js';
import { validate } from '../../middleware/validate.js';
import { authorize } from '../../middleware/auth.js';
import { CLINICAL_ROLES, FINANCE_ROLES } from '../../shared/auth/roles.js';
import * as waContract from '../../shared/contracts/whatsapp.contract.js';

const router = Router();

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

// Request bodies are contracted (request-only) in shared/contracts/whatsapp.contract.ts
// (`waContract`) — the handlers type from its `z.infer` exports. Responses stay RAW
// (the client reads top-level fields via the raw apiClient — not the funnel).

// ============================================================================
// WHATSAPP MESSAGE SENDING ROUTES
// ============================================================================

/**
 * Send WhatsApp messages in batch for a specific date
 * POST /send (mounted at /api/wa) — body: { date: 'YYYY-MM-DD' }
 *
 * A MUTATION, and deliberately a POST: as a GET it was exempt from csurf (which
 * ignores safe methods) while the session cookie is `sameSite: 'lax'` and rides
 * along on a top-level cross-site navigation — so a staff member clicking an
 * external link to `…/api/wa/send?date=…` fired a real batch send to every
 * patient booked that day. The date moved into the body with it; the contract's
 * `dateString` now does the format + calendar-validity checks the handler used
 * to open with.
 * note: Uses extended timeout (5 minutes) due to batch processing
 */
router.post(
  '/send',
  authorize(CLINICAL_ROLES),
  timeouts.whatsappSend,
  validate({ body: waContract.sendByDate.body }),
  async (
    req: Request<unknown, unknown, waContract.SendByDateBody>,
    res: Response
  ): Promise<void> => {
    const dateparam = req.body.date;

    try {
      log.info(`WhatsApp send request for validated date: ${dateparam}`);

      // Check if client is ready
      if (!whatsapp.isReady()) {
        const status = whatsapp.getStatus();
        sendError(res, 503, 'Service unavailable', {
          service: 'WhatsApp',
          details:
            'WhatsApp client is not ready. Please wait for initialization to complete.',
          clientStatus: status as Record<string, unknown>,
          requiresRestart: status.circuitBreakerOpen
        });
        return;
      }

      // One batch at a time — a second click while a batch runs used to start a
      // parallel loop that double-sent patients. Raw (un-enveloped) response,
      // like the started case below; the client checks `alreadyInProgress`.
      if (whatsapp.isBatchSending()) {
        log.warn('WhatsApp batch send rejected - a batch is already in progress', {
          date: dateparam
        });
        res.json({
          success: true,
          alreadyInProgress: true,
          message: 'A sending batch is already in progress',
          date: dateparam
        });
        return;
      }

      // Intentional fire-and-forget — send is long-running (bulk WhatsApp); respond immediately.
      whatsapp.send(dateparam).catch((error: Error) => {
        log.error(`Error in WhatsApp send process: ${error.message}`);
      });

      // Respond immediately
      res.json({
        success: true,
        message: 'WhatsApp sending process started',
        htmltext: 'Starting to send messages...',
        date: dateparam
      });
    } catch (error) {
      log.error(`Error starting WhatsApp send: ${(error as Error).message}`);
      ErrorResponses.internalError(res, 'Failed to start sending process', error as Error);
    }
  }
);

/**
 * Send receipt via WhatsApp to patient
 * POST /send-receipt (mounted at /api/wa)
 * Body: { workId: number }
 * Sends receipt details including amount paid, balance, and next appointment
 */
router.post(
  '/send-receipt',
  authorize(CLINICAL_ROLES),
  validate({ body: waContract.sendReceipt.body }),
  async (
    req: Request<unknown, unknown, waContract.SendReceiptBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { workId } = req.body;

      // Validate required parameter
      if (!workId) {
        log.warn('WhatsApp receipt send missing workId');
        ErrorResponses.badRequest(res, 'Missing required parameters', {
          required: ['workId']
        });
        return;
      }

      // Validate workId is numeric
      if (isNaN(parseInt(String(workId), 10))) {
        log.warn('WhatsApp receipt send invalid workId', { workId });
        ErrorResponses.badRequest(res, 'Invalid input', {
          details: 'workId must be a valid number'
        });
        return;
      }

      log.info(`WhatsApp receipt send request - work_id: ${workId}`);

      // Check if WhatsApp client is ready
      if (!whatsapp.isReady()) {
        res.json({
          success: false,
          message: 'WhatsApp not connected'
        });
        return;
      }

      // Get receipt data (includes patient phone, amounts, appointment)
      let receiptData;
      try {
        receiptData = await getReceiptData(parseInt(String(workId), 10));
      } catch (error) {
        log.error(`Failed to get receipt data for work ${workId}:`, error);
        res.json({
          success: false,
          message: 'Work not found'
        });
        return;
      }

      // Extract patient phone
      const patientPhone = receiptData.patient.phone;
      if (!patientPhone || patientPhone.trim() === '') {
        log.warn(`No phone number for patient ${receiptData.patient.person_id}`);
        res.json({
          success: false,
          message: 'No phone number for patient'
        });
        return;
      }

      // Format phone number for WhatsApp
      const phoneNumber = PhoneFormatter.forWhatsApp(patientPhone, '964');

      // Validate phone format
      if (!PhoneFormatter.isValid(phoneNumber, '964')) {
        log.warn(`Invalid phone format: ${patientPhone}`);
        res.json({
          success: false,
          message: 'Invalid phone number'
        });
        return;
      }

      // Compose WhatsApp message
      const message = `Receipt - Shwan Orthodontics

Dear ${receiptData.patient.patient_name},

amount Paid: ${Math.round(receiptData.payment.AmountPaidToday).toLocaleString('en-US')} ${receiptData.payment.currency}
Remaining Balance: ${Math.round(receiptData.payment.RemainingBalance).toLocaleString('en-US')} ${receiptData.payment.currency}
Date: ${new Date().toLocaleDateString('en-GB')}

Thank you for your payment!`;

      log.info(
        `Sending receipt to ${phoneNumber} for patient ${receiptData.patient.patient_name}`
      );

      // Send message via WhatsApp
      const result = await whatsapp.sendMessage(
        phoneNumber,
        message,
        receiptData.patient.patient_name
      );

      if (result.success) {
        log.info(
          `Receipt sent successfully to ${phoneNumber} - MessageID: ${result.messageId}`
        );
        res.json({
          success: true,
          messageId: result.messageId
        });
      } else {
        log.error(`Failed to send receipt: ${result.error}`);
        res.json({
          success: false,
          message: 'Failed to send message'
        });
      }
    } catch (error) {
      log.error(
        `Error sending receipt via WhatsApp: ${(error as Error).message}`
      );
      res.json({
        success: false,
        message: 'Internal error'
      });
    }
  }
);

/**
 * Send appointment confirmation via WhatsApp to patient
 * POST /send-appointment (mounted at /api/wa)
 * Body: { appointmentId: number }
 */
router.post(
  '/send-appointment',
  authorize(CLINICAL_ROLES),
  validate({ body: waContract.sendAppointment.body }),
  async (
    req: Request<unknown, unknown, waContract.SendAppointmentBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { appointmentId } = req.body;

      if (!appointmentId) {
        log.warn('WhatsApp appointment send missing appointmentId');
        ErrorResponses.badRequest(res, 'Missing required parameters', {
          required: ['appointmentId']
        });
        return;
      }

      if (isNaN(parseInt(String(appointmentId), 10))) {
        log.warn('WhatsApp appointment send invalid appointmentId', { appointmentId });
        ErrorResponses.badRequest(res, 'Invalid input', {
          details: 'appointmentId must be a valid number'
        });
        return;
      }

      log.info(`WhatsApp appointment send request - appointment_id: ${appointmentId}`);

      if (!whatsapp.isReady()) {
        res.json({
          success: false,
          message: 'WhatsApp not connected'
        });
        return;
      }

      const appointment = await getAppointmentForNotification(parseInt(String(appointmentId), 10));
      if (!appointment) {
        log.warn(`Appointment not found: ${appointmentId}`);
        res.json({
          success: false,
          message: 'Appointment not found'
        });
        return;
      }

      if (!appointment.phone || appointment.phone.trim() === '') {
        log.warn(`No phone number for patient ${appointment.person_id}`);
        res.json({
          success: false,
          message: 'No phone number for patient'
        });
        return;
      }

      const phoneNumber = PhoneFormatter.forWhatsApp(appointment.phone, '964');
      if (!PhoneFormatter.isValid(phoneNumber, '964')) {
        log.warn(`Invalid phone format: ${appointment.phone}`);
        res.json({
          success: false,
          message: 'Invalid phone number'
        });
        return;
      }

      const appDateObj = new Date(appointment.app_date);
      const appDate = appDateObj.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });
      const dayOfWeek = appDateObj.toLocaleDateString('en-GB', { weekday: 'long' });

      const message = `Shwan Orthodontics

Dear ${appointment.patient_name},

Your appointment is confirmed for:
${appDate} (${dayOfWeek})

Thank you.`;

      log.info(
        `Sending appointment confirmation to ${phoneNumber} for patient ${appointment.patient_name}`
      );

      const result = await whatsapp.sendMessage(
        phoneNumber,
        message,
        appointment.patient_name
      );

      if (result.success) {
        log.info(
          `Appointment confirmation sent successfully to ${phoneNumber} - MessageID: ${result.messageId}`
        );
        res.json({
          success: true,
          messageId: result.messageId
        });
      } else {
        log.error(`Failed to send appointment confirmation: ${result.error}`);
        res.json({
          success: false,
          message: 'Failed to send message'
        });
      }
    } catch (error) {
      log.error(
        `Error sending appointment confirmation via WhatsApp: ${(error as Error).message}`
      );
      res.json({
        success: false,
        message: 'Internal error'
      });
    }
  }
);

/**
 * Re-send the reminder message for a single appointment.
 * POST /resend-appointment (mounted at /api/wa)
 * Body: { appointmentId: number }
 *
 * Powers the right-click → "Re-send" action on the /send status table (retry a
 * failed number without resending the whole day). Rebuilds the same reminder
 * text the batch sender uses, sends it, re-marks the appointment as sent, and
 * re-registers the new message id for live delivery ticks. Enveloped response
 * (consumed via the funnel with { schema }), unlike the legacy raw routes.
 */
router.post(
  '/resend-appointment',
  authorize(CLINICAL_ROLES),
  validate({ body: waContract.resendAppointment.body }),
  async (
    req: Request<unknown, unknown, waContract.ResendAppointmentBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { appointmentId } = req.body;

      log.info(`WhatsApp reminder resend request - appointment_id: ${appointmentId}`);

      if (!whatsapp.isReady()) {
        sendError(res, 503, 'WhatsApp is not connected', { service: 'WhatsApp' });
        return;
      }

      const appointment = await getAppointmentForNotification(appointmentId);
      if (!appointment) {
        ErrorResponses.notFound(res, 'Appointment');
        return;
      }

      const built = await getNewAppointmentMessage(appointment.person_id, appointmentId);
      if (!built || built.result === -1 || !built.message) {
        ErrorResponses.notFound(res, 'Appointment message');
        return;
      }
      if (built.result === -2 || !built.phone) {
        ErrorResponses.badRequest(res, 'Patient has no valid phone number', {
          details: 'Use "Copy message" and send it manually instead.'
        });
        return;
      }

      const appointmentDay = toDateOnly(appointment.app_date);
      const result = await whatsapp.sendMessage(
        built.phone,
        built.message,
        appointment.patient_name,
        appointmentId,
        appointmentDay
      );

      if (!result.success) {
        log.error(`Reminder resend failed for appointment ${appointmentId}: ${result.error}`);
        sendError(res, 502, result.error || 'Failed to send message', {
          service: 'WhatsApp'
        });
        return;
      }

      log.info(
        `Reminder resent for appointment ${appointmentId} - MessageID: ${result.messageId}`
      );
      sendData(res, waContract.resendAppointment.response, {
        appointmentId,
        messageId: result.messageId as string
      });
    } catch (error) {
      log.error(
        `Error resending appointment reminder: ${(error as Error).message}`
      );
      ErrorResponses.internalError(res, 'Failed to resend message', error as Error);
    }
  }
);

// ============================================================================
// APPOINTMENTS GROUP SETTINGS ROUTES
// ============================================================================

/**
 * Get the daily-appointments group settings (whether to post the PDF, and the
 * target group name). Defaults applied for unset options.
 * GET /group-settings (mounted at /api/wa)
 */
router.get('/group-settings', authorize(FINANCE_ROLES), async (_req: Request, res: Response): Promise<void> => {
  try {
    const settings = await getGroupSettings();
    sendData(res, waContract.groupSettings.response, settings);
  } catch (error) {
    log.error('Failed to load WhatsApp group settings', { error: (error as Error).message });
    ErrorResponses.internalError(res, 'Failed to load group settings', error as Error);
  }
});

/**
 * Update the daily-appointments group settings.
 * PUT /group-settings (mounted at /api/wa)
 * Body: { enabled: boolean, groupName: string }
 */
router.put(
  '/group-settings',
  authorize(FINANCE_ROLES),
  validate({ body: waContract.groupSettings.body }),
  async (
    req: Request<unknown, unknown, waContract.GroupSettingsBody>,
    res: Response
  ): Promise<void> => {
    try {
      const saved = await saveGroupSettings(req.body);
      log.info('Updated WhatsApp group settings', saved);
      sendData(res, waContract.groupSettings.response, saved);
    } catch (error) {
      log.error('Failed to save WhatsApp group settings', { error: (error as Error).message });
      ErrorResponses.internalError(res, 'Failed to save group settings', error as Error);
    }
  }
);

export default router;
