/**
 * WhatsApp Routes
 *
 * This module contains all WhatsApp-related API endpoints including:
 * - Message sending (single patient, batch by date)
 * - Media sending (images, X-rays, documents)
 * - QR code authentication
 * - Client status management
 * - Client lifecycle operations (restart, destroy, logout, initialize)
 *
 * All routes support real-time WebSocket updates for status changes.
 */

import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import qrcode from 'qrcode';
import path from 'path';

// Services
import whatsapp from '../../services/messaging/whatsapp.js';
import { sendImg_, sendXray_ } from '../../services/messaging/whatsapp-api.js';
import { getGroupSettings, saveGroupSettings } from '../../services/messaging/group-settings.js';
import { sendgramfile } from '../../services/messaging/telegram.js';
import messageState from '../../services/state/messageState.js';
import stateEvents from '../../services/state/stateEvents.js';
import { getReceiptData } from '../../services/templates/receipt-service.js';
import { getAppointmentForNotification } from '../../services/database/queries/appointment-queries.js';

// Utilities
import config from '../../config/config.js';
import PhoneFormatter from '../../utils/phoneFormatter.js';
import { sendData, sendError, ErrorResponses } from '../../utils/error-response.js';
import { log } from '../../utils/logger.js';
import { timeouts } from '../../middleware/timeout.js';
import { validate } from '../../middleware/validate.js';
import * as waContract from '../../shared/contracts/whatsapp.contract.js';

const router = Router();
const upload = multer();

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

type SendByDateQuery = waContract.SendByDateQuery;

// Request bodies are contracted (request-only) in shared/contracts/whatsapp.contract.ts
// (`waContract`) — the handlers type from its `z.infer` exports. Responses stay RAW
// (the client reads top-level fields via the raw apiClient — not the funnel).

interface SendMediaResult {
  result: string;
  sentMessages?: number;
}

// ============================================================================
// WHATSAPP MESSAGE SENDING ROUTES
// ============================================================================

/**
 * Send WhatsApp messages in batch for a specific date
 * GET /send (mounted at /api/wa)
 * Query params: date (YYYY-MM-DD format)
 * note: Uses extended timeout (5 minutes) due to batch processing
 */
