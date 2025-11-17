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

import express from 'express';
import multer from 'multer';
import qrcode from 'qrcode';
import path from 'path';

// Services
import * as database from '../../services/database/index.js';
import whatsapp from '../../services/messaging/whatsapp.js';
import { sendImg_, sendXray_ } from '../../services/messaging/whatsapp-api.js';
import { sendgramfile } from '../../services/messaging/telegram.js';
import messageState from '../../services/state/messageState.js';
import { WebSocketEvents, createStandardMessage } from '../../services/messaging/websocket-events.js';
import { getReceiptData } from '../../services/templates/receipt-service.js';

// Utilities
import config from '../../config/config.js';
import PhoneFormatter from '../../utils/phoneFormatter.js';
import { sendError, ErrorResponses } from '../../utils/error-response.js';
import { log } from '../../utils/logger.js';
import { timeouts } from '../../middleware/timeout.js';

const router = express.Router();
const upload = multer();

// WebSocket emitter will be injected to avoid circular imports
let wsEmitter = null;

/**
 * Set the WebSocket emitter reference
 * @param {EventEmitter} emitter - WebSocket event emitter
 */
export function setWebSocketEmitter(emitter) {
    wsEmitter = emitter;
}

// ============================================================================
// WHATSAPP MESSAGE SENDING ROUTES
// ============================================================================

/**
 * Send WhatsApp message to a specific patient for an appointment
 * GET /send-to-patient (mounted at /api/wa)
 * Query params: personId, appointmentId
 */
router.get('/send-to-patient', async (req, res) => {
    try {
        const { personId, appointmentId } = req.query;

        // Validate required parameters
        if (!personId || !appointmentId) {
            return sendError(res, ErrorResponses.MISSING_PARAMETERS, {
                required: ['personId', 'appointmentId']
            });
        }

        // Validate parameters are numeric
        if (isNaN(parseInt(personId)) || isNaN(parseInt(appointmentId))) {
            return sendError(res, ErrorResponses.INVALID_INPUT, {
                details: 'personId and appointmentId must be valid numbers'
            });
        }

        log.info(`WhatsApp send to patient request - PersonID: ${personId}, AppointmentID: ${appointmentId}`);

        // Check if WhatsApp client is ready
        if (!whatsapp.isReady()) {
            const status = whatsapp.getStatus();
            return sendError(res, ErrorResponses.SERVICE_UNAVAILABLE, {
                service: 'WhatsApp',
                details: 'WhatsApp client is not ready. Please wait for initialization to complete.',
                clientStatus: status,
                requiresRestart: status.circuitBreakerOpen
            });
        }

        // Get message data from stored procedure
        const messageData = await database.executeStoredProcedure(
            'GetNewAppointmentMessage',
            [
                ['PersonID', database.TYPES.Int, parseInt(personId)],
                ['AppointmentID', database.TYPES.Int, parseInt(appointmentId)]
            ],
            null,
            (columns) => {
                return {
                    result: columns[0].value,
                    phone: columns[1] ? columns[1].value : null,
                    message: columns[2] ? columns[2].value : null
                };
            },
            (result) => result && result.length > 0 ? result[0] : null
        );

        if (!messageData) {
            return sendError(res, ErrorResponses.NOT_FOUND, {
                resource: 'message data',
                details: 'No data returned from stored procedure'
            });
        }

        // Check stored procedure result
        if (messageData.result !== 0) {
            let errorMessage = "Unknown error";
            if (messageData.result === -1) {
                errorMessage = "Patient or appointment not found";
            } else if (messageData.result === -2) {
                errorMessage = "Invalid phone number";
            }

            return sendError(res, ErrorResponses.INVALID_INPUT, {
                details: errorMessage,
                result: messageData.result
            });
        }

        // Format phone number for WhatsApp (needs international format with + prefix)
        const countryCode = messageData.countryCode || '964'; // Default to Iraq
        const phoneNumber = PhoneFormatter.forWhatsApp(messageData.phone, countryCode);

        log.info(`Sending WhatsApp message to ${phoneNumber}: ${messageData.message.substring(0, 50)}...`);

        // Send single message using WhatsApp service
        const result = await whatsapp.sendSingleMessage(
            phoneNumber,
            messageData.message,
            `Patient ${personId}`,
            parseInt(appointmentId)
        );

        if (result.success) {
            res.json({
                success: true,
                message: "WhatsApp message sent successfully",
                data: {
                    personId: parseInt(personId),
                    appointmentId: parseInt(appointmentId),
                    phone: phoneNumber,
                    messageId: result.messageId,
                    messagePreview: messageData.message.substring(0, 100) + (messageData.message.length > 100 ? '...' : '')
                }
            });
        } else {
            return sendError(res, ErrorResponses.OPERATION_FAILED, {
                operation: 'send WhatsApp message',
                details: result.error
            });
        }

    } catch (error) {
        log.error(`Error sending WhatsApp message to patient: ${error.message}`);
        return sendError(res, ErrorResponses.INTERNAL_ERROR, {
            details: 'Internal server error while sending message',
            error: error.message
        });
    }
});

