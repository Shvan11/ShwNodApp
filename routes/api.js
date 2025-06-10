/**
 * API routes
 */
import express from 'express';

import * as database from '../services/database/index.js';
import { getPresentAps } from '../services/database/queries/appointment-queries.js';
import {getTimePoints, getTimePointImgs } from '../services/database/queries/timepoint-queries.js';
import { getWhatsAppMessages } from '../services/database/queries/messaging-queries.js';
import { getPatientsPhones, getInfos } from '../services/database/queries/patient-queries.js';
import { getPayments } from '../services/database/queries/payment-queries.js';
import { getWires, getVisitsSummary, addVisit, updateVisit, deleteVisit, getVisitDetailsByID, getLatestWire } from '../services/database/queries/visit-queries.js';
import whatsapp from '../services/messaging/whatsapp.js';
import { sendImg_, sendXray_ } from '../services/messaging/whatsapp-api.js';
import { wsEmitter } from '../index.js';
import sms from '../services/messaging/sms.js';
import * as imaging from '../services/imaging/index.js';
import multer from 'multer';
import { sendgramfile } from '../services/messaging/telegram.js';
import qrcode from 'qrcode';
import messageState from '../services/state/messageState.js';
import { createWebSocketMessage, MessageSchemas } from '../services/messaging/schemas.js';
import { WebSocketEvents, createStandardMessage } from '../services/messaging/websocket-events.js';
import HealthCheck from '../services/monitoring/HealthCheck.js';
import * as messagingQueries from '../services/database/queries/messaging-queries.js';
import { getContacts } from '../services/authentication/google.js';

const router = express.Router();
const upload = multer();





// Patient information routes
router.get("/getinfos", async (req, res) => {
    const { code: pid } = req.query;
    const infos = await getInfos(pid);
    res.json(infos);
});

// Get time points
router.get("/gettimepoints", async (req, res) => {
    const { code: pid } = req.query;
    const timepoints = await getTimePoints(pid);
    res.json(timepoints);
});

router.get("/gettimepointimgs", async (req, res) => {
    const { code: pid, tp } = req.query;
    const timepointimgs = await getTimePointImgs(pid, tp);
    res.json(timepointimgs);
});

// Get payment details
router.get("/getpayments", async (req, res) => {
    const { code: pid } = req.query;
    const payments = await getPayments(pid);
    res.json(payments);
});

// Generate and get QR code
router.get("/getqrcode", async (req, res) => {
    const { code: pid } = req.query;
    await imaging.generateQRCode(pid);
    res.json({ OK: "OK" });
});

// Notify that apps were updated
router.get("/AppsUpdated", async (req, res) => {
    res.sendStatus(200);
    const { PDate } = req.query;
    console.log(`AppsUpdated called with date: ${PDate}`);
    
    // Emit universal event only
    wsEmitter.emit(WebSocketEvents.DATA_UPDATED, PDate);
});

// Handle patient loaded event
router.get("/patientloaded", (req, res) => {
    res.sendStatus(200);
    const { pid, screenid: screenID } = req.query;
    console.log(`PatientLoaded called with pid: ${pid}, screenID: ${screenID}`);
    
    // Emit universal event only
    wsEmitter.emit(WebSocketEvents.PATIENT_LOADED, pid, screenID);
});

// Handle patient unloaded event
router.get("/patientunloaded", (req, res) => {
    res.sendStatus(200);
    const { screenid: screenID } = req.query;
    console.log(`PatientUnloaded called with screenID: ${screenID}`);
    
    // Emit universal event only
    wsEmitter.emit(WebSocketEvents.PATIENT_UNLOADED, screenID);
});


// Get gallery images
router.get("/getgal", (req, res) => {
    const { code: pid, tp } = req.query;
    const images = imaging.getImageSizes(pid, tp);
    res.json(images);
});