router.get(
  '/send',
  timeouts.whatsappSend,
  async (
    req: Request<unknown, unknown, unknown, SendByDateQuery>,
    res: Response
  ): Promise<void> => {
    const dateparam = req.query.date;

    try {
      // Enhanced input validation
      if (!dateparam) {
        log.warn('WhatsApp batch send missing date parameter');
        ErrorResponses.badRequest(res, 'Missing required parameters', {
          required: ['date']
        });
        return;
      }

      // Validate date format (YYYY-MM-DD)
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(dateparam)) {
        log.warn('WhatsApp batch send invalid date format', { date: dateparam });
        ErrorResponses.badRequest(res, 'Invalid input', {
          details: 'Invalid date format. Expected YYYY-MM-DD'
        });
        return;
      }

      // Validate that it's a valid date
      const dateObj = new Date(dateparam);
      if (
        isNaN(dateObj.getTime()) ||
        dateObj.toISOString().slice(0, 10) !== dateparam
      ) {
        log.warn('WhatsApp batch send invalid date value', { date: dateparam });
        ErrorResponses.badRequest(res, 'Invalid input', {
          details: 'Invalid date value'
        });
        return;
      }

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
      ErrorResponses.internalError(res, 'Failed to start sending process', {
        error: (error as Error).message
      });
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
      if (isNaN(parseInt(String(workId)))) {
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
        receiptData = await getReceiptData(parseInt(String(workId)));
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

      if (isNaN(parseInt(String(appointmentId)))) {
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

      const appointment = await getAppointmentForNotification(parseInt(String(appointmentId)));
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

// ============================================================================
// APPOINTMENTS GROUP SETTINGS ROUTES
// ============================================================================

/**
 * Get the daily-appointments group settings (whether to post the PDF, and the
 * target group name). Defaults applied for unset options.
 * GET /group-settings (mounted at /api/wa)
 */
router.get('/group-settings', async (_req: Request, res: Response): Promise<void> => {
  try {
    const settings = await getGroupSettings();
    sendData(res, waContract.groupSettings.response, settings);
  } catch (error) {
    log.error('Failed to load WhatsApp group settings', { error: (error as Error).message });
    ErrorResponses.internalError(res, 'Failed to load group settings', {
      error: (error as Error).message
    });
  }
});

/**
 * Update the daily-appointments group settings.
 * PUT /group-settings (mounted at /api/wa)
 * Body: { enabled: boolean, groupName: string }
 */
router.put(
  '/group-settings',
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
      ErrorResponses.internalError(res, 'Failed to save group settings', {
        error: (error as Error).message
      });
    }
  }
);

// ============================================================================
// MEDIA SENDING ROUTES
// ============================================================================

/**
 * Send media (base64 encoded image) via WhatsApp
 * POST /sendmedia
 * Body: { file: base64Image, phone: phoneNumber }
 * note: Uses extended timeout (2 minutes) for file upload
 */
router.post(
  '/sendmedia',
  timeouts.long,
  validate({ body: waContract.sendMedia.body }),
  async (
    req: Request<unknown, unknown, waContract.SendMediaBody>,
    res: Response
  ): Promise<void> => {
    const { file: imgData, phone } = req.body;
    const base64Data = imgData.replace(/^data:image\/png;base64,/, '');
    const formattedPhone = PhoneFormatter.forWhatsApp(phone);
    try {
      await sendImg_(formattedPhone, base64Data);
      res.send('OK');
    } catch (error) {
      log.warn('WhatsApp send image failed', { phone, error: (error as Error).message });
      ErrorResponses.badRequest(res, 'operation failed', {
        operation: 'send image',
        details: (error as Error).message
      });
    }
  }
);

/**
 * Send multiple media files via WhatsApp or Telegram
 * POST /sendmedia2
 * Body: { file: comma-separated paths, phone: phoneNumber, prog: "WhatsApp"|"Telegram" }
 * note: Uses extended timeout (2 minutes) for multiple file uploads
 */
router.post(
  '/sendmedia2',
  timeouts.long,
  upload.none(),
  validate({ body: waContract.sendMedia2.body }),
  async (
    req: Request<unknown, unknown, waContract.SendMedia2Body>,
    res: Response
  ): Promise<void> => {
    try {
      const paths = req.body.file.split(',');
      let phone = req.body.phone;
      const prog = req.body.prog;

      log.info(
        `Sendmedia2 request - Program: ${prog}, phone: ${phone}, Files: ${paths.length}`
      );

      if (!phone || !prog || !paths.length) {
        log.warn('Send media2 missing parameters', { phone, prog, pathCount: paths.length });
        ErrorResponses.badRequest(res, 'Missing required parameters', {
          required: ['phone', 'prog', 'file']
        });
        return;
      }

      // Simple Windows path resolution
      function resolveWindowsPath(inputPath: string): string {
        const trimmedPath = inputPath.trim();

        // If it's already an absolute path, return as-is
        if (trimmedPath.startsWith('\\\\') || trimmedPath.match(/^[A-Za-z]:/)) {
          return trimmedPath;
        }

        // For relative paths, join with machine path
        const basePath = config.fileSystem.machinePath || '';
        return path.win32.join(basePath, trimmedPath);
      }

      let sentMessages = 0;
      let state: SendMediaResult = { result: '' };

      if (prog === 'WhatsApp') {
        phone = PhoneFormatter.forWhatsApp(phone);
        log.info(`WhatsApp - Formatted phone: ${phone}`);

        for (const filePath of paths) {
          // Resolve Windows path
          const resolvedPath = resolveWindowsPath(filePath);
          log.info(`Sending WhatsApp file: ${filePath} -> ${resolvedPath}`);
          state = await sendXray_(phone, resolvedPath);
          log.info(`WhatsApp result:`, state);
          if (state.result === 'OK') {
            sentMessages += 1;
          }
        }
      } else if (prog === 'Telegram') {
        const originalPhone = phone;
        phone = PhoneFormatter.forTelegram(phone);
        log.info(
          `Telegram - Original phone: ${originalPhone}, Formatted phone: ${phone}`
        );

        for (const filePath of paths) {
          // Resolve Windows path
          const resolvedPath = resolveWindowsPath(filePath);
          log.info(`Sending Telegram file: ${filePath} -> ${resolvedPath}`);
          state = await sendgramfile(phone, resolvedPath);
          log.info(`Telegram result:`, state);
          if (state.result === 'OK') {
            sentMessages += 1;
          }
        }
      } else {
        log.warn('Send media2 unsupported program', { prog, phone });
        ErrorResponses.badRequest(res, 'Invalid input', {
          details: `Unsupported program: ${prog}. Use 'WhatsApp' or 'Telegram'`
        });
        return;
      }

      state.sentMessages = sentMessages;
      log.info(
        `Final result - Sent: ${sentMessages}/${paths.length}, state:`,
        state
      );
      res.json(state);
    } catch (error) {
      log.error('Error in sendmedia2:', error);
      ErrorResponses.internalError(res, 'Error processing media files', {
        error: (error as Error).message
      });
    }
  }
);

// ============================================================================
// WHATSAPP AUTHENTICATION & STATUS ROUTES
// ============================================================================

/**
 * Get WhatsApp QR code for authentication
 * GET /qr (mounted at /api/wa)
 * Returns QR code as base64 data url or error if not available
 */
router.get('/qr', async (_req: Request, res: Response): Promise<void> => {
  try {
    // Just check if QR code is available
    if (!messageState || !messageState.qr) {
      log.warn('WhatsApp QR code not available');
      ErrorResponses.notFound(res, 'QR code', {
        details: 'QR code not available yet',
        status: 'waiting',
        timestamp: Date.now()
      });
      return;
    }

    // Convert the QR code string to a data url
    const qrImageUrl = await qrcode.toDataURL(messageState.qr, {
      margin: 4,
      scale: 6,
      errorCorrectionLevel: 'M'
    });

    // Send back as JSON with metadata
    res.json({
      qr: qrImageUrl,
      status: 'available',
      timestamp: Date.now(),
      expiryTime: Date.now() + 60000 // QR codes typically expire after 1 minute
    });
  } catch (error) {
    log.error('Error generating WhatsApp QR code image:', error);
    ErrorResponses.internalError(res, 'Error generating QR code', {
      error: (error as Error).message
    });
  }
});

/**
 * Get initial WhatsApp state (replaces the WS REQUEST_WHATSAPP_INITIAL_STATE RPC).
 * GET /initial-state (mounted at /api/wa)
 * Returns the same payload shape the WS handler used to push, so hooks can
 * prime themselves on mount / date-change / visibility / 30s QR-refresh.
 * Triggers on-demand init when QR viewers are connected.
 */
router.get('/initial-state', async (_req: Request, res: Response): Promise<void> => {
  try {
    const stateDump = messageState.dump();
    const clientStatus = whatsapp.getStatus() as {
      state?: string;
      active?: boolean;
      initializing?: boolean;
      hasClient?: boolean;
    };

    if (messageState.activeQRViewers > 0) {
      stateEvents.emit('whatsapp_initialization_requested');
    }

    const isClientReady = stateDump.clientReady || clientStatus.active;
    const finished = stateDump.finishedSending;

    let html: string;
    if (isClientReady) {
      html = finished
        ? `<p>${stateDump.sentMessages} Messages Sent!</p><p>${stateDump.failedMessages} Messages Failed!</p><p>Finished</p>`
        : `<p>${stateDump.sentMessages} Messages Sent!</p><p>${stateDump.failedMessages} Messages Failed!</p><p>Sending...</p>`;
    } else if (messageState.qr && messageState.activeQRViewers > 0) {
      html = '<p>QR code ready - Please scan with WhatsApp</p>';
    } else {
      html = '<p>Initializing the client...</p>';
    }

    let qrDataUrl: string | null = null;
    if (!isClientReady && messageState.qr) {
      try {
        qrDataUrl = await qrcode.toDataURL(messageState.qr, {
          margin: 4,
          scale: 6,
          errorCorrectionLevel: 'M'
        });
      } catch (error) {
        log.error('Failed to convert QR code to data url', { error: (error as Error).message });
        qrDataUrl = messageState.qr;
      }
    }

    res.json({
      success: true,
      htmltext: html,
      finished,
      clientReady: isClientReady,
      initializing: clientStatus.initializing || false,
      clientStatus,
      persons: messageState.persons || [],
      qr: qrDataUrl,
      stats: stateDump,
      sentMessages: stateDump.sentMessages || 0,
      failedMessages: stateDump.failedMessages || 0,
      timestamp: Date.now()
    });
  } catch (error) {
    log.error('Error building WhatsApp initial state', { error: (error as Error).message });
    ErrorResponses.internalError(res, 'Failed to fetch initial state', {
      error: (error as Error).message
    });
  }
});

// ============================================================================
// WHATSAPP CLIENT LIFECYCLE ROUTES
// ============================================================================

/**
 * Restart WhatsApp client
 * POST /restart (mounted at /api/wa)
 * Safely closes the existing client and creates a new one
 */
router.post(
  '/restart',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      log.info('Restarting WhatsApp client');

      const success = await whatsapp.restart();

      res.json({
        success: true,
        message: 'WhatsApp client restart initiated',
        result: success ? 'restart_initiated' : 'restart_failed'
      });
    } catch (error) {
      log.error('Error restarting WhatsApp client:', error);
      ErrorResponses.internalError(res, 'Failed to restart WhatsApp client', {
        error: (error as Error).message
      });
    }
  }
);