/**
 * Send WhatsApp messages in batch for a specific date
 * GET /send (mounted at /api/wa)
 * Query params: date (YYYY-MM-DD format)
 * Note: Uses extended timeout (5 minutes) due to batch processing
 */
router.get('/send', timeouts.whatsappSend, async (req, res) => {
    const dateparam = req.query.date;

    try {
        // Enhanced input validation
        if (!dateparam) {
            return sendError(res, ErrorResponses.MISSING_PARAMETERS, {
                required: ['date']
            });
        }

        // Validate date format (YYYY-MM-DD)
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(dateparam)) {
            return sendError(res, ErrorResponses.INVALID_INPUT, {
                details: 'Invalid date format. Expected YYYY-MM-DD'
            });
        }

        // Validate that it's a valid date
        const dateObj = new Date(dateparam);
        if (isNaN(dateObj.getTime()) || dateObj.toISOString().slice(0, 10) !== dateparam) {
            return sendError(res, ErrorResponses.INVALID_INPUT, {
                details: 'Invalid date value'
            });
        }

        log.info(`WhatsApp send request for validated date: ${dateparam}`);

        // Check if client is ready
        if (!whatsapp.isReady()) {
            const status = whatsapp.getStatus();
            return sendError(res, ErrorResponses.SERVICE_UNAVAILABLE, {
                service: 'WhatsApp',
                details: 'WhatsApp client is not ready. Please wait for initialization to complete.',
                clientStatus: status,
                requiresRestart: status.circuitBreakerOpen
            });
        }

        // Start sending process (non-blocking)
        whatsapp.send(dateparam).catch(error => {
            log.error(`Error in WhatsApp send process: ${error.message}`);

            // Broadcast error to clients
            if (wsEmitter) {
                const message = createStandardMessage(
                    WebSocketEvents.SYSTEM_ERROR,
                    {
                        error: `Send process failed: ${error.message}`,
                        date: dateparam
                    }
                );
                wsEmitter.emit(WebSocketEvents.BROADCAST_MESSAGE, message);
            }
        });

        // Respond immediately
        res.json({
            success: true,
            message: "WhatsApp sending process started",
            htmltext: 'Starting to send messages...',
            date: dateparam
        });

    } catch (error) {
        log.error(`Error starting WhatsApp send: ${error.message}`);
        return sendError(res, ErrorResponses.INTERNAL_ERROR, {
            details: 'Failed to start sending process',
            error: error.message
        });
    }
});

/**
 * Send receipt via WhatsApp to patient
 * POST /send-receipt (mounted at /api/wa)
 * Body: { workId: number }
 * Sends receipt details including amount paid, balance, and next appointment
 */
