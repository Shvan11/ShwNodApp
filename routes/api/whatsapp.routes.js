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

// Utilities
import config from '../../config/config.js';
import PhoneFormatter from '../../utils/phoneFormatter.js';

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
 * GET /wa/send-to-patient
 * Query params: personId, appointmentId
 */
router.get('/wa/send-to-patient', async (req, res) => {
    try {
        const { personId, appointmentId } = req.query;

        // Validate required parameters
        if (!personId || !appointmentId) {
            return res.status(400).json({
                success: false,
                message: "Both personId and appointmentId parameters are required"
            });
        }

        // Validate parameters are numeric
        if (isNaN(parseInt(personId)) || isNaN(parseInt(appointmentId))) {
            return res.status(400).json({
                success: false,
                message: "personId and appointmentId must be valid numbers"
            });
        }

        console.log(`WhatsApp send to patient request - PersonID: ${personId}, AppointmentID: ${appointmentId}`);

        // Check if WhatsApp client is ready
        if (!whatsapp.isReady()) {
            const status = whatsapp.getStatus();
            return res.status(400).json({
                success: false,
                message: "WhatsApp client is not ready. Please wait for initialization to complete.",
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
            return res.status(404).json({
                success: false,
                message: "No data returned from stored procedure"
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

            return res.status(400).json({
                success: false,
                message: errorMessage,
                result: messageData.result
            });
        }

        // Format phone number for WhatsApp (needs international format with + prefix)
        const countryCode = messageData.countryCode || '964'; // Default to Iraq
        const phoneNumber = PhoneFormatter.forWhatsApp(messageData.phone, countryCode);

        console.log(`Sending WhatsApp message to ${phoneNumber}: ${messageData.message.substring(0, 50)}...`);

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
            res.status(500).json({
                success: false,
                message: "Failed to send WhatsApp message",
                error: result.error
            });
        }

    } catch (error) {
        console.error(`Error sending WhatsApp message to patient: ${error.message}`);
        res.status(500).json({
            success: false,
            message: "Internal server error while sending message",
            error: error.message
        });
    }
});

/**
 * Send WhatsApp messages in batch for a specific date
 * GET /wa/send
 * Query params: date (YYYY-MM-DD format)
 */
router.get('/wa/send', async (req, res) => {
    const dateparam = req.query.date;

    try {
        // Enhanced input validation
        if (!dateparam) {
            return res.status(400).json({
                success: false,
                message: "Date parameter is required"
            });
        }

        // Validate date format (YYYY-MM-DD)
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(dateparam)) {
            return res.status(400).json({
                success: false,
                message: "Invalid date format. Expected YYYY-MM-DD"
            });
        }

        // Validate that it's a valid date
        const dateObj = new Date(dateparam);
        if (isNaN(dateObj.getTime()) || dateObj.toISOString().slice(0, 10) !== dateparam) {
            return res.status(400).json({
                success: false,
                message: "Invalid date value"
            });
        }

        console.log(`WhatsApp send request for validated date: ${dateparam}`);

        // Check if client is ready
        if (!whatsapp.isReady()) {
            const status = whatsapp.getStatus();
            return res.status(400).json({
                success: false,
                message: "WhatsApp client is not ready. Please wait for initialization to complete.",
                clientStatus: status,
                requiresRestart: status.circuitBreakerOpen
            });
        }

        // Start sending process (non-blocking)
        whatsapp.send(dateparam).catch(error => {
            console.error(`Error in WhatsApp send process: ${error.message}`);

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
        console.error(`Error starting WhatsApp send: ${error.message}`);
        res.status(500).json({
            success: false,
            message: `Failed to start sending process: ${error.message}`,
            error: error.message
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
 */
router.post('/sendmedia', async (req, res) => {
    const { file: imgData, phone } = req.body;
    const base64Data = imgData.replace(/^data:image\/png;base64,/, '');
    try {
        await sendImg_(phone, base64Data);
        res.send('OK');
    } catch (error) {
        res.status(500).send('Failed to send image');
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
        res.status(500).json({ error: 'Failed to send X-ray file' });
    }
});

/**
 * Send multiple media files via WhatsApp or Telegram
 * POST /sendmedia2
 * Body: { file: comma-separated paths, phone: phoneNumber, prog: "WhatsApp"|"Telegram" }
 */
router.post('/sendmedia2', upload.none(), async (req, res) => {
    try {
        const paths = req.body.file.split(',');
        let phone = req.body.phone;
        const prog = req.body.prog;

        console.log(`Sendmedia2 request - Program: ${prog}, Phone: ${phone}, Files: ${paths.length}`);

        if (!phone || !prog || !paths.length) {
            return res.status(400).json({
                result: "ERROR",
                error: "Missing required parameters (phone, prog, or file)"
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
            console.log(`WhatsApp - Formatted phone: ${phone}`);

            for (const filePath of paths) {
                // Resolve Windows path
                const resolvedPath = resolveWindowsPath(filePath);
                console.log(`Sending WhatsApp file: ${filePath} -> ${resolvedPath}`);
                state = await sendXray_(phone, resolvedPath);
                console.log(`WhatsApp result:`, state);
                if (state.result === "OK") {
                    sentMessages += 1;
                }
            }
        } else if (prog === "Telegram") {
            const originalPhone = phone;
            phone = PhoneFormatter.forTelegram(phone);
            console.log(`Telegram - Original phone: ${originalPhone}, Formatted phone: ${phone}`);

            for (const filePath of paths) {
                // Resolve Windows path
                const resolvedPath = resolveWindowsPath(filePath);
                console.log(`Sending Telegram file: ${filePath} -> ${resolvedPath}`);
                state = await sendgramfile(phone, resolvedPath);
                console.log(`Telegram result:`, state);
                if (state.result === "OK") {
                    sentMessages += 1;
                }
            }
        } else {
            return res.status(400).json({
                result: "ERROR",
                error: `Unsupported program: ${prog}. Use 'WhatsApp' or 'Telegram'`
            });
        }

        state.sentMessages = sentMessages;
        console.log(`Final result - Sent: ${sentMessages}/${paths.length}, State:`, state);
        res.json(state);
    } catch (error) {
        console.error('Error in sendmedia2:', error);
        res.status(500).json({
            result: "ERROR",
            error: error.message || "Internal server error"
        });
    }
});

// ============================================================================
// WHATSAPP AUTHENTICATION & STATUS ROUTES
// ============================================================================

/**
 * Get WhatsApp QR code for authentication
 * GET /wa/qr
 * Returns QR code as base64 data URL or error if not available
 */
router.get('/wa/qr', async (req, res) => {
    try {
      // Do NOT register as QR viewer here - we only register via WebSockets
      // REMOVE: messageState.registerQRViewer();

      // Just check if QR code is available
      if (!messageState || !messageState.qr) {
        return res.status(404).json({
          error: 'QR code not available yet',
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
      console.error('Error generating WhatsApp QR code image:', error);
      res.status(500).json({ error: 'Error generating QR code' });
    }
});

/**
 * Get WhatsApp client status
 * GET /wa/status
 * Returns current client status including readiness and activity
 */
router.get('/wa/status', (req, res) => {
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
      console.error("Error getting WhatsApp client status:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get WhatsApp client status",
        error: error.message
      });
    }
});

/**
 * Get detailed WhatsApp status including message state dump
 * GET /wa/detailed-status
 * Returns comprehensive status information for debugging
 */
router.get('/wa/detailed-status', async (req, res) => {
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
        console.error("Error getting detailed status:", error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// WHATSAPP CLIENT LIFECYCLE ROUTES
// ============================================================================

/**
 * Restart WhatsApp client
 * POST /wa/restart
 * Safely closes the existing client and creates a new one
 */
router.post('/wa/restart', async (req, res) => {
    try {
      console.log("Restarting WhatsApp client");

      const success = await whatsapp.restart();

      res.json({
        success: true,
        message: "WhatsApp client restart initiated",
        result: success ? "restart_initiated" : "restart_failed"
      });
    } catch (error) {
      console.error("Error restarting WhatsApp client:", error);
      res.status(500).json({
        success: false,
        message: "Failed to restart WhatsApp client",
        error: error.message
      });
    }
});

/**
 * Destroy WhatsApp client - close browser but preserve authentication
 * POST /wa/destroy
 * This closes the browser/puppeteer but keeps authentication for reconnection
 */
router.post('/wa/destroy', async (req, res) => {
  try {
    console.log("Destroying WhatsApp client - preserving authentication");

    const result = await whatsapp.simpleDestroy();

    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        action: "destroy",
        authPreserved: true
      });
    } else {
      res.status(500).json({
        success: false,
        message: result.error || "Destroy failed",
        error: result.error
      });
    }
  } catch (error) {
    console.error("Error destroying WhatsApp client:", error);
    res.status(500).json({
      success: false,
      message: "Failed to destroy WhatsApp client",
      error: error.message
    });
  }
});

/**
 * Logout WhatsApp client - completely clear authentication
 * POST /wa/logout
 * This logs out from WhatsApp and removes all authentication data
 */
router.post('/wa/logout', async (req, res) => {
  try {
    console.log("Logging out WhatsApp client - clearing authentication");

    const result = await whatsapp.completeLogout();

    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        action: "logout",
        authCleared: true
      });
    } else {
      res.status(500).json({
        success: false,
        message: result.error || "Logout failed",
        error: result.error
      });
    }
  } catch (error) {
    console.error("Error logging out WhatsApp client:", error);
    res.status(500).json({
      success: false,
      message: "Failed to logout WhatsApp client",
      error: error.message
    });
  }
});

/**
 * Initialize WhatsApp client asynchronously
 * GET /wa/initialize
 * Returns 200 OK immediately and starts initialization in background
 * Suitable for external applications that need to trigger initialization
 */
router.get('/wa/initialize', (req, res) => {
  try {
    console.log("WhatsApp initialization request received");

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
        console.log("Starting WhatsApp client initialization in background");
        await whatsapp.initialize();
        console.log("Background WhatsApp initialization completed successfully");
      } catch (error) {
        console.error("Background WhatsApp initialization failed:", error.message);

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
    console.error("Error handling WhatsApp initialization request:", error);
    res.status(500).json({
      success: false,
      message: "Failed to process initialization request",
      error: error.message
    });
  }
});

export default router;