// Get and process X-ray image
router.get("/getxray", async (req, res) => {
    const { code: pid, file, detailsDir } = req.query;
    const imagePath = await imaging.processXrayImage(pid, file, detailsDir);
    res.sendFile(imagePath);
});

// WhatsApp messaging routes
// router.get('/wa', (req, res) => {
//     messageState.gturbo = !!req.query.turbo;
//     messageState.reset();
//     res.sendFile('./public/send.html', { root: '.' });
// });

router.get('/api/clear', async (req, res) => {
    try {
        await whatsapp.clear();
        res.json({ htmltext: '<p>Done clearing</p>' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to clear' });
    }
});

router.get('/clear', (req, res) => {
    res.sendFile('./public/clear.html', { root: '.' });
});


router.get('/sendtwilio', async (req, res) => {
    const dateparam = req.query.date;
    try {
        await sms.sendSms(dateparam);
        res.send("SMS sent successfully");
    } catch (error) {
        res.status(500).send("Failed to send SMS");
    }
});

router.get('/checktwilio', async (req, res) => {
    const dateparam = req.query.date;
    try {
        await sms.checksms(dateparam);
        res.send("SMS check completed");
    } catch (error) {
        res.status(500).send("Failed to check SMS");
    }
});

/**
 * Legacy report update endpoint
 * @deprecated Use WebSocket for real-time report updates instead
 */
router.get('/updaterp', (req, res) => {
    console.log("Legacy updaterp endpoint called - WebSocket recommended");
    
    let html = '';
    if (messageState.clientReady) {
        if (messageState.finishReport) {
            html = '<p>Finished!</p>';
            res.json({ 
                htmltext: html, 
                finished: true,
                deprecated: true,
                websocketRecommended: true
            });
            messageState.finishReport = false;
            messageState.clientReady = false;
        } else {
            html = '<p>Working on it ...</p>';
            res.json({ 
                htmltext: html, 
                finished: false,
                deprecated: true,
                websocketRecommended: true
            });
        }
    } else {
        html = '<p>Initializing the client ...</p>';
        res.json({ 
            htmltext: html, 
            finished: false,
            deprecated: true,
            websocketRecommended: true
        });
    }
});



/**
 * Send WhatsApp message to specific patient
 * Uses stored procedure to get personalized message
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
        
        // Extract phone number (remove 964 prefix for WhatsApp)
        let phoneNumber = messageData.phone;
        if (phoneNumber.startsWith('964')) {
            phoneNumber = phoneNumber.substring(3);
        }
        
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

router.get('/sendxrayfile', async (req, res) => {
    const { phone, file } = req.query;
    try {
        const state = await sendXray_(phone, file);
        res.json(state);
    } catch (error) {
        res.status(500).json({ error: 'Failed to send X-ray file' });
    }
});

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

        let sentMessages = 0;
        let state = {};

        if (prog === "WhatsApp") {
            phone = phone.startsWith("+") || phone.startsWith("0") ? phone.substring(1) : phone;
            console.log(`WhatsApp - Formatted phone: ${phone}`);
            
            for (const path of paths) {
                console.log(`Sending WhatsApp file: ${path}`);
                state = await sendXray_(phone, path);
                console.log(`WhatsApp result:`, state);
                if (state.result === "OK") {
                    sentMessages += 1;
                }
            }
        } else if (prog === "Telegram") {
            // Improved phone number formatting for Telegram
            const originalPhone = phone;
            if (phone.startsWith("0")) {
                phone = "+964" + phone.substring(1);
            } else if (phone.startsWith("964")) {
                phone = "+" + phone;
            } else if (!phone.startsWith("+964") && !phone.startsWith("+")) {
                phone = "+964" + phone;
            }
            
            console.log(`Telegram - Original phone: ${originalPhone}, Formatted phone: ${phone}`);

            for (const path of paths) {
                console.log(`Sending Telegram file: ${path}`);
                state = await sendgramfile(phone, path);
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

// Add this new route
// Update the QR endpoint to NOT register viewers

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

router.get("/visitsSummary", async (req, res) => {
    try {
        const { PID } = req.query;
        if (!PID) {
            return res.status(400).json({ error: "Missing required parameter: PID" });
        }

        const visitsSummary = await getVisitsSummary(PID);
        res.json(visitsSummary);
    } catch (error) {
        console.error("Error fetching visits summary:", error);
        res.status(500).json({ error: "Failed to fetch visits summary" });
    }
});

router.get("/getWires", async (req, res) => {
    try {
        const wires = await getWires();
        res.json(wires);
    } catch (error) {
        console.error("Error fetching wires:", error);
        res.status(500).json({ error: "Failed to fetch wires" });
    }
});

// Get current web apps
router.get("/getWebApps", async (req, res) => {
    const { PDate } = req.query;
    const result = await getPresentAps(PDate);
    res.json(result);
});

// Get patient phone numbers
router.get("/patientsPhones", async (req, res) => {
    try {
        const phonesList = await getPatientsPhones();
        res.json(phonesList);
    } catch (error) {
        console.error("Error fetching patients phones:", error);
        res.status(500).json({ error: "Failed to fetch patients phones" });
    }
});

// Get Google contacts
router.get("/google", async (req, res) => {
    try {
        const { source } = req.query;
        if (!source) {
            return res.status(400).json({ error: "Missing required parameter: source" });
        }
        
        const contacts = await getContacts(source);
        res.json(contacts);
    } catch (error) {
        console.error("Error fetching Google contacts:", error);
        res.status(500).json({ 
            error: "Failed to fetch Google contacts",
            message: error.message
        });
    }
});

router.get("/getLatestwire", async (req, res) => {
    try {
        const { PID } = req.query;
        if (!PID) {
            return res.status(400).json({ error: "Missing required parameter: PID" });
        }

        const latestWire = await getLatestWire(PID);
        res.json(latestWire);
    } catch (error) {
        console.error("Error fetching latest wire:", error);
        res.status(500).json({ error: "Failed to fetch latest wire" });
    }
});

router.get("/getVisitDetailsByID", async (req, res) => {
    try {
        const { VID } = req.query;
        if (!VID) {
            return res.status(400).json({ error: "Missing required parameter: VID" });
        }

        const visitDetails = await getVisitDetailsByID(VID);
        res.json(visitDetails);
    } catch (error) {
        console.error("Error fetching visit details:", error);
        res.status(500).json({ error: "Failed to fetch visit details" });
    }
});

// REST API for visits
router.post("/addVisit", async (req, res) => {
    try {
        const { PID, visitDate, upperWireID, lowerWireID, others, next } = req.body;
        if (!PID || !visitDate) {
            return res.status(400).json({ status: 'error', message: 'Missing required parameters' });
        }

        const result = await addVisit(PID, visitDate, upperWireID, lowerWireID, others, next);
        res.json({ status: 'success', data: result });
    } catch (error) {
        console.error("Error adding visit:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

router.put("/updateVisit", async (req, res) => {
    try {
        const { VID, visitDate, upperWireID, lowerWireID, others, next } = req.body;
        if (!VID || !visitDate) {
            return res.status(400).json({ status: 'error', message: 'Missing required parameters' });
        }

        const result = await updateVisit(VID, visitDate, upperWireID, lowerWireID, others, next);
        res.json({ status: 'success', data: result });
    } catch (error) {
        console.error("Error updating visit:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

router.delete("/deleteVisit", async (req, res) => {
    try {
        const { VID } = req.body;
        if (!VID) {
            return res.status(400).json({ status: 'error', message: 'Missing required parameter: VID' });
        }

        const result = await deleteVisit(VID);
        res.json({ status: 'success', data: result });
    } catch (error) {
        console.error("Error deleting visit:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

/**
 * Get WhatsApp client status
 * Returns detailed information about the persistent client
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
 * Restart WhatsApp client
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

  /**
   * Legacy update endpoint - Used only as fallback for initial state
   * @deprecated This endpoint is maintained for WebSocket fallback only
   * Primary communication should use WebSocket for real-time updates
   */
  router.get('/update', async (req, res) => {
    try {
        console.log("Legacy update endpoint called (WebSocket fallback)");
        
        const stateDump = messageState.dump();
        const clientStatus = whatsapp.getStatus();
        
        let html = '';
        const isClientReady = stateDump.clientReady || clientStatus.active;
        const finished = stateDump.finishedSending;
        
        if (isClientReady) {
            if (finished) {
                html = `<p>${stateDump.sentMessages} Messages Sent!</p><p>${stateDump.failedMessages} Messages Failed!</p><p>Finished</p>`;
            } else {
                html = `<p>${stateDump.sentMessages} Messages Sent!</p><p>${stateDump.failedMessages} Messages Failed!</p><p>Sending...</p>`;
            }
        } else if (messageState.qr && messageState.activeQRViewers > 0) {
            html = '<p>QR code ready - Please scan with WhatsApp</p>';
        } else {
            html = '<p>Initializing the client...</p>';
        }
        
        // Optimized response for WebSocket-only clients
        const response = {
            success: true,
            htmltext: html,
            finished,
            clientReady: isClientReady,
            clientStatus: clientStatus,
            persons: messageState.persons,
            qr: isClientReady ? null : messageState.qr,
            stats: stateDump,
            timestamp: Date.now(),
            // Add hint for WebSocket usage
            websocketRecommended: true,
            websocketUrl: `${req.protocol === 'https' ? 'wss' : 'ws'}://${req.get('host')}`
        };
        
        res.json(response);
        
    } catch (error) {
        console.error("Error in legacy update endpoint:", error);
        res.status(500).json({
            success: false,
            error: error.message,
            htmltext: '<p>Error retrieving status</p>',
            finished: false,
            clientReady: false
        });
    }
});

/**
 * Health check endpoint
 */
router.get('/health', (req, res) => {
    try {
        const health = HealthCheck.getHealthStatus();
        const statusCode = health.overall ? 200 : 503;
        
        res.status(statusCode).json({
            status: health.overall ? 'healthy' : 'unhealthy',
            ...health
        });
    } catch (error) {
        console.error('Error getting health status:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to get health status',
            error: error.message
        });
    }
});

/**
 * Detailed health report endpoint
 */
router.get('/health/detailed', (req, res) => {
    try {
        const report = HealthCheck.getDetailedReport();
        res.json(report);
    } catch (error) {
        console.error('Error getting detailed health report:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to get detailed health report',
            error: error.message
        });
    }
});