router.post('/send-receipt', async (req, res) => {
    try {
        const { workId } = req.body;

        // Validate required parameter
        if (!workId) {
            return sendError(res, ErrorResponses.MISSING_PARAMETERS, {
                required: ['workId']
            });
        }

        // Validate workId is numeric
        if (isNaN(parseInt(workId))) {
            return sendError(res, ErrorResponses.INVALID_INPUT, {
                details: 'workId must be a valid number'
            });
        }

        log.info(`WhatsApp receipt send request - WorkID: ${workId}`);

        // Check if WhatsApp client is ready
        if (!whatsapp.isReady()) {
            const status = whatsapp.getStatus();
            return res.json({
                success: false,
                message: 'WhatsApp not connected'
            });
        }

        // Get receipt data (includes patient phone, amounts, appointment)
        let receiptData;
        try {
            receiptData = await getReceiptData(parseInt(workId));
        } catch (error) {
            log.error(`Failed to get receipt data for work ${workId}:`, error);
            return res.json({
                success: false,
                message: 'Work not found'
            });
        }

        // Extract patient phone
        const patientPhone = receiptData.patient.Phone;
        if (!patientPhone || patientPhone.trim() === '') {
            log.warn(`No phone number for patient ${receiptData.patient.PersonID}`);
            return res.json({
                success: false,
                message: 'No phone number for patient'
            });
        }

        // Format phone number for WhatsApp
        const phoneNumber = PhoneFormatter.forWhatsApp(patientPhone, '964');

        // Validate phone format
        if (!PhoneFormatter.isValid(phoneNumber, '964')) {
            log.warn(`Invalid phone format: ${patientPhone}`);
            return res.json({
                success: false,
                message: 'Invalid phone number'
            });
        }

        // Format date for appointment
        const appointmentText = receiptData.patient.AppDate
            ? new Date(receiptData.patient.AppDate).toLocaleDateString('en-GB', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            })
            : 'Not scheduled';

        // Compose WhatsApp message
        const message = `Receipt - Shwan Orthodontics
━━━━━━━━━━━━━━━━━━━━━

Patient: ${receiptData.patient.PatientName}
Date: ${new Date().toLocaleDateString('en-GB')}

Amount Paid: ${Math.round(receiptData.payment.AmountPaidToday).toLocaleString('en-US')} ${receiptData.payment.Currency}
Remaining Balance: ${Math.round(receiptData.payment.RemainingBalance).toLocaleString('en-US')} ${receiptData.payment.Currency}

Appointment: ${appointmentText}

Thank you for your payment!`;

        log.info(`Sending receipt to ${phoneNumber} for patient ${receiptData.patient.PatientName}`);

        // Send message via WhatsApp
        const result = await whatsapp.sendSingleMessage(
            phoneNumber,
            message,
            receiptData.patient.PatientName,
            null, // appointmentId (not applicable for receipts)
            null, // appointmentDate
            null  // session
        );

        if (result.success) {
            log.info(`Receipt sent successfully to ${phoneNumber} - MessageID: ${result.messageId}`);
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
        log.error(`Error sending receipt via WhatsApp: ${error.message}`);
        return res.json({
            success: false,
            message: 'Internal error'
        });
    }
});

// ============================================================================
// MEDIA SENDING ROUTES
// ============================================================================

/**
 * Send media (base64 encoded image) via WhatsApp
 * POST /sendmedia
 * Body: { file: base64Image, phone: phoneNumber }
 * Note: Uses extended timeout (2 minutes) for file upload
 */
router.post('/sendmedia', timeouts.long, async (req, res) => {
    const { file: imgData, phone } = req.body;
    const base64Data = imgData.replace(/^data:image\/png;base64,/, '');
    try {
        await sendImg_(phone, base64Data);
        res.send('OK');
    } catch (error) {
        return sendError(res, ErrorResponses.OPERATION_FAILED, {
            operation: 'send image',
            details: error.message
        });
    }
});

/**
 * Send X-ray file via WhatsApp
 * GET /sendxrayfile
 * Query params: phone, file (file path)
 */
router.get('/sendxrayfile', async (req, res) => {
    const { phone, file } = req.query;
    try {
        const state = await sendXray_(phone, file);
        res.json(state);
    } catch (error) {
        return sendError(res, ErrorResponses.OPERATION_FAILED, {
            operation: 'send X-ray file',
            details: error.message
        });
    }
});

/**
 * Send multiple media files via WhatsApp or Telegram
 * POST /sendmedia2
 * Body: { file: comma-separated paths, phone: phoneNumber, prog: "WhatsApp"|"Telegram" }
 * Note: Uses extended timeout (2 minutes) for multiple file uploads
 */
