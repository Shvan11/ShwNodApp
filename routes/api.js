/**
 * API routes
 */
import express from 'express';

import * as database from '../services/database/queries/index.js';
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
import HealthCheck from '../services/monitoring/HealthCheck.js';
import * as messagingQueries from '../services/database/queries/messaging-queries.js';

const router = express.Router();
const upload = multer();




whatsapp.on('MessageSent', async (person) => {
    console.log("MessageSent event fired:", person);
    try {
        person.success = '&#10004;';
        await messageState.addPerson(person);
        
        // Broadcast via WebSocket
        if (wsEmitter) {
            const message = createWebSocketMessage(
                MessageSchemas.WebSocketMessage.MESSAGE_STATUS,
                {
                    messageId: person.messageId,
                    status: MessageSchemas.MessageStatus.SERVER,
                    person
                }
            );
            wsEmitter.emit('broadcast_message', message);
        }
        
        console.log("MessageSent processed successfully");
    } catch (error) {
        console.error("Error handling MessageSent event:", error);
    }
});

whatsapp.on('MessageFailed', async (person) => {
    console.log("MessageFailed event fired:", person);
    try {
        person.success = '&times;';
        await messageState.addPerson(person);
        
        // Broadcast failure
        if (wsEmitter) {
            const message = createWebSocketMessage(
                MessageSchemas.WebSocketMessage.MESSAGE_STATUS,
                {
                    messageId: person.messageId || `failed_${Date.now()}`,
                    status: MessageSchemas.MessageStatus.ERROR,
                    person
                }
            );
            wsEmitter.emit('broadcast_message', message);
        }
        
        console.log("MessageFailed processed successfully");
    } catch (error) {
        console.error("Error handling MessageFailed event:", error);
    }
});

whatsapp.on('finishedSending', async () => {
    console.log("finishedSending event fired");
    try {
        await messageState.setFinishedSending(true);
        
        // Broadcast completion
        if (wsEmitter) {
            const message = createWebSocketMessage(
                'sending_finished',
                { finished: true, stats: messageState.dump() }
            );
            wsEmitter.emit('broadcast_message', message);
        }
    } catch (error) {
        console.error("Error handling finishedSending event:", error);
    }
});

whatsapp.on('ClientIsReady', async () => {
    console.log("ClientIsReady event fired");
    try {
        await messageState.setClientReady(true);
        
        // Broadcast client ready
        if (wsEmitter) {
            const message = createWebSocketMessage(
                MessageSchemas.WebSocketMessage.CLIENT_READY,
                { clientReady: true }
            );
            wsEmitter.emit('broadcast_message', message);
        }
    } catch (error) {
        console.error("Error handling ClientIsReady event:", error);
    }
});

whatsapp.on('qr', async (qr) => {
    console.log("QR event fired");
    try {
        await messageState.setQR(qr);
        
        // Only broadcast if there are active viewers
        if (messageState.activeQRViewers > 0 && wsEmitter) {
            const message = createWebSocketMessage(
                MessageSchemas.WebSocketMessage.QR_UPDATE,
                { qr, clientReady: false }
            );
            wsEmitter.emit('broadcast_message', message);
        }
    } catch (error) {
        console.error("Error handling QR event:", error);
    }
});


// Patient information routes
router.get("/getinfos", async (req, res) => {
    const { code: pid } = req.query;
    const infos = await database.getInfos(pid);
    res.json(infos);
});

// Get time points
router.get("/gettimepoints", async (req, res) => {
    const { code: pid } = req.query;
    const timepoints = await database.getTimePoints(pid);
    res.json(timepoints);
});

router.get("/gettimepointimgs", async (req, res) => {
    const { code: pid, tp } = req.query;
    const timepointimgs = await database.getTimePointImgs(pid, tp);
    res.json(timepointimgs);
});

// Get payment details
router.get("/getpayments", async (req, res) => {
    const { code: pid } = req.query;
    const payments = await database.getPayments(pid);
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
    wsEmitter.emit("updated", PDate);
});

// Handle patient loaded event
router.get("/patientloaded", (req, res) => {
    res.sendStatus(200);
    const { pid, screenid: screenID } = req.query;
    wsEmitter.emit("patientLoaded", pid, screenID);
});

// Handle patient unloaded event
router.get("/patientunloaded", (req, res) => {
    res.sendStatus(200);
    const { screenid: screenID } = req.query;
    wsEmitter.emit("patientUnLoaded", screenID);
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
router.get('/wareport', (req, res) => {
    messageState.reset();
    messageState.finishReport = false;
    res.sendFile('./public/report.html', { root: '.' });
});


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
        await sendSMSNoti(dateparam);
        res.send("SMS sent successfully");
    } catch (error) {
        res.status(500).send("Failed to send SMS");
    }
});