/**
 * Destroy WhatsApp client - close browser but preserve authentication
 * POST /destroy (mounted at /api/wa)
 * This closes the browser/puppeteer but keeps authentication for reconnection
 */
router.post(
  '/destroy',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      log.info('Destroying WhatsApp client - preserving authentication');

      const result = await whatsapp.simpleDestroy();

      if (result.success) {
        res.json({
          success: true,
          message: result.message,
          action: 'destroy',
          authPreserved: true
        });
      } else {
        log.warn('WhatsApp destroy failed', { error: result.error });
        ErrorResponses.badRequest(res, 'operation failed', {
          operation: 'destroy WhatsApp client',
          details: result.error || 'Destroy failed'
        });
      }
    } catch (error) {
      log.error('Error destroying WhatsApp client:', error);
      ErrorResponses.internalError(res, 'Failed to destroy WhatsApp client', {
        error: (error as Error).message
      });
    }
  }
);

/**
 * Logout WhatsApp client - completely clear authentication
 * POST /logout (mounted at /api/wa)
 * This logs out from WhatsApp and removes all authentication data
 */
router.post('/logout', async (_req: Request, res: Response): Promise<void> => {
  try {
    log.info('Logging out WhatsApp client - clearing authentication');

    const result = await whatsapp.completeLogout();

    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        action: 'logout',
        authCleared: true
      });
    } else {
      log.warn('WhatsApp logout failed', { error: result.error });
      ErrorResponses.badRequest(res, 'operation failed', {
        operation: 'logout WhatsApp client',
        details: result.error || 'Logout failed'
      });
    }
  } catch (error) {
    log.error('Error logging out WhatsApp client:', error);
    ErrorResponses.internalError(res, 'Failed to logout WhatsApp client', {
      error: (error as Error).message
    });
  }
});

/**
 * Initialize WhatsApp client asynchronously
 * GET /initialize (mounted at /api/wa)
 * Returns 200 OK immediately and starts initialization in background
 * Suitable for external applications that need to trigger initialization
 */
router.get('/initialize', (_req: Request, res: Response): void => {
  try {
    log.info('WhatsApp initialization request received');

    // Immediately respond with 200 OK
    res.json({
      success: true,
      message: 'WhatsApp initialization started',
      timestamp: Date.now(),
      action: 'initialize_requested'
    });

    // Start initialization in background (non-blocking)
    setImmediate(async () => {
      try {
        log.info('Starting WhatsApp client initialization in background');
        await whatsapp.initialize();
        log.info('Background WhatsApp initialization completed successfully');
      } catch (error) {
        log.error(
          'Background WhatsApp initialization failed:',
          (error as Error).message
        );
      }
    });
  } catch (error) {
    log.error('Error handling WhatsApp initialization request:', error);
    ErrorResponses.internalError(res, 'Failed to process initialization request', {
      error: (error as Error).message
    });
  }
});

export default router;