router.post('/sendmedia2', timeouts.long, upload.none(), async (req, res) => {
    try {
        const paths = req.body.file.split(',');
        let phone = req.body.phone;
        const prog = req.body.prog;

        log.info(`Sendmedia2 request - Program: ${prog}, Phone: ${phone}, Files: ${paths.length}`);

        if (!phone || !prog || !paths.length) {
            return sendError(res, ErrorResponses.MISSING_PARAMETERS, {
                required: ['phone', 'prog', 'file']
            });
        }

        // Simple Windows path resolution
        function resolveWindowsPath(inputPath) {
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
        let state = {};

        if (prog === "WhatsApp") {
            phone = PhoneFormatter.forWhatsApp(phone);
            log.info(`WhatsApp - Formatted phone: ${phone}`);

            for (const filePath of paths) {
                // Resolve Windows path
                const resolvedPath = resolveWindowsPath(filePath);
                log.info(`Sending WhatsApp file: ${filePath} -> ${resolvedPath}`);
                state = await sendXray_(phone, resolvedPath);
                log.info(`WhatsApp result:`, state);
                if (state.result === "OK") {
                    sentMessages += 1;
                }
            }
        } else if (prog === "Telegram") {
            const originalPhone = phone;
            phone = PhoneFormatter.forTelegram(phone);
            log.info(`Telegram - Original phone: ${originalPhone}, Formatted phone: ${phone}`);

            for (const filePath of paths) {
                // Resolve Windows path
                const resolvedPath = resolveWindowsPath(filePath);
                log.info(`Sending Telegram file: ${filePath} -> ${resolvedPath}`);
                state = await sendgramfile(phone, resolvedPath);
                log.info(`Telegram result:`, state);
                if (state.result === "OK") {
                    sentMessages += 1;
                }
            }
        } else {
            return sendError(res, ErrorResponses.INVALID_INPUT, {
                details: `Unsupported program: ${prog}. Use 'WhatsApp' or 'Telegram'`
            });
        }

        state.sentMessages = sentMessages;
        log.info(`Final result - Sent: ${sentMessages}/${paths.length}, State:`, state);
        res.json(state);
    } catch (error) {
        log.error('Error in sendmedia2:', error);
        return sendError(res, ErrorResponses.INTERNAL_ERROR, {
            details: 'Error processing media files',
            error: error.message
        });
    }
});

// ============================================================================
// WHATSAPP AUTHENTICATION & STATUS ROUTES
// ============================================================================

/**
 * Get WhatsApp QR code for authentication
 * GET /qr (mounted at /api/wa)
 * Returns QR code as base64 data URL or error if not available
 */
router.get('/qr', async (req, res) => {
    try {
      // Do NOT register as QR viewer here - we only register via WebSockets
      // REMOVE: messageState.registerQRViewer();

      // Just check if QR code is available
      if (!messageState || !messageState.qr) {
        return sendError(res, ErrorResponses.NOT_FOUND, {
          resource: 'QR code',
          details: 'QR code not available yet',
          status: 'waiting',
          timestamp: Date.now()
        });
      }

      // Convert the QR code string to a data URL
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
      return sendError(res, ErrorResponses.INTERNAL_ERROR, {
        details: 'Error generating QR code',
        error: error.message
      });
    }
});

/**
 * Get WhatsApp client status
 * GET /status (mounted at /api/wa)
 * Returns current client status including readiness and activity
 */
router.get('/status', (req, res) => {
    try {
      const status = whatsapp.getStatus();

      res.json({
        success: true,
        clientReady: status.active,
        initializing: status.initializing,
        lastActivity: status.lastActivity,
        reconnectAttempts: status.reconnectAttempts,
        qr: messageState.qr
      });
    } catch (error) {
      log.error("Error getting WhatsApp client status:", error);
      return sendError(res, ErrorResponses.INTERNAL_ERROR, {
        details: 'Failed to get WhatsApp client status',
        error: error.message
      });
    }
});

/**
 * Get detailed WhatsApp status including message state dump
 * GET /detailed-status (mounted at /api/wa)
 * Returns comprehensive status information for debugging
 */
router.get('/detailed-status', async (req, res) => {
    try {
        const stateDump = messageState.dump(true); // Get detailed dump
        const clientStatus = whatsapp.getStatus();

        res.json({
            success: true,
            messageState: stateDump,
            clientStatus: clientStatus,
            timestamp: Date.now()
        });
    } catch (error) {
        log.error("Error getting detailed status:", error);
        return sendError(res, ErrorResponses.INTERNAL_ERROR, {
            details: 'Failed to get detailed status',
            error: error.message
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
router.post('/restart', async (req, res) => {
    try {
      log.info("Restarting WhatsApp client");

      const success = await whatsapp.restart();

      res.json({
        success: true,
        message: "WhatsApp client restart initiated",
        result: success ? "restart_initiated" : "restart_failed"
      });
    } catch (error) {
      log.error("Error restarting WhatsApp client:", error);
      return sendError(res, ErrorResponses.INTERNAL_ERROR, {
        details: 'Failed to restart WhatsApp client',
        error: error.message
      });
    }
});

/**
 * Destroy WhatsApp client - close browser but preserve authentication
 * POST /destroy (mounted at /api/wa)
 * This closes the browser/puppeteer but keeps authentication for reconnection
 */
router.post('/destroy', async (req, res) => {
  try {
    log.info("Destroying WhatsApp client - preserving authentication");

    const result = await whatsapp.simpleDestroy();

    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        action: "destroy",
        authPreserved: true
      });
    } else {
      return sendError(res, ErrorResponses.OPERATION_FAILED, {
        operation: 'destroy WhatsApp client',
        details: result.error || 'Destroy failed'
      });
    }
  } catch (error) {
    log.error("Error destroying WhatsApp client:", error);
    return sendError(res, ErrorResponses.INTERNAL_ERROR, {
      details: 'Failed to destroy WhatsApp client',
      error: error.message
    });
  }
});

/**
 * Logout WhatsApp client - completely clear authentication
 * POST /logout (mounted at /api/wa)
 * This logs out from WhatsApp and removes all authentication data
 */
router.post('/logout', async (req, res) => {
  try {
    log.info("Logging out WhatsApp client - clearing authentication");

    const result = await whatsapp.completeLogout();

    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        action: "logout",
        authCleared: true
      });
    } else {
      return sendError(res, ErrorResponses.OPERATION_FAILED, {
        operation: 'logout WhatsApp client',
        details: result.error || 'Logout failed'
      });
    }
  } catch (error) {
    log.error("Error logging out WhatsApp client:", error);
    return sendError(res, ErrorResponses.INTERNAL_ERROR, {
      details: 'Failed to logout WhatsApp client',
      error: error.message
    });
  }
});

