/**
 * API routes
 */
import express from 'express';

import * as database from '../services/database/index.js';
import { getPresentAps, getAllTodayApps, getPresentTodayApps, updatePresent } from '../services/database/queries/appointment-queries.js';
import {getTimePoints, getTimePointImgs } from '../services/database/queries/timepoint-queries.js';
import { getWhatsAppMessages } from '../services/database/queries/messaging-queries.js';
import { getPatientsPhones, getInfos, createPatient, getReferralSources, getPatientTypes, getAddresses, getGenders } from '../services/database/queries/patient-queries.js';
import { getPayments, getActiveWorkForInvoice, getCurrentExchangeRate, addInvoice, updateExchangeRate } from '../services/database/queries/payment-queries.js';
import { getWires, getVisitsSummary, addVisit, updateVisit, deleteVisit, getVisitDetailsByID, getLatestWire } from '../services/database/queries/visit-queries.js';
import { getWorksByPatient, getWorkDetails, addWork, updateWork, finishWork, getActiveWork, getWorkTypes, getWorkKeywords, getWorkDetailsList, addWorkDetail, updateWorkDetail, deleteWorkDetail } from '../services/database/queries/work-queries.js';
import whatsapp from '../services/messaging/whatsapp.js';
import { sendImg_, sendXray_ } from '../services/messaging/whatsapp-api.js';
// WebSocket emitter will be injected to avoid circular imports
let wsEmitter = null;

/**
 * Set the WebSocket emitter reference
 * @param {EventEmitter} emitter - WebSocket event emitter
 */
export function setWebSocketEmitter(emitter) {
    wsEmitter = emitter;
}
import sms from '../services/messaging/sms.js';
import * as imaging from '../services/imaging/index.js';
import multer from 'multer';
import { sendgramfile } from '../services/messaging/telegram.js';
import qrcode from 'qrcode';
import config from '../config/config.js';
import path from 'path';
import PhoneFormatter from '../utils/phoneFormatter.js';
import messageState from '../services/state/messageState.js';
import { createWebSocketMessage, MessageSchemas } from '../services/messaging/schemas.js';
import { WebSocketEvents, createStandardMessage } from '../services/messaging/websocket-events.js';
import HealthCheck from '../services/monitoring/HealthCheck.js';
import * as messagingQueries from '../services/database/queries/messaging-queries.js';
import { getContacts } from '../services/authentication/google.js';
import { createPathResolver } from '../utils/path-resolver.js';
import { getAllOptions, getOption, updateOption, getOptionsByPattern, bulkUpdateOptions } from '../services/database/queries/options-queries.js';
import DatabaseConfigService from '../services/config/DatabaseConfigService.js';

const router = express.Router();
const upload = multer();





// Patient information routes
router.get("/getinfos", async (req, res) => {
    const { code: pid } = req.query;
    const infos = await getInfos(pid);
    res.json(infos);
});

// Get doctors only (Position = Doctor)
router.get("/doctors", async (req, res) => {
    try {
        const query = `
            SELECT e.ID, e.employeeName 
            FROM tblEmployees e 
            INNER JOIN tblPositions p ON e.Position = p.ID 
            WHERE p.PositionName = 'Doctor'
            ORDER BY e.employeeName
        `;
        const doctors = await database.executeQuery(
            query,
            [],
            (columns) => ({
                ID: columns[0].value,
                employeeName: columns[1].value
            })
        );
        res.json(doctors);
    } catch (error) {
        console.error('Error fetching doctors:', error);
        res.status(500).json({ error: 'Failed to fetch doctors' });
    }
});