router.get('/checktwilio', async (req, res) => {
    const dateparam = req.query.date;
    try {
        await CheckSMSNoti(dateparam);
        res.send("SMS check completed");
    } catch (error) {
        res.status(500).send("Failed to check SMS");
    }
});

router.get('/updaterp', (req, res) => {
    let html = '';
    if (messageState.clientReady) {
        if (messageState.finishReport) {
            html = '<p>Finished!</p>';
            res.json({ htmltext: html, finished: true });
            messageState.finishReport = false;
            messageState.clientReady = false;
        } else {
            html = '<p>Working on it ...</p>';
            res.json({ htmltext: html, finished: false });
        }
    } else {
        html = '<p>Initializing the client ...</p>';
        res.json({ htmltext: html, finished: false });
    }
});



router.get('/wa/send', async (req, res) => {
    const dateparam = req.query.date;
    
    try {
        console.log(`WhatsApp send request for date: ${dateparam}`);
        
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
                const message = createWebSocketMessage(
                    MessageSchemas.WebSocketMessage.ERROR,
                    { 
                        error: `Send process failed: ${error.message}`,
                        date: dateparam 
                    }
                );
                wsEmitter.emit('broadcast_message', message);
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
    const paths = req.body.file.split(',');
    let phone = req.body.phone;
    const prog = req.body.prog;

    let sentMessages = 0;
    let state = {};

    if (prog === "WhatsApp") {
        phone = phone.startsWith("+") || phone.startsWith("0") ? phone.substring(1) : phone;
        for (const path of paths) {
            state = await sendXray_(phone, path);
            if (state.result === "OK") {
                sentMessages += 1;
            }
        }
    } else {
        if (phone.startsWith("0")) {
            phone = "+964" + phone.substring(1);
        }
        else if (!phone.startsWith("+964")) {
            phone = "+964" + phone;
        }

        for (const path of paths) {
            state = await sendgramfile(phone, path);
            if (state.result === "OK") {
                sentMessages += 1;
            }
        }
    }

    state.sentMessages = sentMessages;
    res.json(state);
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

        const visitsSummary = await database.getVisitsSummary(PID);
        res.json(visitsSummary);
    } catch (error) {
        console.error("Error fetching visits summary:", error);
        res.status(500).json({ error: "Failed to fetch visits summary" });
    }
});

router.get("/getWires", async (req, res) => {
    try {
        const wires = await database.getWires();
        res.json(wires);
    } catch (error) {
        console.error("Error fetching wires:", error);
        res.status(500).json({ error: "Failed to fetch wires" });
    }
});

// Get current web apps
router.get("/getWebApps", async (req, res) => {
    const { PDate } = req.query;
    const result = await database.getPresentAps(PDate);
    res.json(result);
});

// Get patient phone numbers
router.get("/patientsPhones", async (req, res) => {
    const phonesList = await database.getPatientsPhones();
    res.json(phonesList);
});

router.get("/getLatestwire", async (req, res) => {
    try {
        const { PID } = req.query;
        if (!PID) {
            return res.status(400).json({ error: "Missing required parameter: PID" });
        }

        const latestWire = await database.getLatestWire(PID);
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

        const visitDetails = await database.getVisitDetailsByID(VID);
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

        const result = await database.addVisit(PID, visitDate, upperWireID, lowerWireID, others, next);
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

        const result = await database.updateVisit(VID, visitDate, upperWireID, lowerWireID, others, next);
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

        const result = await database.deleteVisit(VID);
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

  // Find this route
  router.get('/update', async (req, res) => {
    try {
        console.log("Update endpoint called");
        
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
        
        // Prepare response
        const response = {
            success: true,
            htmltext: html,
            finished,
            clientReady: isClientReady,
            clientStatus: clientStatus,
            persons: messageState.persons,
            qr: isClientReady ? null : messageState.qr,
            stats: stateDump,
            timestamp: Date.now()
        };
        
        res.json(response);
        
    } catch (error) {
        console.error("Error in update endpoint:", error);
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



// Helper functions
async function sendSMSNoti(date) {
    // This function should be in the SMS service but kept here for backward compatibility
    try {
        await sms.sendSms(date);
        return true;
    } catch (error) {
        console.error("SMS notification error:", error);
        return false;
    }
}

async function CheckSMSNoti(date) {
    // This function should be in the SMS service but kept here for backward compatibility
    try {
        await sms.checksms(date);
        return true;
    } catch (error) {
        console.error("SMS check error:", error);
        return false;
    }
}

export default router;