/**
 * Initialize WhatsApp client asynchronously
 * GET /initialize (mounted at /api/wa)
 * Returns 200 OK immediately and starts initialization in background
 * Suitable for external applications that need to trigger initialization
 */
router.get('/initialize', (_req, res) => {
  try {
    log.info("WhatsApp initialization request received");

    // Immediately respond with 200 OK
    res.json({
      success: true,
      message: "WhatsApp initialization started",
      timestamp: Date.now(),
      action: "initialize_requested"
    });

    // Start initialization in background (non-blocking)
    setImmediate(async () => {
      try {
        log.info("Starting WhatsApp client initialization in background");
        await whatsapp.initialize();
        log.info("Background WhatsApp initialization completed successfully");
      } catch (error) {
        log.error("Background WhatsApp initialization failed:", error.message);

        // Broadcast error to WebSocket clients if available
        if (wsEmitter) {
          const errorMessage = createStandardMessage(
            WebSocketEvents.SYSTEM_ERROR,
            {
              error: `WhatsApp initialization failed: ${error.message}`,
              source: 'background_initialization'
            }
          );
          wsEmitter.emit(WebSocketEvents.BROADCAST_MESSAGE, errorMessage);
        }
      }
    });

  } catch (error) {
    log.error("Error handling WhatsApp initialization request:", error);
    return sendError(res, ErrorResponses.INTERNAL_ERROR, {
      details: 'Failed to process initialization request',
      error: error.message
    });
  }
});

export default router;