// Get appointment details
router.get("/appointment-details", async (req, res) => {
    try {
        const query = `SELECT ID, Detail FROM tblDetail ORDER BY Detail`;
        const details = await database.executeQuery(
            query,
            [],
            (columns) => ({
                ID: columns[0].value,
                Detail: columns[1].value
            })
        );
        res.json(details);
    } catch (error) {
        console.error('Error fetching appointment details:', error);
        res.status(500).json({ error: 'Failed to fetch appointment details' });
    }
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
    try {
        const { code: pid, file, detailsDir } = req.query;
        
        if (!pid || !file) {
            return res.status(400).json({ error: 'Missing required parameters: code and file' });
        }
        
        const imagePath = await imaging.processXrayImage(pid, file, detailsDir);
        res.sendFile(imagePath);
    } catch (error) {
        console.error('Error processing X-ray:', error);
        res.status(500).json({ 
            error: 'X-ray processing failed', 
            message: error.message,
            details: 'X-ray processing tool may not be available in this environment'
        });
    }
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

// Get all today's appointments (not checked in)
router.get("/getAllTodayApps", async (req, res) => {
    try {
        const { AppsDate } = req.query;
        if (!AppsDate) {
            return res.status(400).json({ error: "Missing required parameter: AppsDate" });
        }
        const result = await getAllTodayApps(AppsDate);
        res.json(result);
    } catch (error) {
        console.error("Error fetching all today appointments:", error);
        res.status(500).json({ error: "Failed to fetch appointments" });
    }
});

// Get all present appointments (including dismissed) for daily appointments view
router.get("/getPresentTodayApps", async (req, res) => {
    try {
        const { AppsDate } = req.query;
        if (!AppsDate) {
            return res.status(400).json({ error: "Missing required parameter: AppsDate" });
        }
        
        const result = await getPresentTodayApps(AppsDate);
        res.json(result);
    } catch (error) {
        console.error("Error fetching present appointments:", error);
        res.status(500).json({ error: "Failed to fetch present appointments" });
    }
});

// Update patient appointment state
router.post("/updateAppointmentState", async (req, res) => {
    try {
        const { appointmentID, state, time } = req.body;
        if (!appointmentID || !state) {
            return res.status(400).json({ error: "Missing required parameters: appointmentID, state" });
        }
        
        // Format time as string for the modified stored procedure
        const now = new Date();
        const currentTime = time || `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        console.log(`Updating appointment ${appointmentID} with state: ${state}, time: ${currentTime}`);
        const result = await updatePresent(appointmentID, state, currentTime);
        
        wsEmitter.emit(WebSocketEvents.DATA_UPDATED, new Date().toISOString().split('T')[0]);
        
        res.json(result);
    } catch (error) {
        console.error("Error updating appointment state:", error);
        res.status(500).json({ error: "Failed to update appointment state" });
    }
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

// Invoice-related routes
router.get("/getActiveWorkForInvoice", async (req, res) => {
    try {
        const { PID } = req.query;
        if (!PID) {
            return res.status(400).json({ status: 'error', message: 'Missing required parameter: PID' });
        }

        const workData = await getActiveWorkForInvoice(PID);
        res.json({ status: 'success', data: workData });
    } catch (error) {
        console.error("Error getting active work for invoice:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

router.get("/getCurrentExchangeRate", async (req, res) => {
    try {
        const exchangeRate = await getCurrentExchangeRate();
        
        if (exchangeRate === null || exchangeRate === undefined) {
            return res.status(404).json({ 
                status: 'error', 
                message: 'No exchange rate set for today. Please set today\'s exchange rate first.' 
            });
        }
        
        res.json({ status: 'success', exchangeRate });
    } catch (error) {
        console.error("Error getting exchange rate:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

router.post("/addInvoice", async (req, res) => {
    try {
        const { workid, amountPaid, paymentDate, actualAmount, actualCurrency, change } = req.body;
        
        if (!workid || !amountPaid || !paymentDate) {
            return res.status(400).json({ 
                status: 'error', 
                message: 'Missing required parameters: workid, amountPaid, paymentDate' 
            });
        }

        const result = await addInvoice({
            workid,
            amountPaid,
            paymentDate,
            actualAmount,
            actualCurrency,
            change
        });
        
        res.json({ status: 'success', data: result });
    } catch (error) {
        console.error("Error adding invoice:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

router.post("/updateExchangeRate", async (req, res) => {
    try {
        const { exchangeRate } = req.body;
        
        if (!exchangeRate || exchangeRate <= 0) {
            return res.status(400).json({ 
                status: 'error', 
                message: 'Valid exchange rate is required' 
            });
        }

        const result = await updateExchangeRate(exchangeRate);
        res.json({ status: 'success', data: result });
    } catch (error) {
        console.error("Error updating exchange rate:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// Create new appointment
router.post("/appointments", async (req, res) => {
    try {
        const { PersonID, AppDate, AppDetail, DrID } = req.body;
        
        // Validate required fields
        if (!PersonID || !AppDate || !AppDetail || !DrID) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: PersonID, AppDate, AppDetail, DrID'
            });
        }
        
        // Validate data types
        if (isNaN(parseInt(PersonID)) || isNaN(parseInt(DrID))) {
            return res.status(400).json({
                success: false,
                error: 'PersonID and DrID must be valid numbers'
            });
        }
        
        // Validate date format
        const appointmentDate = new Date(AppDate);
        if (isNaN(appointmentDate.getTime())) {
            return res.status(400).json({
                success: false,
                error: 'Invalid date format for AppDate'
            });
        }
        
        // Check if doctor exists and is actually a doctor
        const doctorCheck = await database.executeQuery(`
            SELECT e.ID, e.employeeName, p.PositionName 
            FROM tblEmployees e 
            INNER JOIN tblPositions p ON e.Position = p.ID 
            WHERE e.ID = @drID AND p.PositionName = 'Doctor'
        `, [['drID', database.TYPES.Int, parseInt(DrID)]]);
        
        if (!doctorCheck || doctorCheck.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid doctor ID or employee is not a doctor'
            });
        }
        
        // Check for appointment conflicts (same patient, same day)
        const conflictCheck = await database.executeQuery(`
            SELECT appointmentID 
            FROM tblappointments 
            WHERE PersonID = @personID AND CAST(AppDate AS DATE) = CAST(@appDate AS DATE)
        `, [
            ['personID', database.TYPES.Int, parseInt(PersonID)],
            ['appDate', database.TYPES.DateTime, AppDate]
        ]);
        
        if (conflictCheck && conflictCheck.length > 0) {
            return res.status(400).json({
                success: false,
                error: 'Patient already has an appointment on this date'
            });
        }
        
        // Insert new appointment (defaults will be applied automatically)
        const insertQuery = `
            INSERT INTO tblappointments (
                PersonID, 
                AppDate, 
                AppDetail, 
                DrID,
                LastUpdated
            ) VALUES (@personID, @appDate, @appDetail, @drID, GETDATE())
        `;
        
        const result = await database.executeQuery(insertQuery, [
            ['personID', database.TYPES.Int, parseInt(PersonID)],
            ['appDate', database.TYPES.DateTime, AppDate],
            ['appDetail', database.TYPES.NVarChar, AppDetail],
            ['drID', database.TYPES.Int, parseInt(DrID)]
        ]);
        
        // Get the newly created appointment ID
        const newAppointmentId = result.insertId || result.recordset?.[0]?.appointmentID;
        
        console.log(`New appointment created - ID: ${newAppointmentId}, Patient: ${PersonID}, Doctor: ${doctorCheck[0]?.employeeName || 'Unknown'}, Date: ${AppDate}`);
        console.log('Result object:', result);
        console.log('Doctor check result:', doctorCheck);
        
        // Emit WebSocket event for real-time updates
        if (wsEmitter) {
            const appointmentDay = appointmentDate.toISOString().split('T')[0];
            wsEmitter.emit('appointments_updated', appointmentDay);
        }
        
        res.json({
            success: true,
            appointmentID: newAppointmentId,
            message: 'Appointment created successfully',
            appointment: {
                PersonID: parseInt(PersonID),
                AppDate,
                AppDetail,
                DrID: parseInt(DrID),
                doctorName: doctorCheck[0].employeeName
            }
        });
        
    } catch (error) {
        console.error('Error creating appointment:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create appointment',
            details: error.message
        });
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

// Convert web path to full UNC path
router.get('/convert-path', async (req, res) => {
    try {
        const { path: webPath } = req.query;
        
        console.log('Convert-path request received:', { webPath, machinePath: config.fileSystem.machinePath });
        
        if (!webPath) {
            return res.status(400).json({
                error: "Missing path parameter"
            });
        }

        if (!config.fileSystem.machinePath) {
            console.error('MACHINE_PATH environment variable not set');
            return res.status(500).json({
                error: "MACHINE_PATH environment variable not configured"
            });
        }

        // Create path resolver
        const pathResolver = createPathResolver(config.fileSystem.machinePath);
        
        // Convert DolImgs path to full file system path
        if (webPath.startsWith('DolImgs/')) {
            const fileName = webPath.replace('DolImgs/', '');
            const fullPath = pathResolver(`working/${fileName}`);
            
            console.log('Path conversion successful:', { webPath, fileName, fullPath });
            
            res.json({
                webPath: webPath,
                fullPath: fullPath
            });
        } else {
            // If not a DolImgs path, return as-is (could be already a full path)
            console.log('Path not a DolImgs path, returning as-is:', webPath);
            res.json({
                webPath: webPath,
                fullPath: webPath
            });
        }
        
    } catch (error) {
        console.error('Error converting path:', error);
        res.status(500).json({
            error: error.message || "Internal server error"
        });
    }
});

// Get referral sources for dropdowns
router.get('/referral-sources', async (req, res) => {
    try {
        const referralSources = await getReferralSources();
        res.json(referralSources);
    } catch (error) {
        console.error('Error fetching referral sources:', error);
        res.status(500).json({
            error: error.message || "Failed to fetch referral sources"
        });
    }
});

// Get patient types for dropdowns
router.get('/patient-types', async (req, res) => {
    try {
        const patientTypes = await getPatientTypes();
        res.json(patientTypes);
    } catch (error) {
        console.error('Error fetching patient types:', error);
        res.status(500).json({
            error: error.message || "Failed to fetch patient types"
        });
    }
});

// Get addresses for dropdowns
router.get('/addresses', async (req, res) => {
    try {
        const addresses = await getAddresses();
        res.json(addresses);
    } catch (error) {
        console.error('Error fetching addresses:', error);
        res.status(500).json({
            error: error.message || "Failed to fetch addresses"
        });
    }
});

// Get genders for dropdowns
router.get('/genders', async (req, res) => {
    try {
        const genders = await getGenders();
        res.json(genders);
    } catch (error) {
        console.error('Error fetching genders:', error);
        res.status(500).json({
            error: error.message || "Failed to fetch genders"
        });
    }
});

// Create new patient
router.post('/patients', async (req, res) => {
    try {
        const patientData = req.body;
        
        // Basic validation
        if (!patientData.patientName || !patientData.patientName.trim()) {
            return res.status(400).json({
                error: "Patient name is required"
            });
        }

        // Trim string values
        Object.keys(patientData).forEach(key => {
            if (typeof patientData[key] === 'string') {
                patientData[key] = patientData[key].trim();
                // Convert empty strings to null for optional fields
                if (patientData[key] === '' && key !== 'patientName') {
                    patientData[key] = null;
                }
            }
        });

        // Create the patient
        const result = await createPatient(patientData);
        
        res.json({
            success: true,
            personId: result.personId,
            message: "Patient created successfully"
        });
        
    } catch (error) {
        console.error('Error creating patient:', error);
        res.status(500).json({
            error: error.message || "Failed to create patient"
        });
    }
});

// ===== WORK MANAGEMENT API ENDPOINTS =====

// Get all works for a patient
router.get('/getworks', async (req, res) => {
    try {
        const { code: personId } = req.query;
        if (!personId) {
            return res.status(400).json({ error: "Missing required parameter: code (PersonID)" });
        }

        const works = await getWorksByPatient(parseInt(personId));
        res.json(works);
    } catch (error) {
        console.error("Error fetching works:", error);
        res.status(500).json({ error: "Failed to fetch works" });
    }
});

// Get specific work details
router.get('/getworkdetails', async (req, res) => {
    try {
        const { workId } = req.query;
        if (!workId) {
            return res.status(400).json({ error: "Missing required parameter: workId" });
        }

        const workDetails = await getWorkDetails(parseInt(workId));
        if (!workDetails) {
            return res.status(404).json({ error: "Work not found" });
        }
        
        res.json(workDetails);
    } catch (error) {
        console.error("Error fetching work details:", error);
        res.status(500).json({ error: "Failed to fetch work details" });
    }
});

// Add new work
router.post('/addwork', async (req, res) => {
    try {
        const workData = req.body;
        
        // Validate required fields
        if (!workData.PersonID || !workData.DrID) {
            return res.status(400).json({ 
                error: "Missing required fields: PersonID and DrID are required" 
            });
        }

        // Validate data types
        if (isNaN(parseInt(workData.PersonID)) || isNaN(parseInt(workData.DrID))) {
            return res.status(400).json({
                error: "PersonID and DrID must be valid numbers"
            });
        }

        // Convert date strings to proper Date objects if provided
        ['StartDate', 'DebondDate', 'FPhotoDate', 'IPhotoDate', 'NotesDate'].forEach(field => {
            if (workData[field] && typeof workData[field] === 'string') {
                const date = new Date(workData[field]);
                if (isNaN(date.getTime())) {
                    return res.status(400).json({
                        error: `Invalid date format for ${field}`
                    });
                }
                workData[field] = date;
            }
        });

        const result = await addWork(workData);
        res.json({ 
            success: true, 
            workId: result.workid,
            message: "Work added successfully" 
        });
    } catch (error) {
        console.error("Error adding work:", error);
        res.status(500).json({ error: "Failed to add work", details: error.message });
    }
});

// Update existing work
router.put('/updatework', async (req, res) => {
    try {
        const { workId, ...workData } = req.body;
        
        if (!workId) {
            return res.status(400).json({ error: "Missing required field: workId" });
        }

        // Validate DrID is provided
        if (!workData.DrID) {
            return res.status(400).json({ error: "DrID is required" });
        }

        // Validate data types
        if (isNaN(parseInt(workId)) || isNaN(parseInt(workData.DrID))) {
            return res.status(400).json({
                error: "workId and DrID must be valid numbers"
            });
        }

        // Convert date strings to proper Date objects if provided
        ['StartDate', 'DebondDate', 'FPhotoDate', 'IPhotoDate', 'NotesDate'].forEach(field => {
            if (workData[field] && typeof workData[field] === 'string') {
                const date = new Date(workData[field]);
                if (isNaN(date.getTime())) {
                    return res.status(400).json({
                        error: `Invalid date format for ${field}`
                    });
                }
                workData[field] = date;
            }
        });

        const result = await updateWork(parseInt(workId), workData);
        res.json({ 
            success: true, 
            message: "Work updated successfully",
            rowsAffected: result.rowCount
        });
    } catch (error) {
        console.error("Error updating work:", error);
        res.status(500).json({ error: "Failed to update work", details: error.message });
    }
});

// Finish/Complete work
router.post('/finishwork', async (req, res) => {
    try {
        const { workId } = req.body;
        
        if (!workId) {
            return res.status(400).json({ error: "Missing required field: workId" });
        }

        if (isNaN(parseInt(workId))) {
            return res.status(400).json({ error: "workId must be a valid number" });
        }

        const result = await finishWork(parseInt(workId));
        res.json({ 
            success: true, 
            message: "Work completed successfully",
            rowsAffected: result.rowCount
        });
    } catch (error) {
        console.error("Error finishing work:", error);
        res.status(500).json({ error: "Failed to finish work", details: error.message });
    }
});

// Get active work for a patient
router.get('/getactivework', async (req, res) => {
    try {
        const { code: personId } = req.query;
        if (!personId) {
            return res.status(400).json({ error: "Missing required parameter: code (PersonID)" });
        }

        const activeWork = await getActiveWork(parseInt(personId));
        res.json(activeWork);
    } catch (error) {
        console.error("Error fetching active work:", error);
        res.status(500).json({ error: "Failed to fetch active work" });
    }
});

// Get work types for dropdown
router.get('/getworktypes', async (req, res) => {
    try {
        const workTypes = await getWorkTypes();
        res.json(workTypes);
    } catch (error) {
        console.error("Error fetching work types:", error);
        res.status(500).json({ error: "Failed to fetch work types" });
    }
});

// Get work keywords for dropdown
router.get('/getworkkeywords', async (req, res) => {
    try {
        const keywords = await getWorkKeywords();
        res.json(keywords);
    } catch (error) {
        console.error("Error fetching work keywords:", error);
        res.status(500).json({ error: "Failed to fetch work keywords" });
    }
});

// ===== WORK DETAILS API ENDPOINTS =====

// Get work details list for a specific work
router.get('/getworkdetailslist', async (req, res) => {
    try {
        const { workId } = req.query;
        if (!workId) {
            return res.status(400).json({ error: "Missing required parameter: workId" });
        }

        const workDetailsList = await getWorkDetailsList(parseInt(workId));
        res.json(workDetailsList);
    } catch (error) {
        console.error("Error fetching work details list:", error);
        res.status(500).json({ error: "Failed to fetch work details list" });
    }
});

// Add new work detail
router.post('/addworkdetail', async (req, res) => {
    try {
        const workDetailData = req.body;
        
        // Validate required fields
        if (!workDetailData.WorkID) {
            return res.status(400).json({ 
                error: "Missing required field: WorkID" 
            });
        }

        // Validate data types
        if (isNaN(parseInt(workDetailData.WorkID))) {
            return res.status(400).json({
                error: "WorkID must be a valid number"
            });
        }

        // Validate CanalsNo if provided
        if (workDetailData.CanalsNo && isNaN(parseInt(workDetailData.CanalsNo))) {
            return res.status(400).json({
                error: "CanalsNo must be a valid number"
            });
        }

        const result = await addWorkDetail(workDetailData);
        res.json({ 
            success: true, 
            detailId: result.ID,
            message: "Work detail added successfully" 
        });
    } catch (error) {
        console.error("Error adding work detail:", error);
        res.status(500).json({ error: "Failed to add work detail", details: error.message });
    }
});

// Update existing work detail
router.put('/updateworkdetail', async (req, res) => {
    try {
        const { detailId, ...workDetailData } = req.body;
        
        if (!detailId) {
            return res.status(400).json({ error: "Missing required field: detailId" });
        }

        // Validate data types
        if (isNaN(parseInt(detailId))) {
            return res.status(400).json({
                error: "detailId must be a valid number"
            });
        }

        // Validate CanalsNo if provided
        if (workDetailData.CanalsNo && isNaN(parseInt(workDetailData.CanalsNo))) {
            return res.status(400).json({
                error: "CanalsNo must be a valid number"
            });
        }

        const result = await updateWorkDetail(parseInt(detailId), workDetailData);
        res.json({ 
            success: true, 
            message: "Work detail updated successfully",
            rowsAffected: result.rowCount
        });
    } catch (error) {
        console.error("Error updating work detail:", error);
        res.status(500).json({ error: "Failed to update work detail", details: error.message });
    }
});

// Delete work detail
router.delete('/deleteworkdetail', async (req, res) => {
    try {
        const { detailId } = req.body;
        
        if (!detailId) {
            return res.status(400).json({ error: "Missing required field: detailId" });
        }

        if (isNaN(parseInt(detailId))) {
            return res.status(400).json({ error: "detailId must be a valid number" });
        }

        const result = await deleteWorkDetail(parseInt(detailId));
        res.json({ 
            success: true, 
            message: "Work detail deleted successfully",
            rowsAffected: result.rowCount
        });
    } catch (error) {
        console.error("Error deleting work detail:", error);
        res.status(500).json({ error: "Failed to delete work detail", details: error.message });
    }
});

// Settings/Options routes
router.get("/options", async (req, res) => {
    try {
        const options = await getAllOptions();
        res.json({ status: 'success', options });
    } catch (error) {
        console.error("Error getting options:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

router.get("/options/:optionName", async (req, res) => {
    try {
        const { optionName } = req.params;
        const value = await getOption(optionName);
        
        if (value === null) {
            return res.status(404).json({ 
                status: 'error', 
                message: 'Option not found' 
            });
        }
        
        res.json({ status: 'success', optionName, value });
    } catch (error) {
        console.error("Error getting option:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

router.put("/options/:optionName", async (req, res) => {
    try {
        const { optionName } = req.params;
        const { value } = req.body;
        
        if (!value) {
            return res.status(400).json({ 
                status: 'error', 
                message: 'Value is required' 
            });
        }
        
        const updated = await updateOption(optionName, value);
        
        if (!updated) {
            return res.status(404).json({ 
                status: 'error', 
                message: 'Option not found or could not be updated' 
            });
        }
        
        res.json({ status: 'success', message: 'Option updated successfully' });
    } catch (error) {
        console.error("Error updating option:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

router.get("/options/pattern/:pattern", async (req, res) => {
    try {
        const { pattern } = req.params;
        const options = await getOptionsByPattern(pattern);
        res.json({ status: 'success', options });
    } catch (error) {
        console.error("Error getting options by pattern:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

router.put("/options/bulk", async (req, res) => {
    try {
        const { options } = req.body;
        
        if (!options || !Array.isArray(options)) {
            return res.status(400).json({ 
                status: 'error', 
                message: 'Options array is required' 
            });
        }
        
        const result = await bulkUpdateOptions(options);
        res.json({ 
            status: 'success', 
            message: 'Bulk update completed',
            updated: result.updated,
            failed: result.failed
        });
    } catch (error) {
        console.error("Error bulk updating options:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// ===== DATABASE CONFIGURATION ENDPOINTS =====

const dbConfigService = new DatabaseConfigService();

/**
 * Get current database configuration
 */
router.get('/config/database', async (req, res) => {
    try {
        const result = await dbConfigService.getCurrentConfig(false); // Mask sensitive data
        
        if (result.success) {
            res.json({
                success: true,
                config: result.config,
                timestamp: result.timestamp
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to get database configuration',
                error: result.error
            });
        }
    } catch (error) {
        console.error('Error getting database configuration:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

/**
 * Test database connection with provided configuration
 */
router.post('/config/database/test', async (req, res) => {
    try {
        const testConfig = req.body;
        
        if (!testConfig || typeof testConfig !== 'object') {
            return res.status(400).json({
                success: false,
                message: 'Invalid configuration provided'
            });
        }
        
        console.log('Testing database connection...');
        const result = await dbConfigService.testConnection(testConfig);
        
        // Return appropriate status code based on test result
        const statusCode = result.success ? 200 : 400;
        res.status(statusCode).json(result);
        
    } catch (error) {
        console.error('Error testing database connection:', error);
        res.status(500).json({
            success: false,
            message: 'Connection test failed',
            error: error.message
        });
    }
});

/**
 * Update database configuration
 */
router.put('/config/database', async (req, res) => {
    try {
        const newConfig = req.body;
        
        if (!newConfig || typeof newConfig !== 'object') {
            return res.status(400).json({
                success: false,
                message: 'Invalid configuration provided'
            });
        }
        
        console.log('Updating database configuration...');
        const result = await dbConfigService.updateConfiguration(newConfig);
        
        if (result.success) {
            // Mask password in response
            if (result.config && result.config.DB_PASSWORD) {
                result.config.DB_PASSWORD = '••••••••';
            }
            
            res.json(result);
        } else {
            res.status(400).json(result);
        }
        
    } catch (error) {
        console.error('Error updating database configuration:', error);
        res.status(500).json({
            success: false,
            message: 'Configuration update failed',
            error: error.message
        });
    }
});

/**
 * Get database configuration status and diagnostics
 */
router.get('/config/database/status', async (req, res) => {
    try {
        const result = await dbConfigService.getConfigurationStatus();
        res.json(result);
    } catch (error) {
        console.error('Error getting configuration status:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get configuration status',
            error: error.message
        });
    }
});

/**
 * Create backup of current database configuration
 */
router.post('/config/database/backup', async (req, res) => {
    try {
        const result = await dbConfigService.createBackup();
        
        const statusCode = result.success ? 200 : 400;
        res.status(statusCode).json(result);
        
    } catch (error) {
        console.error('Error creating configuration backup:', error);
        res.status(500).json({
            success: false,
            message: 'Backup creation failed',
            error: error.message
        });
    }
});

/**
 * Restore database configuration from backup
 */
router.post('/config/database/restore', async (req, res) => {
    try {
        const result = await dbConfigService.restoreFromBackup();
        
        const statusCode = result.success ? 200 : 400;
        res.status(statusCode).json(result);
        
    } catch (error) {
        console.error('Error restoring configuration from backup:', error);
        res.status(500).json({
            success: false,
            message: 'Restore failed',
            error: error.message
        });
    }
});

/**
 * Export current database configuration (sanitized)
 */
router.get('/config/database/export', async (req, res) => {
    try {
        const result = await dbConfigService.exportConfiguration();
        
        if (result.success) {
            res.json(result);
        } else {
            res.status(500).json(result);
        }
        
    } catch (error) {
        console.error('Error exporting configuration:', error);
        res.status(500).json({
            success: false,
            message: 'Export failed',
            error: error.message
        });
    }
});

/**
 * Get database connection presets
 */
router.get('/config/database/presets', (req, res) => {
    try {
        const presets = dbConfigService.getConnectionPresets();
        res.json({
            success: true,
            presets: presets
        });
    } catch (error) {
        console.error('Error getting connection presets:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get presets',
            error: error.message
        });
    }
});

/**
 * Application restart endpoint (for database configuration changes)
 */
router.post('/system/restart', async (req, res) => {
    try {
        const { reason } = req.body;
        
        console.log(`Application restart requested. Reason: ${reason || 'Manual restart'}`);
        
        // Send response before restarting
        res.json({
            success: true,
            message: 'Application restart initiated',
            timestamp: new Date().toISOString()
        });
        
        // Give time for response to be sent
        setTimeout(() => {
            console.log('Restarting application...');
            process.exit(0); // This will trigger the process manager to restart
        }, 1000);
        
    } catch (error) {
        console.error('Error initiating restart:', error);
        res.status(500).json({
            success: false,
            message: 'Restart failed',
            error: error.message
        });
    }
});

export default router;