/**
 * Start health monitoring
 */
router.post('/health/start', (req, res) => {
    try {
        HealthCheck.start();
        res.json({
            success: true,
            message: 'Health monitoring started'
        });
    } catch (error) {
        console.error('Error starting health monitoring:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to start health monitoring',
            error: error.message
        });
    }
});

/**
 * Stop health monitoring
 */
router.post('/health/stop', (req, res) => {
    try {
        HealthCheck.stop();
        res.json({
            success: true,
            message: 'Health monitoring stopped'
        });
    } catch (error) {
        console.error('Error stopping health monitoring:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to stop health monitoring',
            error: error.message
        });
    }
});

// ===== ADD MESSAGING-SPECIFIC ROUTES =====

/**
 * Circuit breaker status for messaging operations
 */
router.get('/messaging/circuit-breaker-status', (req, res) => {
    try {
        const status = messagingQueries.getCircuitBreakerStatus();
        res.json({
            success: true,
            ...status
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Reset circuit breaker (manual recovery)
 */
router.post('/messaging/reset-circuit-breaker', (req, res) => {
    try {
        const result = messagingQueries.resetCircuitBreaker();
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Batch status update endpoint
 */
router.post('/messaging/batch-status-update', async (req, res) => {
    try {
        const { updates } = req.body;
        
        if (!updates || !Array.isArray(updates)) {
            return res.status(400).json({
                success: false,
                error: 'Updates array is required'
            });
        }

        const result = await messagingQueries.batchUpdateMessageStatuses(updates, wsEmitter);
        res.json(result);
        
    } catch (error) {
        console.error('Error in batch status update:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Get message status by date
 */
router.get('/messaging/status/:date', async (req, res) => {
    try {
        const { date } = req.params;
        const result = await messagingQueries.getMessageStatusByDate(date);
        
        // Transform the database format to frontend format
        if (result && result.messages) {
            result.messages = result.messages.map(msg => {
                // Convert sentStatus (boolean) + deliveryStatus (string) to numeric status
                let status = 0; // Default to pending
                
                if (!msg.sentStatus) {
                    // Not sent yet
                    status = 0;
                } else if (msg.deliveryStatus === 'ERROR') {
                    // Failed
                    status = -1;
                } else if (msg.deliveryStatus === 'SERVER') {
                    // Received by WhatsApp server
                    status = 1; // Server
                } else if (msg.deliveryStatus === 'DEVICE') {
                    // Delivered to user's device
                    status = 2; // Device
                } else if (msg.deliveryStatus === 'read' || msg.deliveryStatus === 'READ'.toUpperCase()) {
                    // Read by user
                    status = 3; // Read
                } else if (msg.deliveryStatus === 'PLAYED') {
                    // Voice message played
                    status = 4; // Played
                } else if (msg.sentStatus) {
                    // Sent but no delivery status yet
                    status = 1;
                }
                
                return {
                    ...msg,
                    status: status,
                    // Map field names to what frontend expects
                    name: msg.patientName,
                    phone: msg.phone,
                    timeSent: msg.sentTimestamp,
                    message: '', // Will be populated if needed
                    messageId: msg.messageId,
                    // Include original values for debugging
                    originalSentStatus: msg.sentStatus,
                    originalDeliveryStatus: msg.deliveryStatus
                };
            });
        }
        
        res.json(result);
    } catch (error) {
        console.error('Error getting message status:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ===== ADD ENHANCED WA STATUS ROUTES =====

/**
 * Detailed WhatsApp status endpoint
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




/**
 * Get message count for a specific date
 * Returns how many appointments are scheduled and eligible for messaging
 */
router.get('/messaging/count/:date', async (req, res) => {
    try {
        const { date } = req.params;
        console.log(`Getting message count for date: ${date}`);
        
        // Get actual WhatsApp messages to be sent for the date
        const whatsappMessages = await getWhatsAppMessages(date);
        
        // whatsappMessages returns [numbers, messages, ids, names]
        const [numbers, messages, ids, names] = whatsappMessages || [[], [], [], []];
        const messageCount = {
            date: date,
            totalMessages: numbers.length,
            eligibleForMessaging: numbers.length,
            alreadySent: 0,
            pending: 0
        };

        // Get existing message statuses for this date
        try {
            const existingMessages = await messagingQueries.getMessageStatusByDate(date);
            if (existingMessages && existingMessages.messages) {
                messageCount.alreadySent = existingMessages.messages.filter(m => m.status >= 1).length;
                messageCount.pending = existingMessages.messages.filter(m => m.status === 0).length;
            }
        } catch (msgError) {
            console.warn('Could not get existing message statuses:', msgError.message);
            // Continue without existing message data
        }

        console.log(`Message count for ${date}:`, messageCount);
        
        res.json({
            success: true,
            data: messageCount,
            timestamp: Date.now()
        });
        
    } catch (error) {
        console.error('Error getting message count:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: Date.now()
        });
    }
});

/**
 * Reset messaging status for a specific date
 * Calls the ResetMessagingForDate stored procedure
 */
router.post('/messaging/reset/:date', async (req, res) => {
    try {
        const { date } = req.params;
        console.log(`Resetting messaging for date: ${date}`);
        
        // Execute the stored procedure
        const result = await database.executeStoredProcedure(
            'ResetMessagingForDate',
            [['ResetDate', database.TYPES.Date, date]],
            null,
            (columns) => {
                // Map the result columns
                if (columns.length >= 7) {
                    return {
                        resetDate: columns[0].value,
                        totalAppointments: columns[1].value,
                        readyForWhatsApp: columns[2].value,
                        readyForSMS: columns[3].value,
                        alreadySentWA: columns[4].value,
                        alreadyNotified: columns[5].value,
                        appointmentsReset: columns[6].value,
                        smsRecordsReset: columns[7].value || 0
                    };
                }
                return null;
            },
            (result) => {
                const resetStats = result && result.length > 0 ? result[0] : {
                    resetDate: date,
                    totalAppointments: 0,
                    readyForWhatsApp: 0,
                    readyForSMS: 0,
                    alreadySentWA: 0,
                    alreadyNotified: 0,
                    appointmentsReset: 0,
                    smsRecordsReset: 0
                };
                
                console.log(`Reset completed for ${date}:`, resetStats);
                return resetStats;
            }
        );
        
        res.json({
            success: true,
            message: `Messaging reset completed for ${date}`,
            data: result,
            timestamp: Date.now()
        });
        
    } catch (error) {
        console.error('Error resetting messaging:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to reset messaging status',
            timestamp: Date.now()
        });
    }
});

/**
 * Get detailed message information for a specific date
 * Returns both potential messages and existing message statuses
 */
router.get('/messaging/details/:date', async (req, res) => {
    try {
        const { date } = req.params;
        console.log(`Getting message details for date: ${date}`);
        
        const result = {
            date: date,
            messagesToSend: [],
            existingMessages: [],
            summary: {
                totalMessages: 0,
                eligibleForMessaging: 0,
                messagesSent: 0,
                messagesDelivered: 0,
                messagesFailed: 0,
                messagesPending: 0
            }
        };

        // Get WhatsApp messages to be sent for the date
        const whatsappMessages = await getWhatsAppMessages(date);
        
        // whatsappMessages returns [numbers, messages, ids, names]
        const [numbers, messages, ids, names] = whatsappMessages || [[], [], [], []];
        
        if (numbers.length > 0) {
            // Convert arrays to objects for frontend
            result.messagesToSend = numbers.map((number, index) => ({
                id: ids[index] || '',
                number: number || '',
                name: names[index] || '',
                message: messages[index] || ''
            }));
            result.summary.totalMessages = numbers.length;
            result.summary.eligibleForMessaging = numbers.length;
        }

        // Get existing message statuses
        try {
            const messageStatuses = await messagingQueries.getMessageStatusByDate(date);
            if (messageStatuses && messageStatuses.messages) {
                result.existingMessages = messageStatuses.messages;
                
                // Count message statuses
                result.existingMessages.forEach(msg => {
                    if (msg.status === 0) result.summary.messagesPending++;
                    else if (msg.status === 1) result.summary.messagesSent++;
                    else if (msg.status >= 2) result.summary.messagesDelivered++;
                    else if (msg.status === -1) result.summary.messagesFailed++;
                });
            }
        } catch (msgError) {
            console.warn('Could not get message statuses for details:', msgError.message);
            result.existingMessages = [];
        }

        console.log(`Message details for ${date}: ${result.summary.totalMessages} messages to send, ${result.existingMessages.length} existing messages`);
        
        res.json({
            success: true,
            data: result,
            timestamp: Date.now()
        });
        
    } catch (error) {
        console.error('Error getting message details:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: Date.now()
        });
    }
});

export default router;