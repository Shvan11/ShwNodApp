/**
 * API routes
 */
import express from 'express';

import * as database from '../services/database/index.js';
import { getPresentAps, getAllTodayApps, getPresentTodayApps, updatePresent, undoAppointmentState } from '../services/database/queries/appointment-queries.js';
import {getTimePoints, getTimePointImgs } from '../services/database/queries/timepoint-queries.js';
import { getWhatsAppMessages } from '../services/database/queries/messaging-queries.js';
import { getPatientsPhones, getInfos, createPatient, getReferralSources, getPatientTypes, getAddresses, getGenders, getAllPatients, getPatientById, updatePatient, deletePatient } from '../services/database/queries/patient-queries.js';
import { getPayments, getActiveWorkForInvoice, getCurrentExchangeRate, addInvoice, updateExchangeRate, getPaymentHistoryByWorkId, getExchangeRateForDate, updateExchangeRateForDate } from '../services/database/queries/payment-queries.js';
import { getWires, getVisitsSummary, addVisit, updateVisit, deleteVisit, getVisitDetailsByID, getLatestWire, getVisitsByWorkId, getVisitById, addVisitByWorkId, updateVisitByWorkId, deleteVisitByWorkId } from '../services/database/queries/visit-queries.js';
import { getWorksByPatient, getWorkDetails, addWork, updateWork, finishWork, getActiveWork, getWorkTypes, getWorkKeywords, getWorkDetailsList, addWorkDetail, updateWorkDetail, deleteWorkDetail } from '../services/database/queries/work-queries.js';
import { getAllExpenses, getExpenseById, getExpenseCategories, getExpenseSubcategories, addExpense, updateExpense, deleteExpense, getExpenseSummary, getExpenseTotalsByCurrency } from '../services/database/queries/expense-queries.js';
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
import { uploadSinglePdf, handleUploadError } from '../middleware/upload.js';
import driveUploadService from '../services/google-drive/drive-upload.js';
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
import templateRouter from './template-api.js';

const router = express.Router();
const upload = multer();

// Mount template routes
router.use('/templates', templateRouter);





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

// Get payment history for a specific work
router.get("/getpaymenthistory", async (req, res) => {
    try {
        const { workId } = req.query;
        if (!workId) {
            return res.status(400).json({ error: 'workId is required' });
        }
        const payments = await getPaymentHistoryByWorkId(parseInt(workId));
        res.json(payments);
    } catch (error) {
        console.error('Error fetching payment history:', error);
        res.status(500).json({ error: 'Failed to fetch payment history' });
    }
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

// Get all visits for a specific work ID
router.get("/getvisitsbywork", async (req, res) => {
    try {
        const { workId } = req.query;
        if (!workId) {
            return res.status(400).json({ error: "Missing required parameter: workId" });
        }
        const visits = await getVisitsByWorkId(parseInt(workId));
        res.json(visits);
    } catch (error) {
        console.error("Error fetching visits by work:", error);
        res.status(500).json({ error: "Failed to fetch visits" });
    }
});

// Get a single visit by ID
router.get("/getvisitbyid", async (req, res) => {
    try {
        const { visitId } = req.query;
        if (!visitId) {
            return res.status(400).json({ error: "Missing required parameter: visitId" });
        }
        const visit = await getVisitById(parseInt(visitId));
        if (!visit) {
            return res.status(404).json({ error: "Visit not found" });
        }
        res.json(visit);
    } catch (error) {
        console.error("Error fetching visit by ID:", error);
        res.status(500).json({ error: "Failed to fetch visit" });
    }
});

// Add a new visit for a specific work
router.post("/addvisitbywork", async (req, res) => {
    try {
        const visitData = req.body;
        if (!visitData.WorkID || !visitData.VisitDate) {
            return res.status(400).json({ error: "Missing required fields: WorkID and VisitDate" });
        }
        const result = await addVisitByWorkId(visitData);
        res.json({ success: true, visitId: result.ID });
    } catch (error) {
        console.error("Error adding visit:", error);
        res.status(500).json({ error: "Failed to add visit" });
    }
});

// Update a visit
router.put("/updatevisitbywork", async (req, res) => {
    try {
        const { visitId, ...visitData } = req.body;
        if (!visitId || !visitData.VisitDate) {
            return res.status(400).json({ error: "Missing required fields: visitId and VisitDate" });
        }
        await updateVisitByWorkId(parseInt(visitId), visitData);
        res.json({ success: true });
    } catch (error) {
        console.error("Error updating visit:", error);
        res.status(500).json({ error: "Failed to update visit" });
    }
});

// Delete a visit
router.delete("/deletevisitbywork", async (req, res) => {
    try {
        const { visitId } = req.body;
        if (!visitId) {
            return res.status(400).json({ error: "Missing required field: visitId" });
        }
        await deleteVisitByWorkId(parseInt(visitId));
        res.json({ success: true });
    } catch (error) {
        console.error("Error deleting visit:", error);
        res.status(500).json({ error: "Failed to delete visit" });
    }
});

// Get all operators (employees who can perform visits)
router.get("/operators", async (req, res) => {
    try {
        const query = `
            SELECT e.ID, e.employeeName
            FROM tblEmployees e
            ORDER BY e.employeeName
        `;
        const operators = await database.executeQuery(
            query,
            [],
            (columns) => ({
                ID: columns[0].value,
                employeeName: columns[1].value
            })
        );
        res.json(operators);
    } catch (error) {
        console.error('Error fetching operators:', error);
        res.status(500).json({ error: 'Failed to fetch operators' });
    }
});

// Get work details (for visit page header)
router.get("/getworkdetails", async (req, res) => {
    try {
        const { workId } = req.query;
        if (!workId) {
            return res.status(400).json({ error: "Missing required parameter: workId" });
        }
        const work = await getWorkDetails(parseInt(workId));
        if (!work) {
            return res.status(404).json({ error: "Work not found" });
        }
        res.json(work);
    } catch (error) {
        console.error('Error fetching work details:', error);
        res.status(500).json({ error: 'Failed to fetch work details' });
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

// Undo appointment state by setting field to NULL (uses dedicated UndoAppointmentState procedure)
router.post("/undoAppointmentState", async (req, res) => {
    try {
        const { appointmentID, state } = req.body;
        if (!appointmentID || !state) {
            return res.status(400).json({ error: "Missing required parameters: appointmentID, state" });
        }

        // Use dedicated undo procedure that doesn't affect other applications
        console.log(`Undoing appointment ${appointmentID} state: ${state}`);
        const result = await undoAppointmentState(appointmentID, state);

        wsEmitter.emit(WebSocketEvents.DATA_UPDATED, new Date().toISOString().split('T')[0]);

        res.json(result);
    } catch (error) {
        console.error("Error undoing appointment state:", error);
        res.status(500).json({ error: "Failed to undo appointment state" });
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
        const { workid, amountPaid, paymentDate, usdReceived, iqdReceived, change } = req.body;

        if (!workid || !amountPaid || !paymentDate) {
            return res.status(400).json({
                status: 'error',
                message: 'Missing required parameters: workid, amountPaid, paymentDate'
            });
        }

        // Validate that at least one currency amount is provided
        const usd = parseInt(usdReceived) || 0;
        const iqd = parseInt(iqdReceived) || 0;

        if (usd === 0 && iqd === 0) {
            return res.status(400).json({
                status: 'error',
                message: 'At least one currency amount (USD or IQD) must be provided'
            });
        }

        const result = await addInvoice({
            workid,
            amountPaid,
            paymentDate,
            usdReceived: usd,
            iqdReceived: iqd,
            change: parseInt(change) || 0
        });

        res.json({ status: 'success', data: result });
    } catch (error) {
        console.error("Error adding invoice:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

router.delete("/deleteInvoice/:invoiceId", async (req, res) => {
    try {
        const { invoiceId } = req.params;

        if (!invoiceId) {
            return res.status(400).json({
                status: 'error',
                message: 'Invoice ID is required'
            });
        }

        const result = await database.executeQuery(
            'DELETE FROM dbo.tblInvoice WHERE InvoiceID = @InvoiceID',
            [['InvoiceID', database.TYPES.Int, parseInt(invoiceId)]]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'Invoice not found'
            });
        }

        res.json({
            status: 'success',
            message: 'Invoice deleted successfully',
            rowsAffected: result.rowCount
        });
    } catch (error) {
        console.error("Error deleting invoice:", error);
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

// Get exchange rate for a specific date
router.get("/getExchangeRateForDate", async (req, res) => {
    try {
        const { date } = req.query;

        if (!date) {
            return res.status(400).json({
                status: 'error',
                message: 'Date parameter is required'
            });
        }

        const exchangeRate = await getExchangeRateForDate(date);

        if (exchangeRate === null || exchangeRate === undefined) {
            return res.status(404).json({
                status: 'error',
                message: `No exchange rate set for ${date}`,
                date: date
            });
        }

        res.json({ status: 'success', exchangeRate, date });
    } catch (error) {
        console.error("Error getting exchange rate for date:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// Update exchange rate for a specific date
router.post("/updateExchangeRateForDate", async (req, res) => {
    try {
        const { date, exchangeRate } = req.body;

        if (!date || !exchangeRate || exchangeRate <= 0) {
            return res.status(400).json({
                status: 'error',
                message: 'Valid date and exchange rate are required'
            });
        }

        const result = await updateExchangeRateForDate(date, exchangeRate);
        res.json({ status: 'success', data: result, date, exchangeRate });
    } catch (error) {
        console.error("Error updating exchange rate for date:", error);
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
        // Use CAST to convert string to datetime2 on SQL Server side to avoid timezone conversion
        const insertQuery = `
            INSERT INTO tblappointments (
                PersonID,
                AppDate,
                AppDetail,
                DrID,
                LastUpdated
            ) VALUES (@personID, CAST(@appDate AS datetime2), @appDetail, @drID, GETDATE())
        `;

        const result = await database.executeQuery(insertQuery, [
            ['personID', database.TYPES.Int, parseInt(PersonID)],
            ['appDate', database.TYPES.NVarChar, AppDate], // Pass as string, SQL Server will cast
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

// Get all appointments for a specific patient
router.get("/patient-appointments/:patientId", async (req, res) => {
    try {
        const { patientId } = req.params;

        if (!patientId || isNaN(parseInt(patientId))) {
            return res.status(400).json({
                success: false,
                error: 'Invalid patient ID'
            });
        }

        const query = `
            SELECT
                a.appointmentID,
                a.PersonID,
                FORMAT(a.AppDate, 'yyyy-MM-ddTHH:mm:ss') as AppDate,
                a.AppDetail,
                a.DrID,
                e.employeeName as DrName
            FROM tblappointments a
            LEFT JOIN tblEmployees e ON a.DrID = e.ID
            WHERE a.PersonID = @personID
            ORDER BY a.AppDate DESC
        `;

        const appointments = await database.executeQuery(
            query,
            [['personID', database.TYPES.Int, parseInt(patientId)]],
            (columns) => ({
                appointmentID: columns[0].value,
                PersonID: columns[1].value,
                AppDate: columns[2].value, // Already formatted as string without timezone
                AppDetail: columns[3].value,
                DrID: columns[4].value,
                DrName: columns[5].value
            })
        );

        res.json({
            success: true,
            appointments: appointments || []
        });

    } catch (error) {
        console.error('Error fetching patient appointments:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch appointments',
            details: error.message
        });
    }
});

// Get single appointment by ID
router.get("/appointments/:appointmentId", async (req, res) => {
    try {
        const { appointmentId } = req.params;

        if (!appointmentId || isNaN(parseInt(appointmentId))) {
            return res.status(400).json({
                success: false,
                error: 'Invalid appointment ID'
            });
        }

        const query = `
            SELECT
                a.appointmentID,
                a.PersonID,
                FORMAT(a.AppDate, 'yyyy-MM-ddTHH:mm:ss') as AppDate,
                a.AppDetail,
                a.DrID,
                e.employeeName as DrName
            FROM tblappointments a
            LEFT JOIN tblemployees e ON a.DrID = e.ID
            WHERE a.appointmentID = @appointmentId
        `;

        const result = await database.executeQuery(query, [
            ['appointmentId', database.TYPES.Int, parseInt(appointmentId)]
        ]);

        if (!result || result.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Appointment not found'
            });
        }

        res.json({
            success: true,
            appointment: result[0]
        });

    } catch (error) {
        console.error('Error fetching appointment:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch appointment',
            details: error.message
        });
    }
});

// Update appointment
router.put("/appointments/:appointmentId", async (req, res) => {
    try {
        const { appointmentId } = req.params;
        const { PersonID, AppDate, AppDetail, DrID } = req.body;

        if (!appointmentId || isNaN(parseInt(appointmentId))) {
            return res.status(400).json({
                success: false,
                error: 'Invalid appointment ID'
            });
        }

        // Validate required fields
        if (!PersonID || !AppDate || !AppDetail || !DrID) {
            return res.status(400).json({
                success: false,
                error: 'PersonID, AppDate, AppDetail, and DrID are required'
            });
        }

        // Use CAST to convert string to datetime2 on SQL Server side to avoid timezone conversion
        const query = `
            UPDATE tblappointments
            SET PersonID = @PersonID,
                AppDate = CAST(@AppDate AS datetime2),
                AppDetail = @AppDetail,
                DrID = @DrID
            WHERE appointmentID = @appointmentId
        `;

        await database.executeQuery(query, [
            ['appointmentId', database.TYPES.Int, parseInt(appointmentId)],
            ['PersonID', database.TYPES.Int, parseInt(PersonID)],
            ['AppDate', database.TYPES.NVarChar, AppDate], // Pass as string, SQL Server will cast
            ['AppDetail', database.TYPES.NVarChar, AppDetail],
            ['DrID', database.TYPES.Int, parseInt(DrID)]
        ]);

        res.json({
            success: true,
            message: 'Appointment updated successfully'
        });

    } catch (error) {
        console.error('Error updating appointment:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update appointment',
            details: error.message
        });
    }
});

// Delete appointment
router.delete("/appointments/:appointmentId", async (req, res) => {
    try {
        const { appointmentId } = req.params;

        if (!appointmentId || isNaN(parseInt(appointmentId))) {
            return res.status(400).json({
                success: false,
                error: 'Invalid appointment ID'
            });
        }

        const query = `DELETE FROM tblappointments WHERE appointmentID = @appointmentId`;

        await database.executeQuery(query, [
            ['appointmentId', database.TYPES.Int, parseInt(appointmentId)]
        ]);

        res.json({
            success: true,
            message: 'Appointment deleted successfully'
        });

    } catch (error) {
        console.error('Error deleting appointment:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete appointment',
            details: error.message
        });
    }
});

// Quick check-in: Add patient to today's appointments and mark as present
router.post("/appointments/quick-checkin", async (req, res) => {
    try {
        const { PersonID, AppDetail, DrID } = req.body;

        // Validate required fields
        if (!PersonID) {
            return res.status(400).json({
                success: false,
                error: 'PersonID is required'
            });
        }

        // Validate PersonID is a number
        if (isNaN(parseInt(PersonID))) {
            return res.status(400).json({
                success: false,
                error: 'PersonID must be a valid number'
            });
        }

        // Set defaults for optional fields
        const detail = AppDetail || 'Walk-in';
        const doctorId = DrID ? parseInt(DrID) : null;

        // Get today's date at current time for the appointment
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');

        // Format as string to avoid timezone conversion
        const todayDateTime = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
        const todayDateOnly = `${year}-${month}-${day}`;

        // Get current time for Present field - tedious TYPES.Time expects a Date object
        const currentTime = new Date();

        // Check if patient already has an appointment today
        const existingAppointment = await database.executeQuery(`
            SELECT appointmentID, Present, Seated, Dismissed
            FROM tblappointments
            WHERE PersonID = @personID
              AND CAST(AppDate AS DATE) = @today
        `, [
            ['personID', database.TYPES.Int, parseInt(PersonID)],
            ['today', database.TYPES.NVarChar, todayDateOnly]
        ]);

        // If appointment exists, just update the Present time if not already set
        if (existingAppointment && existingAppointment.length > 0) {
            const apt = existingAppointment[0];

            if (apt.Present) {
                return res.json({
                    success: true,
                    alreadyCheckedIn: true,
                    appointmentID: apt.appointmentID,
                    message: 'Patient already checked in today',
                    presentTime: apt.Present,
                    appointment: {
                        appointmentID: apt.appointmentID,
                        PersonID: parseInt(PersonID),
                        AppDate: todayDateTime,
                        Present: apt.Present
                    }
                });
            } else {
                // Update existing appointment with check-in time
                await database.executeQuery(`
                    UPDATE tblappointments
                    SET Present = @presentTime,
                        LastUpdated = GETDATE()
                    WHERE appointmentID = @appointmentID
                `, [
                    ['presentTime', database.TYPES.Time, currentTime],
                    ['appointmentID', database.TYPES.Int, apt.appointmentID]
                ]);

                console.log(`Patient ${PersonID} checked in to existing appointment ${apt.appointmentID} at ${currentTime}`);

                // Emit WebSocket event for real-time updates
                if (wsEmitter) {
                    wsEmitter.emit('appointments_updated', todayDateOnly);
                }

                return res.json({
                    success: true,
                    checkedIn: true,
                    appointmentID: apt.appointmentID,
                    message: 'Patient checked in successfully',
                    appointment: {
                        appointmentID: apt.appointmentID,
                        PersonID: parseInt(PersonID),
                        AppDate: todayDateTime,
                        Present: currentTime
                    }
                });
            }
        }

        // If doctor ID provided, verify it's valid
        if (doctorId) {
            const doctorCheck = await database.executeQuery(`
                SELECT e.ID, e.employeeName, p.PositionName
                FROM tblEmployees e
                INNER JOIN tblPositions p ON e.Position = p.ID
                WHERE e.ID = @drID AND p.PositionName = 'Doctor'
            `, [['drID', database.TYPES.Int, doctorId]]);

            if (!doctorCheck || doctorCheck.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid doctor ID or employee is not a doctor'
                });
            }
        }

        // Create new appointment with Present time already set
        // Note: Can't use OUTPUT clause due to triggers, use SCOPE_IDENTITY() instead
        const insertQuery = `
            INSERT INTO tblappointments (
                PersonID,
                AppDate,
                AppDetail,
                DrID,
                Present,
                LastUpdated
            )
            VALUES (
                @personID,
                CAST(@appDate AS datetime2),
                @appDetail,
                @drID,
                @presentTime,
                GETDATE()
            );
            SELECT SCOPE_IDENTITY() AS appointmentID;
        `;

        const result = await database.executeQuery(insertQuery, [
            ['personID', database.TYPES.Int, parseInt(PersonID)],
            ['appDate', database.TYPES.NVarChar, todayDateTime],
            ['appDetail', database.TYPES.NVarChar, detail],
            ['drID', database.TYPES.Int, doctorId || null],
            ['presentTime', database.TYPES.Time, currentTime]
        ], (columns) => ({
            appointmentID: columns[0].value
        }));

        const newAppointmentId = result?.[0]?.appointmentID;

        console.log(`Quick check-in: Created appointment ${newAppointmentId} for patient ${PersonID} and marked present at ${currentTime}`);

        // Emit WebSocket event for real-time updates
        if (wsEmitter) {
            wsEmitter.emit('appointments_updated', todayDateOnly);
        }

        res.json({
            success: true,
            created: true,
            checkedIn: true,
            appointmentID: newAppointmentId,
            message: 'Appointment created and patient checked in successfully',
            appointment: {
                appointmentID: newAppointmentId,
                PersonID: parseInt(PersonID),
                AppDate: todayDateTime,
                AppDetail: detail,
                DrID: doctorId,
                Present: currentTime
            }
        });

    } catch (error) {
        console.error('Error in quick check-in:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to check in patient',
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

// ⚠️ DISABLED: Photo server routes - photo-server.js file is missing
// These routes were referencing middlewares/photo-server.js which doesn't exist
// TODO: Either implement photo-server.js or remove these routes entirely
/*
router.get('/photo-server/status', async (req, res) => {
    try {
        const { default: photoServer } = await import('../middleware/photo-server.js');
        const { default: photoPathDetector } = await import('../services/imaging/path-detector.js');

        const status = photoServer.getStatus();
        const allPaths = photoPathDetector.getAllDetectedPaths();

        res.json({
            status,
            detectedPaths: allPaths,
            isDetectionFresh: photoPathDetector.isDetectionFresh()
        });
    } catch (error) {
        console.error('Error getting photo server status:', error);
        res.status(500).json({
            error: error.message || "Failed to get photo server status"
        });
    }
});

router.post('/photo-server/re-detect', async (req, res) => {
    try {
        const { default: photoServer } = await import('../middleware/photo-server.js');

        console.log('🔍 Manual photo path re-detection requested');
        await photoServer.initialize();

        const status = photoServer.getStatus();
        res.json({
            success: true,
            message: 'Photo paths re-detected successfully',
            status
        });
    } catch (error) {
        console.error('Error re-detecting photo paths:', error);
        res.status(500).json({
            error: error.message || "Failed to re-detect photo paths"
        });
    }
});
*/

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

// Search patients
router.get('/patients/search', async (req, res) => {
    try {
        const searchQuery = req.query.q || '';
        const patientName = req.query.patientName || '';
        const firstName = req.query.firstName || '';
        const lastName = req.query.lastName || '';

        // Build WHERE clause for search
        let whereConditions = [];
        const parameters = [];

        // Search by individual name fields
        if (patientName.trim()) {
            whereConditions.push('p.PatientName LIKE @patientName');
            parameters.push(['patientName', database.TYPES.NVarChar, `%${patientName.trim()}%`]);
        }

        if (firstName.trim()) {
            whereConditions.push('p.FirstName LIKE @firstName');
            parameters.push(['firstName', database.TYPES.NVarChar, `%${firstName.trim()}%`]);
        }

        if (lastName.trim()) {
            whereConditions.push('p.LastName LIKE @lastName');
            parameters.push(['lastName', database.TYPES.NVarChar, `%${lastName.trim()}%`]);
        }

        // General search (phone or ID)
        if (searchQuery.trim()) {
            whereConditions.push('(p.Phone LIKE @search OR p.Phone2 LIKE @search OR p.patientID LIKE @search)');
            parameters.push(['search', database.TYPES.NVarChar, `%${searchQuery.trim()}%`]);
        }

        const whereClause = whereConditions.length > 0
            ? 'WHERE ' + whereConditions.join(' AND ')
            : '';

        const query = `
            SELECT TOP 100 p.PersonID, p.patientID, p.PatientName, p.FirstName, p.LastName,
                    p.Phone, p.Phone2, p.Email, p.DateofBirth, p.Gender,
                    p.AddressID, p.ReferralSourceID, p.PatientTypeID,
                    p.Notes, p.Alerts, p.Language, p.CountryCode,
                    g.Gender as GenderName, a.Zone as AddressName,
                    r.Referral as ReferralSource, pt.PatientType as PatientTypeName
            FROM dbo.tblpatients p
            LEFT JOIN dbo.tblGender g ON p.Gender = g.Gender_ID
            LEFT JOIN dbo.tblAddress a ON p.AddressID = a.ID
            LEFT JOIN dbo.tblReferrals r ON p.ReferralSourceID = r.ID
            LEFT JOIN dbo.tblPatientType pt ON p.PatientTypeID = pt.ID
            ${whereClause}
            ORDER BY p.PatientName
        `;

        const patients = await database.executeQuery(
            query,
            parameters,
            (columns) => ({
                PersonID: columns[0].value,
                patientID: columns[1].value,
                PatientName: columns[2].value,
                FirstName: columns[3].value,
                LastName: columns[4].value,
                Phone: columns[5].value,
                Phone2: columns[6].value,
                Email: columns[7].value,
                DateofBirth: columns[8].value,
                Gender: columns[9].value,
                AddressID: columns[10].value,
                ReferralSourceID: columns[11].value,
                PatientTypeID: columns[12].value,
                Notes: columns[13].value,
                Alerts: columns[14].value,
                Language: columns[15].value,
                CountryCode: columns[16].value,
                GenderName: columns[17].value,
                AddressName: columns[18].value,
                ReferralSource: columns[19].value,
                PatientTypeName: columns[20].value
            })
        );

        res.json(patients);
    } catch (error) {
        console.error('Error searching patients:', error);
        res.status(500).json({
            error: error.message || "Failed to search patients"
        });
    }
});

// Update patient
router.put('/patients/:personId', async (req, res) => {
    try {
        const personId = parseInt(req.params.personId);
        const patientData = req.body;

        // Basic validation
        if (!patientData.PatientName || !patientData.PatientName.trim()) {
            return res.status(400).json({
                error: "Patient name is required"
            });
        }

        const result = await updatePatient(personId, patientData);
        res.json({ success: true, message: 'Patient updated successfully' });
    } catch (error) {
        console.error('Error updating patient:', error);
        res.status(500).json({
            error: error.message || "Failed to update patient"
        });
    }
});

// Delete patient
router.delete('/patients/:personId', async (req, res) => {
    try {
        const personId = parseInt(req.params.personId);
        const result = await deletePatient(personId);
        res.json({ success: true, message: 'Patient deleted successfully' });
    } catch (error) {
        console.error('Error deleting patient:', error);
        res.status(500).json({
            error: error.message || "Failed to delete patient"
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

// Get single work by ID
router.get('/getwork/:workId', async (req, res) => {
    try {
        const { workId } = req.params;
        if (!workId) {
            return res.status(400).json({ error: "Missing required parameter: workId" });
        }

        const query = `
            SELECT
                w.workid,
                w.PersonID,
                w.TotalRequired,
                w.Currency,
                w.Typeofwork,
                w.Notes,
                w.Finished,
                w.DrID,
                e.employeeName as DoctorName,
                wt.WorkType as TypeName
            FROM tblwork w
            LEFT JOIN tblEmployees e ON w.DrID = e.ID
            LEFT JOIN tblWorkType wt ON w.Typeofwork = wt.ID
            WHERE w.workid = @WorkID
        `;

        const work = await database.executeQuery(
            query,
            [['WorkID', database.TYPES.Int, parseInt(workId)]],
            (columns) => ({
                workid: columns[0].value,
                PersonID: columns[1].value,
                TotalRequired: columns[2].value,
                Currency: columns[3].value,
                Typeofwork: columns[4].value,
                Notes: columns[5].value,
                Finished: columns[6].value,
                DrID: columns[7].value,
                DoctorName: columns[8].value,
                TypeName: columns[9].value
            }),
            (results) => results.length > 0 ? results[0] : null
        );

        if (!work) {
            return res.status(404).json({ success: false, error: "Work not found" });
        }

        res.json({ success: true, work });
    } catch (error) {
        console.error("Error fetching work:", error);
        res.status(500).json({ success: false, error: "Failed to fetch work" });
    }
});

// Get single patient by ID (for aligner workflow)
router.get('/getpatient/:personId', async (req, res) => {
    try {
        const { personId } = req.params;
        if (!personId) {
            return res.status(400).json({ error: "Missing required parameter: personId" });
        }

        const patient = await getPatientById(parseInt(personId));

        if (!patient) {
            return res.status(404).json({ error: "Patient not found" });
        }

        res.json(patient);
    } catch (error) {
        console.error("Error fetching patient:", error);
        res.status(500).json({ error: "Failed to fetch patient" });
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

        // Validate and ensure TotalRequired is a valid number (required field)
        if (workData.TotalRequired === '' || workData.TotalRequired === null || workData.TotalRequired === undefined) {
            return res.status(400).json({
                error: "TotalRequired is required and must be a valid number"
            });
        }

        // Validate Typeofwork is required
        if (!workData.Typeofwork) {
            return res.status(400).json({
                error: "Typeofwork is required"
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

// ===== ALIGNER MANAGEMENT API ENDPOINTS =====

/**
 * Get list of aligner doctors
 */
router.get('/aligner/doctors', async (req, res) => {
    try {
        console.log('Fetching aligner doctors');

        const query = `
            SELECT DISTINCT
                ad.DrID,
                ad.DoctorName,
                (SELECT COUNT(*)
                 FROM tblAlignerNotes n
                 INNER JOIN tblAlignerSets s ON n.AlignerSetID = s.AlignerSetID
                 WHERE s.AlignerDrID = ad.DrID
                   AND n.NoteType = 'Doctor'
                   AND n.IsRead = 0
                ) AS UnreadDoctorNotes
            FROM AlignerDoctors ad
            ORDER BY ad.DoctorName
        `;

        const doctors = await database.executeQuery(
            query,
            [],
            (columns) => ({
                DrID: columns[0].value,
                DoctorName: columns[1].value,
                UnreadDoctorNotes: columns[2].value || 0
            })
        );

        res.json({
            success: true,
            doctors: doctors || [],
            count: doctors ? doctors.length : 0
        });

    } catch (error) {
        console.error('Error fetching aligner doctors:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch aligner doctors',
            message: error.message
        });
    }
});

/**
 * Get all patients from v_allsets view
 * Shows all aligner sets with visual indicators for those without next batch
 */
router.get('/aligner/all-sets', async (req, res) => {
    try {
        console.log('Fetching all aligner sets from v_allsets');

        const query = `
            SELECT
                v.PersonID,
                v.PatientName,
                v.WorkID,
                v.AlignerDrID,
                v.AlignerSetID,
                v.SetSequence,
                v.BatchSequence,
                v.CreationDate,
                v.ManufactureDate,
                v.DeliveredToPatientDate,
                v.NextBatchReadyDate,
                v.Notes,
                v.NextBatchPresent,
                ad.DoctorName,
                p.patientID,
                p.Phone
            FROM dbo.v_allsets v
            INNER JOIN AlignerDoctors ad ON v.AlignerDrID = ad.DrID
            LEFT JOIN tblpatients p ON v.PersonID = p.PersonID
            ORDER BY
                CASE WHEN v.NextBatchPresent = 'False' THEN 0 ELSE 1 END,
                v.NextBatchReadyDate ASC,
                v.PatientName
        `;

        const sets = await database.executeQuery(
            query,
            [],
            (columns) => ({
                PersonID: columns[0].value,
                PatientName: columns[1].value,
                WorkID: columns[2].value,
                AlignerDrID: columns[3].value,
                AlignerSetID: columns[4].value,
                SetSequence: columns[5].value,
                BatchSequence: columns[6].value,
                CreationDate: columns[7].value,
                ManufactureDate: columns[8].value,
                DeliveredToPatientDate: columns[9].value,
                NextBatchReadyDate: columns[10].value,
                Notes: columns[11].value,
                NextBatchPresent: columns[12].value,
                DoctorName: columns[13].value,
                patientID: columns[14].value,
                Phone: columns[15].value
            })
        );

        res.json({
            success: true,
            sets: sets || [],
            count: sets ? sets.length : 0,
            noNextBatchCount: sets ? sets.filter(s => s.NextBatchPresent === 'False').length : 0
        });

    } catch (error) {
        console.error('Error fetching all aligner sets:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch aligner sets',
            message: error.message
        });
    }
});

/**
 * Get all aligner patients (all doctors)
 * Returns all patients with aligner sets
 */
router.get('/aligner/patients/all', async (req, res) => {
    try {
        console.log('Fetching all aligner patients');

        const query = `
            SELECT DISTINCT
                p.PersonID,
                p.FirstName,
                p.LastName,
                p.PatientName,
                p.Phone,
                p.patientID,
                w.workid,
                wt.WorkType,
                w.Typeofwork as WorkTypeID,
                COUNT(DISTINCT s.AlignerSetID) as TotalSets,
                SUM(CASE WHEN s.IsActive = 1 THEN 1 ELSE 0 END) as ActiveSets
            FROM tblpatients p
            INNER JOIN tblwork w ON p.PersonID = w.PersonID
            INNER JOIN tblWorkType wt ON w.Typeofwork = wt.ID
            INNER JOIN tblAlignerSets s ON w.workid = s.WorkID
            WHERE wt.ID IN (19, 20, 21)
            GROUP BY
                p.PersonID, p.FirstName, p.LastName, p.PatientName,
                p.Phone, p.patientID, w.workid, wt.WorkType, w.Typeofwork
            ORDER BY p.PatientName, p.FirstName, p.LastName
        `;

        const patients = await database.executeQuery(
            query,
            [],
            (columns) => ({
                PersonID: columns[0].value,
                FirstName: columns[1].value,
                LastName: columns[2].value,
                PatientName: columns[3].value,
                Phone: columns[4].value,
                patientID: columns[5].value,
                workid: columns[6].value,
                WorkType: columns[7].value,
                WorkTypeID: columns[8].value,
                TotalSets: columns[9].value,
                ActiveSets: columns[10].value
            })
        );

        res.json({
            success: true,
            patients: patients || [],
            count: patients ? patients.length : 0
        });

    } catch (error) {
        console.error('Error fetching all aligner patients:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch all aligner patients',
            message: error.message
        });
    }
});

/**
 * Get all patients by doctor ID
 * Returns all patients with aligner sets assigned to a specific doctor
 */
router.get('/aligner/patients/by-doctor/:doctorId', async (req, res) => {
    try {
        const { doctorId } = req.params;

        if (!doctorId || isNaN(parseInt(doctorId))) {
            return res.status(400).json({
                success: false,
                error: 'Valid doctorId is required'
            });
        }

        console.log(`Fetching all patients for doctor ID: ${doctorId}`);

        const query = `
            SELECT DISTINCT
                p.PersonID,
                p.FirstName,
                p.LastName,
                p.PatientName,
                p.Phone,
                p.patientID,
                w.workid,
                wt.WorkType,
                w.Typeofwork as WorkTypeID,
                COUNT(DISTINCT s.AlignerSetID) as TotalSets,
                SUM(CASE WHEN s.IsActive = 1 THEN 1 ELSE 0 END) as ActiveSets,
                (SELECT COUNT(*)
                 FROM tblAlignerNotes n
                 INNER JOIN tblAlignerSets sets ON n.AlignerSetID = sets.AlignerSetID
                 WHERE sets.WorkID = w.workid
                   AND n.NoteType = 'Doctor'
                   AND n.IsRead = 0
                ) AS UnreadDoctorNotes
            FROM tblpatients p
            INNER JOIN tblwork w ON p.PersonID = w.PersonID
            INNER JOIN tblWorkType wt ON w.Typeofwork = wt.ID
            INNER JOIN tblAlignerSets s ON w.workid = s.WorkID
            WHERE wt.ID IN (19, 20, 21)
                AND s.AlignerDrID = @doctorId
            GROUP BY
                p.PersonID, p.FirstName, p.LastName, p.PatientName,
                p.Phone, p.patientID, w.workid, wt.WorkType, w.Typeofwork
            ORDER BY p.PatientName, p.FirstName, p.LastName
        `;

        const patients = await database.executeQuery(
            query,
            [['doctorId', database.TYPES.Int, parseInt(doctorId)]],
            (columns) => ({
                PersonID: columns[0].value,
                FirstName: columns[1].value,
                LastName: columns[2].value,
                PatientName: columns[3].value,
                Phone: columns[4].value,
                patientID: columns[5].value,
                workid: columns[6].value,
                WorkType: columns[7].value,
                WorkTypeID: columns[8].value,
                TotalSets: columns[9].value,
                ActiveSets: columns[10].value,
                UnreadDoctorNotes: columns[11].value || 0
            })
        );

        res.json({
            success: true,
            patients: patients || [],
            count: patients ? patients.length : 0
        });

    } catch (error) {
        console.error('Error fetching patients by doctor:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch patients by doctor',
            message: error.message
        });
    }
});

/**
 * Search for aligner patients
 * Returns patients who have aligner work types (19, 20, 21)
 * Optional doctor filter
 */
router.get('/aligner/patients', async (req, res) => {
    try {
        const { search, doctorId } = req.query;

        if (!search || search.trim().length < 2) {
            return res.status(400).json({
                success: false,
                error: 'Search term must be at least 2 characters'
            });
        }

        const searchTerm = search.trim();
        console.log(`Searching for aligner patients: ${searchTerm}${doctorId ? ` (Doctor ID: ${doctorId})` : ''}`);

        // Build query with optional doctor filter
        let query = `
            SELECT DISTINCT
                p.PersonID,
                p.FirstName,
                p.LastName,
                p.PatientName,
                p.Phone,
                p.patientID,
                w.workid,
                wt.WorkType,
                w.Typeofwork as WorkTypeID
            FROM tblpatients p
            INNER JOIN tblwork w ON p.PersonID = w.PersonID
            INNER JOIN tblWorkType wt ON w.Typeofwork = wt.ID
            INNER JOIN tblAlignerSets s ON w.workid = s.WorkID
            WHERE wt.ID IN (19, 20, 21)
                AND (
                    p.FirstName LIKE @search
                    OR p.LastName LIKE @search
                    OR p.PatientName LIKE @search
                    OR p.Phone LIKE @search
                    OR p.patientID LIKE @search
                    OR (p.FirstName + ' ' + p.LastName) LIKE @search
                )
        `;

        // Add doctor filter if provided
        const params = [['search', database.TYPES.NVarChar, `%${searchTerm}%`]];
        if (doctorId && !isNaN(parseInt(doctorId))) {
            query += ` AND s.AlignerDrID = @doctorId`;
            params.push(['doctorId', database.TYPES.Int, parseInt(doctorId)]);
        }

        query += ` ORDER BY p.FirstName, p.LastName`;

        const patients = await database.executeQuery(
            query,
            params,
            (columns) => ({
                PersonID: columns[0].value,
                FirstName: columns[1].value,
                LastName: columns[2].value,
                PatientName: columns[3].value,
                Phone: columns[4].value,
                patientID: columns[5].value,
                workid: columns[6].value,
                WorkType: columns[7].value,
                WorkTypeID: columns[8].value
            })
        );

        res.json({
            success: true,
            patients: patients || [],
            count: patients ? patients.length : 0
        });

    } catch (error) {
        console.error('Error searching aligner patients:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to search aligner patients',
            message: error.message
        });
    }
});

/**
 * Get aligner sets for a specific work
 */
router.get('/aligner/sets/:workId', async (req, res) => {
    try {
        const { workId } = req.params;

        if (!workId || isNaN(parseInt(workId))) {
            return res.status(400).json({
                success: false,
                error: 'Valid workId is required'
            });
        }

        console.log(`Fetching aligner sets for work ID: ${workId}`);

        // Query aligner sets with batch summary, payment info, and activity flags
        const query = `
            SELECT
                s.AlignerSetID,
                s.WorkID,
                s.SetSequence,
                s.Type,
                s.UpperAlignersCount,
                s.LowerAlignersCount,
                s.RemainingUpperAligners,
                s.RemainingLowerAligners,
                s.CreationDate,
                s.Days,
                s.IsActive,
                s.Notes,
                s.FolderPath,
                s.AlignerDrID,
                s.SetUrl,
                s.SetPdfUrl,
                s.SetCost,
                s.Currency,
                ad.DoctorName as AlignerDoctorName,
                COUNT(b.AlignerBatchID) as TotalBatches,
                SUM(CASE WHEN b.DeliveredToPatientDate IS NOT NULL THEN 1 ELSE 0 END) as DeliveredBatches,
                vp.TotalPaid,
                vp.Balance,
                vp.PaymentStatus,
                (SELECT COUNT(*)
                 FROM tblAlignerNotes n
                 WHERE n.AlignerSetID = s.AlignerSetID
                   AND n.NoteType = 'Doctor'
                   AND n.IsRead = 0
                ) AS UnreadActivityCount
            FROM tblAlignerSets s
            LEFT JOIN tblAlignerBatches b ON s.AlignerSetID = b.AlignerSetID
            LEFT JOIN AlignerDoctors ad ON s.AlignerDrID = ad.DrID
            LEFT JOIN vw_AlignerSetPayments vp ON s.AlignerSetID = vp.AlignerSetID
            WHERE s.WorkID = @workId
            GROUP BY
                s.AlignerSetID, s.WorkID, s.SetSequence, s.Type,
                s.UpperAlignersCount, s.LowerAlignersCount,
                s.RemainingUpperAligners, s.RemainingLowerAligners,
                s.CreationDate, s.Days, s.IsActive, s.Notes,
                s.FolderPath, s.AlignerDrID, s.SetUrl, s.SetPdfUrl,
                s.SetCost, s.Currency, ad.DoctorName,
                vp.TotalPaid, vp.Balance, vp.PaymentStatus
            ORDER BY s.SetSequence
        `;

        const sets = await database.executeQuery(
            query,
            [['workId', database.TYPES.Int, parseInt(workId)]],
            (columns) => ({
                AlignerSetID: columns[0].value,
                WorkID: columns[1].value,
                SetSequence: columns[2].value,
                Type: columns[3].value,
                UpperAlignersCount: columns[4].value,
                LowerAlignersCount: columns[5].value,
                RemainingUpperAligners: columns[6].value,
                RemainingLowerAligners: columns[7].value,
                CreationDate: columns[8].value,
                Days: columns[9].value,
                IsActive: columns[10].value,
                Notes: columns[11].value,
                FolderPath: columns[12].value,
                AlignerDrID: columns[13].value,
                SetUrl: columns[14].value,
                SetPdfUrl: columns[15].value,
                SetCost: columns[16].value,
                Currency: columns[17].value,
                AlignerDoctorName: columns[18].value,
                TotalBatches: columns[19].value,
                DeliveredBatches: columns[20].value,
                TotalPaid: columns[21].value,
                Balance: columns[22].value,
                PaymentStatus: columns[23].value,
                UnreadActivityCount: columns[24].value || 0
            })
        );

        // DEBUG: Log unread activity counts
        const setsWithUnread = (sets || []).filter(s => s.UnreadActivityCount > 0);
        if (setsWithUnread.length > 0) {
            console.log('🔔 [MAIN APP] Sets with unread doctor notes:', setsWithUnread.map(s => ({
                SetID: s.AlignerSetID,
                UnreadCount: s.UnreadActivityCount
            })));
        } else {
            console.log('📭 [MAIN APP] No sets with unread doctor notes for workId:', workId);
        }

        res.json({
            success: true,
            sets: sets || [],
            count: sets ? sets.length : 0
        });

    } catch (error) {
        console.error('Error fetching aligner sets:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch aligner sets',
            message: error.message
        });
    }
});

/**
 * Add payment for an aligner set
 */
router.post('/aligner/payments', async (req, res) => {
    try {
        const { workid, AlignerSetID, Amountpaid, Dateofpayment, ActualAmount, ActualCur, Change } = req.body;

        if (!workid || !Amountpaid || !Dateofpayment) {
            return res.status(400).json({
                success: false,
                error: 'workid, Amountpaid, and Dateofpayment are required'
            });
        }

        console.log(`Adding payment for work ID: ${workid}, Set ID: ${AlignerSetID || 'general'}, Amount: ${Amountpaid}`);

        // Insert payment into tblInvoice
        const query = `
            INSERT INTO tblInvoice (workid, Amountpaid, Dateofpayment, ActualAmount, ActualCur, Change, AlignerSetID)
            VALUES (@workid, @Amountpaid, @Dateofpayment, @ActualAmount, @ActualCur, @Change, @AlignerSetID);
            SELECT SCOPE_IDENTITY() AS invoiceID;
        `;

        const result = await database.executeQuery(
            query,
            [
                ['workid', database.TYPES.Int, parseInt(workid)],
                ['Amountpaid', database.TYPES.Decimal, parseFloat(Amountpaid)],
                ['Dateofpayment', database.TYPES.Date, new Date(Dateofpayment)],
                ['ActualAmount', database.TYPES.Decimal, ActualAmount ? parseFloat(ActualAmount) : null],
                ['ActualCur', database.TYPES.NVarChar, ActualCur || null],
                ['Change', database.TYPES.Decimal, Change ? parseFloat(Change) : null],
                ['AlignerSetID', database.TYPES.Int, AlignerSetID || null]
            ],
            (columns) => ({
                invoiceID: columns[0].value
            })
        );

        const invoiceID = result && result.length > 0 ? result[0].invoiceID : null;

        res.json({
            success: true,
            invoiceID: invoiceID,
            message: 'Payment added successfully'
        });

    } catch (error) {
        console.error('Error adding payment:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to add payment',
            message: error.message
        });
    }
});

/**
 * Get batches for a specific aligner set
 */
router.get('/aligner/batches/:setId', async (req, res) => {
    try {
        const { setId } = req.params;

        if (!setId || isNaN(parseInt(setId))) {
            return res.status(400).json({
                success: false,
                error: 'Valid setId is required'
            });
        }

        console.log(`Fetching batches for aligner set ID: ${setId}`);

        // Query batches for the set
        const query = `
            SELECT
                AlignerBatchID,
                AlignerSetID,
                BatchSequence,
                UpperAlignerCount,
                LowerAlignerCount,
                UpperAlignerStartSequence,
                UpperAlignerEndSequence,
                LowerAlignerStartSequence,
                LowerAlignerEndSequence,
                ManufactureDate,
                DeliveredToPatientDate,
                Days,
                ValidityPeriod,
                NextBatchReadyDate,
                Notes,
                IsActive
            FROM tblAlignerBatches
            WHERE AlignerSetID = @setId
            ORDER BY BatchSequence
        `;

        const batches = await database.executeQuery(
            query,
            [['setId', database.TYPES.Int, parseInt(setId)]],
            (columns) => ({
                AlignerBatchID: columns[0].value,
                AlignerSetID: columns[1].value,
                BatchSequence: columns[2].value,
                UpperAlignerCount: columns[3].value,
                LowerAlignerCount: columns[4].value,
                UpperAlignerStartSequence: columns[5].value,
                UpperAlignerEndSequence: columns[6].value,
                LowerAlignerStartSequence: columns[7].value,
                LowerAlignerEndSequence: columns[8].value,
                ManufactureDate: columns[9].value,
                DeliveredToPatientDate: columns[10].value,
                Days: columns[11].value,
                ValidityPeriod: columns[12].value,
                NextBatchReadyDate: columns[13].value,
                Notes: columns[14].value,
                IsActive: columns[15].value
            })
        );

        res.json({
            success: true,
            batches: batches || [],
            count: batches ? batches.length : 0
        });

    } catch (error) {
        console.error('Error fetching aligner batches:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch aligner batches',
            message: error.message
        });
    }
});

// ===== ALIGNER SETS CRUD OPERATIONS =====

/**
 * Create a new aligner set
 */
router.post('/aligner/sets', async (req, res) => {
    try {
        const {
            WorkID,
            SetSequence,
            Type,
            UpperAlignersCount,
            LowerAlignersCount,
            Days,
            AlignerDrID,
            SetUrl,
            SetPdfUrl,
            SetCost,
            Currency,
            Notes,
            IsActive
        } = req.body;

        // Validation
        if (!WorkID || !AlignerDrID) {
            return res.status(400).json({
                success: false,
                error: 'WorkID and AlignerDrID are required'
            });
        }

        console.log('Creating new aligner set:', req.body);

        const query = `
            DECLARE @OutputTable TABLE (AlignerSetID INT);

            -- If creating a new active set, deactivate all other sets for this work
            IF @IsActive = 1
            BEGIN
                UPDATE tblAlignerSets
                SET IsActive = 0
                WHERE WorkID = @WorkID AND IsActive = 1;
            END

            INSERT INTO tblAlignerSets (
                WorkID, SetSequence, Type, UpperAlignersCount, LowerAlignersCount,
                RemainingUpperAligners, RemainingLowerAligners, Days, AlignerDrID,
                SetUrl, SetPdfUrl, SetCost, Currency, Notes, IsActive, CreationDate
            )
            OUTPUT INSERTED.AlignerSetID INTO @OutputTable
            VALUES (
                @WorkID, @SetSequence, @Type, @UpperAlignersCount, @LowerAlignersCount,
                @UpperAlignersCount, @LowerAlignersCount, @Days, @AlignerDrID,
                @SetUrl, @SetPdfUrl, @SetCost, @Currency, @Notes, @IsActive, GETDATE()
            );

            SELECT AlignerSetID FROM @OutputTable;
        `;

        const result = await database.executeQuery(
            query,
            [
                ['WorkID', database.TYPES.Int, parseInt(WorkID)],
                ['SetSequence', database.TYPES.Int, SetSequence ? parseInt(SetSequence) : null],
                ['Type', database.TYPES.NVarChar, Type || null],
                ['UpperAlignersCount', database.TYPES.Int, UpperAlignersCount ? parseInt(UpperAlignersCount) : 0],
                ['LowerAlignersCount', database.TYPES.Int, LowerAlignersCount ? parseInt(LowerAlignersCount) : 0],
                ['Days', database.TYPES.Int, Days ? parseInt(Days) : null],
                ['AlignerDrID', database.TYPES.Int, parseInt(AlignerDrID)],
                ['SetUrl', database.TYPES.NVarChar, SetUrl || null],
                ['SetPdfUrl', database.TYPES.NVarChar, SetPdfUrl || null],
                ['SetCost', database.TYPES.Decimal, SetCost ? parseFloat(SetCost) : null],
                ['Currency', database.TYPES.NVarChar, Currency || null],
                ['Notes', database.TYPES.NVarChar, Notes || null],
                ['IsActive', database.TYPES.Bit, IsActive !== undefined ? IsActive : true]
            ],
            (columns) => columns[0].value
        );

        const newSetId = result && result.length > 0 ? result[0] : null;

        res.json({
            success: true,
            setId: newSetId,
            message: 'Aligner set created successfully'
        });

    } catch (error) {
        console.error('Error creating aligner set:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create aligner set',
            message: error.message
        });
    }
});

/**
 * Update an existing aligner set
 */
router.put('/aligner/sets/:setId', async (req, res) => {
    try {
        const { setId } = req.params;
        const {
            SetSequence,
            Type,
            UpperAlignersCount,
            LowerAlignersCount,
            Days,
            AlignerDrID,
            SetUrl,
            SetPdfUrl,
            SetCost,
            Currency,
            Notes,
            IsActive
        } = req.body;

        if (!setId || isNaN(parseInt(setId))) {
            return res.status(400).json({
                success: false,
                error: 'Valid setId is required'
            });
        }

        console.log(`Updating aligner set ${setId}:`, req.body);

        const query = `
            UPDATE tblAlignerSets
            SET
                SetSequence = @SetSequence,
                Type = @Type,
                UpperAlignersCount = @UpperAlignersCount,
                LowerAlignersCount = @LowerAlignersCount,
                Days = @Days,
                AlignerDrID = @AlignerDrID,
                SetUrl = @SetUrl,
                SetPdfUrl = @SetPdfUrl,
                SetCost = @SetCost,
                Currency = @Currency,
                Notes = @Notes,
                IsActive = @IsActive
            WHERE AlignerSetID = @setId
        `;

        await database.executeQuery(
            query,
            [
                ['SetSequence', database.TYPES.Int, SetSequence ? parseInt(SetSequence) : null],
                ['Type', database.TYPES.NVarChar, Type || null],
                ['UpperAlignersCount', database.TYPES.Int, UpperAlignersCount ? parseInt(UpperAlignersCount) : 0],
                ['LowerAlignersCount', database.TYPES.Int, LowerAlignersCount ? parseInt(LowerAlignersCount) : 0],
                ['Days', database.TYPES.Int, Days ? parseInt(Days) : null],
                ['AlignerDrID', database.TYPES.Int, AlignerDrID ? parseInt(AlignerDrID) : null],
                ['SetUrl', database.TYPES.NVarChar, SetUrl || null],
                ['SetPdfUrl', database.TYPES.NVarChar, SetPdfUrl || null],
                ['SetCost', database.TYPES.Decimal, SetCost ? parseFloat(SetCost) : null],
                ['Currency', database.TYPES.NVarChar, Currency || null],
                ['Notes', database.TYPES.NVarChar, Notes || null],
                ['IsActive', database.TYPES.Bit, IsActive !== undefined ? IsActive : true],
                ['setId', database.TYPES.Int, parseInt(setId)]
            ]
        );

        res.json({
            success: true,
            message: 'Aligner set updated successfully'
        });

    } catch (error) {
        console.error('Error updating aligner set:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update aligner set',
            message: error.message
        });
    }
});

/**
 * Delete an aligner set (and its batches)
 */
router.delete('/aligner/sets/:setId', async (req, res) => {
    try {
        const { setId } = req.params;

        if (!setId || isNaN(parseInt(setId))) {
            return res.status(400).json({
                success: false,
                error: 'Valid setId is required'
            });
        }

        console.log(`Deleting aligner set ${setId}`);

        // Delete batches first (foreign key constraint)
        const deleteBatchesQuery = `
            DELETE FROM tblAlignerBatches WHERE AlignerSetID = @setId
        `;

        await database.executeQuery(
            deleteBatchesQuery,
            [['setId', database.TYPES.Int, parseInt(setId)]]
        );

        // Then delete the set
        const deleteSetQuery = `
            DELETE FROM tblAlignerSets WHERE AlignerSetID = @setId
        `;

        await database.executeQuery(
            deleteSetQuery,
            [['setId', database.TYPES.Int, parseInt(setId)]]
        );

        res.json({
            success: true,
            message: 'Aligner set and its batches deleted successfully'
        });

    } catch (error) {
        console.error('Error deleting aligner set:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete aligner set',
            message: error.message
        });
    }
});

/**
 * Get notes for an aligner set
 */
router.get('/aligner/notes/:setId', async (req, res) => {
    try {
        const { setId } = req.params;

        if (!setId || isNaN(parseInt(setId))) {
            return res.status(400).json({
                success: false,
                error: 'Valid setId is required'
            });
        }

        const query = `
            SELECT
                n.NoteID,
                n.AlignerSetID,
                n.NoteType,
                n.NoteText,
                n.CreatedAt,
                n.IsEdited,
                n.EditedAt,
                n.IsRead,
                d.DoctorName
            FROM tblAlignerNotes n
            INNER JOIN tblAlignerSets s ON n.AlignerSetID = s.AlignerSetID
            INNER JOIN AlignerDoctors d ON s.AlignerDrID = d.DrID
            WHERE n.AlignerSetID = @setId
            ORDER BY n.CreatedAt DESC
        `;

        const notes = await database.executeQuery(
            query,
            [['setId', database.TYPES.Int, parseInt(setId)]],
            (columns) => ({
                NoteID: columns[0].value,
                AlignerSetID: columns[1].value,
                NoteType: columns[2].value,
                NoteText: columns[3].value,
                CreatedAt: columns[4].value,
                IsEdited: columns[5].value,
                EditedAt: columns[6].value,
                IsRead: columns[7].value,
                DoctorName: columns[8].value
            })
        );

        res.json({
            success: true,
            notes: notes || [],
            count: notes ? notes.length : 0
        });

    } catch (error) {
        console.error('Error fetching aligner set notes:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch notes',
            message: error.message
        });
    }
});

/**
 * Add a new note from lab staff
 */
router.post('/aligner/notes', async (req, res) => {
    try {
        const { AlignerSetID, NoteText } = req.body;

        if (!AlignerSetID || !NoteText || NoteText.trim() === '') {
            return res.status(400).json({
                success: false,
                error: 'Set ID and note text are required'
            });
        }

        // Verify that the set exists
        const setCheckQuery = `
            SELECT AlignerSetID
            FROM tblAlignerSets
            WHERE AlignerSetID = @setId
        `;

        const setExists = await database.executeQuery(
            setCheckQuery,
            [['setId', database.TYPES.Int, parseInt(AlignerSetID)]],
            (columns) => columns[0].value
        );

        if (!setExists || setExists.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Aligner set not found'
            });
        }

        // Insert note as 'Lab' type
        // Note: Using SCOPE_IDENTITY() instead of OUTPUT clause because table has triggers
        const insertQuery = `
            INSERT INTO tblAlignerNotes (AlignerSetID, NoteType, NoteText)
            VALUES (@setId, 'Lab', @noteText);
            SELECT SCOPE_IDENTITY() AS NoteID;
        `;

        const result = await database.executeQuery(
            insertQuery,
            [
                ['setId', database.TYPES.Int, parseInt(AlignerSetID)],
                ['noteText', database.TYPES.NVarChar, NoteText.trim()]
            ],
            (columns) => columns[0].value
        );

        const noteId = result && result.length > 0 ? result[0] : null;

        console.log(`Lab added note to aligner set ${AlignerSetID}`);

        res.json({
            success: true,
            noteId: noteId,
            message: 'Note added successfully'
        });

    } catch (error) {
        console.error('Error adding lab note:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to add note',
            message: error.message
        });
    }
});

/**
 * Toggle note read/unread status
 * NOTE: This route MUST come before the generic PATCH /aligner/notes/:noteId route
 * to ensure Express matches the more specific route first
 */
router.patch('/aligner/notes/:noteId/toggle-read', async (req, res) => {
    try {
        const { noteId } = req.params;

        if (!noteId || isNaN(parseInt(noteId))) {
            return res.status(400).json({
                success: false,
                error: 'Valid note ID is required'
            });
        }

        // Toggle IsRead status
        const updateQuery = `
            UPDATE tblAlignerNotes
            SET IsRead = CASE WHEN IsRead = 1 THEN 0 ELSE 1 END
            WHERE NoteID = @noteId
        `;

        await database.executeQuery(
            updateQuery,
            [['noteId', database.TYPES.Int, parseInt(noteId)]]
        );

        res.json({
            success: true,
            message: 'Note read status toggled successfully'
        });

    } catch (error) {
        console.error('Error toggling note read status:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to toggle read status',
            message: error.message
        });
    }
});

/**
 * Update an existing note
 */
router.patch('/aligner/notes/:noteId', async (req, res) => {
    try {
        const { noteId } = req.params;
        const { NoteText } = req.body;

        if (!noteId || isNaN(parseInt(noteId))) {
            return res.status(400).json({
                success: false,
                error: 'Valid note ID is required'
            });
        }

        if (!NoteText || NoteText.trim() === '') {
            return res.status(400).json({
                success: false,
                error: 'Note text is required'
            });
        }

        // Verify note exists
        const noteCheckQuery = `
            SELECT NoteID, NoteType
            FROM tblAlignerNotes
            WHERE NoteID = @noteId
        `;

        const existingNote = await database.executeQuery(
            noteCheckQuery,
            [['noteId', database.TYPES.Int, parseInt(noteId)]],
            (columns) => ({
                NoteID: columns[0].value,
                NoteType: columns[1].value
            })
        );

        if (!existingNote || existingNote.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Note not found'
            });
        }

        // Update note
        const updateQuery = `
            UPDATE tblAlignerNotes
            SET NoteText = @noteText,
                IsEdited = 1,
                EditedAt = GETDATE()
            WHERE NoteID = @noteId
        `;

        await database.executeQuery(
            updateQuery,
            [
                ['noteId', database.TYPES.Int, parseInt(noteId)],
                ['noteText', database.TYPES.NVarChar, NoteText.trim()]
            ]
        );

        console.log(`Note ${noteId} updated`);

        res.json({
            success: true,
            message: 'Note updated successfully'
        });

    } catch (error) {
        console.error('Error updating note:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update note',
            message: error.message
        });
    }
});

/**
 * Delete a note
 */
router.delete('/aligner/notes/:noteId', async (req, res) => {
    try {
        const { noteId } = req.params;

        if (!noteId || isNaN(parseInt(noteId))) {
            return res.status(400).json({
                success: false,
                error: 'Valid note ID is required'
            });
        }

        // Verify note exists
        const noteCheckQuery = `
            SELECT NoteID
            FROM tblAlignerNotes
            WHERE NoteID = @noteId
        `;

        const existingNote = await database.executeQuery(
            noteCheckQuery,
            [['noteId', database.TYPES.Int, parseInt(noteId)]],
            (columns) => columns[0].value
        );

        if (!existingNote || existingNote.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Note not found'
            });
        }

        // Delete note
        const deleteQuery = `
            DELETE FROM tblAlignerNotes
            WHERE NoteID = @noteId
        `;

        await database.executeQuery(
            deleteQuery,
            [['noteId', database.TYPES.Int, parseInt(noteId)]]
        );

        console.log(`Note ${noteId} deleted`);

        res.json({
            success: true,
            message: 'Note deleted successfully'
        });

    } catch (error) {
        console.error('Error deleting note:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete note',
            message: error.message
        });
    }
});

/**
 * Get note read status
 */
router.get('/aligner/notes/:noteId/status', async (req, res) => {
    try {
        const { noteId } = req.params;

        if (!noteId || isNaN(parseInt(noteId))) {
            return res.status(400).json({
                success: false,
                error: 'Valid note ID is required'
            });
        }

        const query = `
            SELECT IsRead
            FROM tblAlignerNotes
            WHERE NoteID = @noteId
        `;

        const results = await database.executeQuery(
            query,
            [['noteId', database.TYPES.Int, parseInt(noteId)]],
            (columns) => ({
                IsRead: columns[0].value
            })
        );

        if (results && results.length > 0) {
            res.json({
                success: true,
                isRead: results[0].IsRead
            });
        } else {
            res.status(404).json({
                success: false,
                error: 'Note not found'
            });
        }

    } catch (error) {
        console.error('Error getting note status:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get note status',
            message: error.message
        });
    }
});

// ===== ALIGNER ACTIVITY FLAGS =====

/**
 * Get unread activities for a specific aligner set
 */
router.get('/aligner/activity/:setId', async (req, res) => {
    try {
        const { setId } = req.params;

        if (!setId || isNaN(parseInt(setId))) {
            return res.status(400).json({
                success: false,
                error: 'Valid setId is required'
            });
        }

        const query = `
            SELECT
                ActivityID,
                AlignerSetID,
                ActivityType,
                ActivityDescription,
                CreatedAt,
                IsRead,
                ReadAt,
                RelatedRecordID
            FROM tblAlignerActivityFlags
            WHERE AlignerSetID = @setId AND IsRead = 0
            ORDER BY CreatedAt DESC
        `;

        const activities = await database.executeQuery(
            query,
            [['setId', database.TYPES.Int, parseInt(setId)]],
            (columns) => ({
                ActivityID: columns[0].value,
                AlignerSetID: columns[1].value,
                ActivityType: columns[2].value,
                ActivityDescription: columns[3].value,
                CreatedAt: columns[4].value,
                IsRead: columns[5].value,
                ReadAt: columns[6].value,
                RelatedRecordID: columns[7].value
            })
        );

        res.json({
            success: true,
            activities: activities || [],
            count: activities ? activities.length : 0
        });

    } catch (error) {
        console.error('Error fetching activities:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch activities',
            message: error.message
        });
    }
});

/**
 * Mark a single activity as read
 */
router.patch('/aligner/activity/:activityId/mark-read', async (req, res) => {
    try {
        const { activityId } = req.params;

        if (!activityId || isNaN(parseInt(activityId))) {
            return res.status(400).json({
                success: false,
                error: 'Valid activityId is required'
            });
        }

        const query = `
            UPDATE tblAlignerActivityFlags
            SET IsRead = 1, ReadAt = GETDATE()
            WHERE ActivityID = @activityId
        `;

        await database.executeQuery(
            query,
            [['activityId', database.TYPES.Int, parseInt(activityId)]]
        );

        console.log(`Activity ${activityId} marked as read`);

        res.json({
            success: true,
            message: 'Activity marked as read'
        });

    } catch (error) {
        console.error('Error marking activity as read:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to mark activity as read',
            message: error.message
        });
    }
});

/**
 * Mark all activities for a set as read
 */
router.patch('/aligner/activity/set/:setId/mark-all-read', async (req, res) => {
    try {
        const { setId } = req.params;

        if (!setId || isNaN(parseInt(setId))) {
            return res.status(400).json({
                success: false,
                error: 'Valid setId is required'
            });
        }

        const query = `
            UPDATE tblAlignerActivityFlags
            SET IsRead = 1, ReadAt = GETDATE()
            WHERE AlignerSetID = @setId AND IsRead = 0
        `;

        await database.executeQuery(
            query,
            [['setId', database.TYPES.Int, parseInt(setId)]]
        );

        console.log(`All activities for set ${setId} marked as read`);

        res.json({
            success: true,
            message: 'All activities marked as read'
        });

    } catch (error) {
        console.error('Error marking all activities as read:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to mark all activities as read',
            message: error.message
        });
    }
});

// ===== ALIGNER BATCHES CRUD OPERATIONS =====

/**
 * Create a new aligner batch
 */
router.post('/aligner/batches', async (req, res) => {
    try {
        const {
            AlignerSetID,
            BatchSequence,
            UpperAlignerCount,
            LowerAlignerCount,
            UpperAlignerStartSequence,
            UpperAlignerEndSequence,
            LowerAlignerStartSequence,
            LowerAlignerEndSequence,
            ManufactureDate,
            ValidityPeriod,
            NextBatchReadyDate,
            Notes,
            IsActive
        } = req.body;

        // Validation
        if (!AlignerSetID) {
            return res.status(400).json({
                success: false,
                error: 'AlignerSetID is required'
            });
        }

        console.log('Creating new aligner batch:', req.body);

        const query = `
            DECLARE @OutputTable TABLE (AlignerBatchID INT);

            INSERT INTO tblAlignerBatches (
                AlignerSetID, BatchSequence, UpperAlignerCount, LowerAlignerCount,
                UpperAlignerStartSequence, UpperAlignerEndSequence,
                LowerAlignerStartSequence, LowerAlignerEndSequence,
                ManufactureDate, ValidityPeriod, NextBatchReadyDate,
                Notes, IsActive
            )
            OUTPUT INSERTED.AlignerBatchID INTO @OutputTable
            VALUES (
                @AlignerSetID, @BatchSequence, @UpperAlignerCount, @LowerAlignerCount,
                @UpperAlignerStartSequence, @UpperAlignerEndSequence,
                @LowerAlignerStartSequence, @LowerAlignerEndSequence,
                @ManufactureDate, @ValidityPeriod, @NextBatchReadyDate,
                @Notes, @IsActive
            );

            SELECT AlignerBatchID FROM @OutputTable;
        `;

        const result = await database.executeQuery(
            query,
            [
                ['AlignerSetID', database.TYPES.Int, parseInt(AlignerSetID)],
                ['BatchSequence', database.TYPES.Int, BatchSequence ? parseInt(BatchSequence) : null],
                ['UpperAlignerCount', database.TYPES.Int, UpperAlignerCount ? parseInt(UpperAlignerCount) : 0],
                ['LowerAlignerCount', database.TYPES.Int, LowerAlignerCount ? parseInt(LowerAlignerCount) : 0],
                ['UpperAlignerStartSequence', database.TYPES.Int, UpperAlignerStartSequence ? parseInt(UpperAlignerStartSequence) : null],
                ['UpperAlignerEndSequence', database.TYPES.Int, UpperAlignerEndSequence ? parseInt(UpperAlignerEndSequence) : null],
                ['LowerAlignerStartSequence', database.TYPES.Int, LowerAlignerStartSequence ? parseInt(LowerAlignerStartSequence) : null],
                ['LowerAlignerEndSequence', database.TYPES.Int, LowerAlignerEndSequence ? parseInt(LowerAlignerEndSequence) : null],
                ['ManufactureDate', database.TYPES.Date, ManufactureDate || null],
                ['ValidityPeriod', database.TYPES.Int, ValidityPeriod ? parseInt(ValidityPeriod) : null],
                ['NextBatchReadyDate', database.TYPES.Date, NextBatchReadyDate || null],
                ['Notes', database.TYPES.NVarChar, Notes || null],
                ['IsActive', database.TYPES.Bit, IsActive !== undefined ? IsActive : true]
            ],
            (columns) => columns[0].value
        );

        const newBatchId = result && result.length > 0 ? result[0] : null;

        res.json({
            success: true,
            batchId: newBatchId,
            message: 'Aligner batch created successfully'
        });

    } catch (error) {
        console.error('Error creating aligner batch:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create aligner batch',
            message: error.message
        });
    }
});

/**
 * Update an existing aligner batch
 */
router.put('/aligner/batches/:batchId', async (req, res) => {
    try {
        const { batchId } = req.params;
        const {
            BatchSequence,
            UpperAlignerCount,
            LowerAlignerCount,
            UpperAlignerStartSequence,
            UpperAlignerEndSequence,
            LowerAlignerStartSequence,
            LowerAlignerEndSequence,
            ManufactureDate,
            DeliveredToPatientDate,
            ValidityPeriod,
            NextBatchReadyDate,
            Notes,
            IsActive
        } = req.body;

        if (!batchId || isNaN(parseInt(batchId))) {
            return res.status(400).json({
                success: false,
                error: 'Valid batchId is required'
            });
        }

        console.log(`Updating aligner batch ${batchId}:`, req.body);

        const query = `
            UPDATE tblAlignerBatches
            SET
                BatchSequence = @BatchSequence,
                UpperAlignerCount = @UpperAlignerCount,
                LowerAlignerCount = @LowerAlignerCount,
                UpperAlignerStartSequence = @UpperAlignerStartSequence,
                UpperAlignerEndSequence = @UpperAlignerEndSequence,
                LowerAlignerStartSequence = @LowerAlignerStartSequence,
                LowerAlignerEndSequence = @LowerAlignerEndSequence,
                ManufactureDate = @ManufactureDate,
                DeliveredToPatientDate = @DeliveredToPatientDate,
                ValidityPeriod = @ValidityPeriod,
                NextBatchReadyDate = @NextBatchReadyDate,
                Notes = @Notes,
                IsActive = @IsActive
            WHERE AlignerBatchID = @batchId
        `;

        await database.executeQuery(
            query,
            [
                ['BatchSequence', database.TYPES.Int, BatchSequence ? parseInt(BatchSequence) : null],
                ['UpperAlignerCount', database.TYPES.Int, UpperAlignerCount ? parseInt(UpperAlignerCount) : 0],
                ['LowerAlignerCount', database.TYPES.Int, LowerAlignerCount ? parseInt(LowerAlignerCount) : 0],
                ['UpperAlignerStartSequence', database.TYPES.Int, UpperAlignerStartSequence ? parseInt(UpperAlignerStartSequence) : null],
                ['UpperAlignerEndSequence', database.TYPES.Int, UpperAlignerEndSequence ? parseInt(UpperAlignerEndSequence) : null],
                ['LowerAlignerStartSequence', database.TYPES.Int, LowerAlignerStartSequence ? parseInt(LowerAlignerStartSequence) : null],
                ['LowerAlignerEndSequence', database.TYPES.Int, LowerAlignerEndSequence ? parseInt(LowerAlignerEndSequence) : null],
                ['ManufactureDate', database.TYPES.Date, ManufactureDate || null],
                ['DeliveredToPatientDate', database.TYPES.Date, DeliveredToPatientDate || null],
                ['ValidityPeriod', database.TYPES.Int, ValidityPeriod ? parseInt(ValidityPeriod) : null],
                ['NextBatchReadyDate', database.TYPES.Date, NextBatchReadyDate || null],
                ['Notes', database.TYPES.NVarChar, Notes || null],
                ['IsActive', database.TYPES.Bit, IsActive !== undefined ? IsActive : true],
                ['batchId', database.TYPES.Int, parseInt(batchId)]
            ]
        );

        res.json({
            success: true,
            message: 'Aligner batch updated successfully'
        });

    } catch (error) {
        console.error('Error updating aligner batch:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update aligner batch',
            message: error.message
        });
    }
});

/**
 * Mark batch as delivered
 */
router.patch('/aligner/batches/:batchId/deliver', async (req, res) => {
    try {
        const { batchId } = req.params;

        if (!batchId || isNaN(parseInt(batchId))) {
            return res.status(400).json({
                success: false,
                error: 'Valid batchId is required'
            });
        }

        console.log(`Marking batch ${batchId} as delivered`);

        const query = `
            UPDATE tblAlignerBatches
            SET DeliveredToPatientDate = GETDATE()
            WHERE AlignerBatchID = @batchId
        `;

        await database.executeQuery(
            query,
            [['batchId', database.TYPES.Int, parseInt(batchId)]]
        );

        res.json({
            success: true,
            message: 'Batch marked as delivered'
        });

    } catch (error) {
        console.error('Error marking batch as delivered:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to mark batch as delivered',
            message: error.message
        });
    }
});

/**
 * Delete an aligner batch
 */
router.delete('/aligner/batches/:batchId', async (req, res) => {
    try {
        const { batchId } = req.params;

        if (!batchId || isNaN(parseInt(batchId))) {
            return res.status(400).json({
                success: false,
                error: 'Valid batchId is required'
            });
        }

        console.log(`Deleting aligner batch ${batchId}`);

        const query = `
            DELETE FROM tblAlignerBatches WHERE AlignerBatchID = @batchId
        `;

        await database.executeQuery(
            query,
            [['batchId', database.TYPES.Int, parseInt(batchId)]]
        );

        res.json({
            success: true,
            message: 'Aligner batch deleted successfully'
        });

    } catch (error) {
        console.error('Error deleting aligner batch:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete aligner batch',
            message: error.message
        });
    }
});

// ==============================
// ALIGNER PDF UPLOAD/DELETE
// ==============================

/**
 * Upload PDF for an aligner set (staff page)
 */
router.post('/aligner/sets/:setId/upload-pdf', uploadSinglePdf, handleUploadError, async (req, res) => {
    try {
        const setId = parseInt(req.params.setId);
        const uploaderEmail = 'staff@shwan.local'; // Staff uploads (no auth required)

        // Validate file exists
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'No file uploaded. Please select a PDF file.'
            });
        }

        // Validate PDF
        const validation = driveUploadService.validatePdfFile(req.file.buffer, req.file.mimetype);
        if (!validation.valid) {
            return res.status(400).json({
                success: false,
                error: validation.error
            });
        }

        // Get set information
        const setQuery = `
            SELECT
                s.AlignerSetID,
                s.WorkID,
                s.SetSequence,
                s.DriveFileId,
                w.PersonID,
                p.PatientName,
                p.FirstName,
                p.LastName
            FROM tblAlignerSets s
            INNER JOIN tblWork w ON s.WorkID = w.workid
            INNER JOIN tblPatients p ON w.PersonID = p.PersonID
            WHERE s.AlignerSetID = @setId
        `;

        const setResult = await database.executeQuery(setQuery, [
            ['setId', database.TYPES.Int, setId]
        ]);

        if (!setResult || setResult.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Aligner set not found'
            });
        }

        const setInfo = setResult[0];
        const patientName = setInfo.PatientName || `${setInfo.FirstName} ${setInfo.LastName}`;

        // Delete old file from Drive if exists
        if (setInfo.DriveFileId) {
            try {
                await driveUploadService.deletePdf(setInfo.DriveFileId);
            } catch (error) {
                console.warn('Failed to delete old PDF from Drive:', error);
                // Continue with upload even if deletion fails
            }
        }

        // Upload to Google Drive
        const uploadResult = await driveUploadService.uploadPdfForSet(
            {
                buffer: req.file.buffer,
                originalName: req.file.originalname
            },
            {
                patientId: setInfo.PersonID,
                patientName: patientName,
                workId: setInfo.WorkID,
                setSequence: setInfo.SetSequence
            },
            uploaderEmail
        );

        // Update database
        const updateQuery = `
            UPDATE tblAlignerSets
            SET
                SetPdfUrl = @url,
                DriveFileId = @fileId,
                PdfUploadedAt = GETDATE(),
                PdfUploadedBy = @uploadedBy
            WHERE AlignerSetID = @setId
        `;

        await database.executeQuery(updateQuery, [
            ['url', database.TYPES.NVarChar, uploadResult.url],
            ['fileId', database.TYPES.NVarChar, uploadResult.fileId],
            ['uploadedBy', database.TYPES.NVarChar, uploaderEmail],
            ['setId', database.TYPES.Int, setId]
        ]);

        res.json({
            success: true,
            message: 'PDF uploaded successfully',
            data: {
                url: uploadResult.url,
                fileName: uploadResult.fileName,
                size: uploadResult.size
            }
        });

    } catch (error) {
        console.error('Error uploading PDF:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to upload PDF'
        });
    }
});

/**
 * Delete PDF from an aligner set (staff page)
 */
router.delete('/aligner/sets/:setId/pdf', async (req, res) => {
    try {
        const setId = parseInt(req.params.setId);

        // Get set information
        const setQuery = `
            SELECT DriveFileId
            FROM tblAlignerSets
            WHERE AlignerSetID = @setId
        `;

        const setResult = await database.executeQuery(setQuery, [
            ['setId', database.TYPES.Int, setId]
        ]);

        if (!setResult || setResult.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Aligner set not found'
            });
        }

        const driveFileId = setResult[0].DriveFileId;

        // Delete from Google Drive if exists
        if (driveFileId) {
            try {
                await driveUploadService.deletePdf(driveFileId);
            } catch (error) {
                console.warn('Failed to delete from Drive:', error);
                // Continue with database update even if Drive deletion fails
            }
        }

        // Update database
        const updateQuery = `
            UPDATE tblAlignerSets
            SET
                SetPdfUrl = NULL,
                DriveFileId = NULL,
                PdfUploadedAt = NULL,
                PdfUploadedBy = NULL
            WHERE AlignerSetID = @setId
        `;

        await database.executeQuery(updateQuery, [
            ['setId', database.TYPES.Int, setId]
        ]);

        res.json({
            success: true,
            message: 'PDF deleted successfully'
        });

    } catch (error) {
        console.error('Error deleting PDF:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete PDF'
        });
    }
});

// ==============================
// ALIGNER DOCTORS MANAGEMENT
// ==============================

/**
 * Get all aligner doctors
 */
router.get('/aligner-doctors', async (req, res) => {
    try {
        const query = `
            SELECT DrID, DoctorName, DoctorEmail, LogoPath
            FROM AlignerDoctors
            ORDER BY DoctorName
        `;

        const doctors = await database.executeQuery(
            query,
            [],
            (columns) => ({
                DrID: columns[0].value,
                DoctorName: columns[1].value,
                DoctorEmail: columns[2].value,
                LogoPath: columns[3].value
            })
        );

        res.json({
            success: true,
            doctors: doctors || []
        });

    } catch (error) {
        console.error('Error fetching aligner doctors:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch aligner doctors',
            message: error.message
        });
    }
});

/**
 * Add new aligner doctor
 */
router.post('/aligner-doctors', async (req, res) => {
    try {
        const { DoctorName, DoctorEmail, LogoPath } = req.body;

        if (!DoctorName || DoctorName.trim() === '') {
            return res.status(400).json({
                success: false,
                error: 'Doctor name is required'
            });
        }

        // Check if email already exists (if provided)
        if (DoctorEmail && DoctorEmail.trim() !== '') {
            const emailCheck = await database.executeQuery(
                'SELECT DrID FROM AlignerDoctors WHERE DoctorEmail = @email',
                [['email', database.TYPES.NVarChar, DoctorEmail.trim()]],
                (columns) => columns[0].value
            );

            if (emailCheck && emailCheck.length > 0) {
                return res.status(400).json({
                    success: false,
                    error: 'A doctor with this email already exists'
                });
            }
        }

        // Insert without specifying DrID - it will be auto-generated by IDENTITY column
        const insertQuery = `
            DECLARE @OutputTable TABLE (DrID INT);

            INSERT INTO AlignerDoctors (DoctorName, DoctorEmail, LogoPath)
            OUTPUT INSERTED.DrID INTO @OutputTable
            VALUES (@name, @email, @logo);

            SELECT DrID FROM @OutputTable;
        `;

        const result = await database.executeQuery(
            insertQuery,
            [
                ['name', database.TYPES.NVarChar, DoctorName.trim()],
                ['email', database.TYPES.VarChar, DoctorEmail && DoctorEmail.trim() !== '' ? DoctorEmail.trim() : null],
                ['logo', database.TYPES.NVarChar, LogoPath && LogoPath.trim() !== '' ? LogoPath.trim() : null]
            ],
            (columns) => columns[0].value
        );

        const newDrID = result && result.length > 0 ? result[0] : null;

        res.json({
            success: true,
            message: 'Doctor added successfully',
            drID: newDrID
        });

    } catch (error) {
        console.error('Error adding aligner doctor:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to add aligner doctor',
            message: error.message
        });
    }
});

/**
 * Update aligner doctor
 */
router.put('/aligner-doctors/:drID', async (req, res) => {
    try {
        const { drID } = req.params;
        const { DoctorName, DoctorEmail, LogoPath } = req.body;

        if (!DoctorName || DoctorName.trim() === '') {
            return res.status(400).json({
                success: false,
                error: 'Doctor name is required'
            });
        }

        // Check if email already exists for another doctor (if provided)
        if (DoctorEmail && DoctorEmail.trim() !== '') {
            const emailCheck = await database.executeQuery(
                'SELECT DrID FROM AlignerDoctors WHERE DoctorEmail = @email AND DrID != @drID',
                [
                    ['email', database.TYPES.NVarChar, DoctorEmail.trim()],
                    ['drID', database.TYPES.Int, parseInt(drID)]
                ],
                (columns) => columns[0].value
            );

            if (emailCheck && emailCheck.length > 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Another doctor with this email already exists'
                });
            }
        }

        const updateQuery = `
            UPDATE AlignerDoctors
            SET DoctorName = @name,
                DoctorEmail = @email,
                LogoPath = @logo
            WHERE DrID = @drID
        `;

        await database.executeQuery(
            updateQuery,
            [
                ['name', database.TYPES.NVarChar, DoctorName.trim()],
                ['email', database.TYPES.NVarChar, DoctorEmail && DoctorEmail.trim() !== '' ? DoctorEmail.trim() : null],
                ['logo', database.TYPES.NVarChar, LogoPath && LogoPath.trim() !== '' ? LogoPath.trim() : null],
                ['drID', database.TYPES.Int, parseInt(drID)]
            ]
        );

        res.json({
            success: true,
            message: 'Doctor updated successfully'
        });

    } catch (error) {
        console.error('Error updating aligner doctor:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update aligner doctor',
            message: error.message
        });
    }
});

/**
 * Delete aligner doctor
 */
router.delete('/aligner-doctors/:drID', async (req, res) => {
    try {
        const { drID } = req.params;

        // Check if doctor has any aligner sets
        const setsCheck = await database.executeQuery(
            'SELECT COUNT(*) as SetCount FROM tblAlignerSets WHERE AlignerDrID = @drID',
            [['drID', database.TYPES.Int, parseInt(drID)]],
            (columns) => columns[0].value
        );

        const setCount = setsCheck && setsCheck.length > 0 ? setsCheck[0] : 0;

        if (setCount > 0) {
            return res.status(400).json({
                success: false,
                error: `Cannot delete doctor. They have ${setCount} aligner set(s) associated with them. Please reassign or delete those sets first.`
            });
        }

        const deleteQuery = 'DELETE FROM AlignerDoctors WHERE DrID = @drID';

        await database.executeQuery(
            deleteQuery,
            [['drID', database.TYPES.Int, parseInt(drID)]]
        );

        res.json({
            success: true,
            message: 'Doctor deleted successfully'
        });

    } catch (error) {
        console.error('Error deleting aligner doctor:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete aligner doctor',
            message: error.message
        });
    }
});

// ==============================
// ALIGNER SET PHOTOS - REMOVED
// ==============================
// Photo upload functionality has been moved to Supabase Edge Functions
// See: aligner-portal-external/docs/R2_STORAGE_SETUP.md
// Edge Functions:
//   - aligner-photo-upload-url
//   - aligner-photo-save-metadata
//   - aligner-photo-delete

// ==============================
// EXPENSE MANAGEMENT ROUTES
// ==============================

/**
 * Get all expenses with optional filtering
 * Query params: startDate, endDate, categoryId, subcategoryId, currency
 */
router.get('/expenses', async (req, res) => {
    try {
        const filters = {
            startDate: req.query.startDate,
            endDate: req.query.endDate,
            categoryId: req.query.categoryId ? parseInt(req.query.categoryId) : null,
            subcategoryId: req.query.subcategoryId ? parseInt(req.query.subcategoryId) : null,
            currency: req.query.currency
        };

        // Remove null/undefined filters
        Object.keys(filters).forEach(key => {
            if (filters[key] === null || filters[key] === undefined) {
                delete filters[key];
            }
        });

        const expenses = await getAllExpenses(filters);
        res.json(expenses);
    } catch (error) {
        console.error('Error fetching expenses:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch expenses',
            message: error.message
        });
    }
});

/**
 * Get a single expense by ID
 */
router.get('/expenses/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const expense = await getExpenseById(parseInt(id));

        if (!expense) {
            return res.status(404).json({
                success: false,
                error: 'Expense not found'
            });
        }

        res.json(expense);
    } catch (error) {
        console.error('Error fetching expense:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch expense',
            message: error.message
        });
    }
});

/**
 * Get all expense categories
 */
router.get('/expenses-categories', async (req, res) => {
    try {
        const categories = await getExpenseCategories();
        res.json(categories);
    } catch (error) {
        console.error('Error fetching expense categories:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch expense categories',
            message: error.message
        });
    }
});

/**
 * Get expense subcategories (optionally filtered by category)
 * Query params: categoryId (optional)
 */
router.get('/expenses-subcategories', async (req, res) => {
    try {
        const categoryId = req.query.categoryId ? parseInt(req.query.categoryId) : null;
        const subcategories = await getExpenseSubcategories(categoryId);
        res.json(subcategories);
    } catch (error) {
        console.error('Error fetching expense subcategories:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch expense subcategories',
            message: error.message
        });
    }
});

/**
 * Create a new expense
 */
router.post('/expenses', async (req, res) => {
    try {
        const { expenseDate, amount, currency, note, categoryId, subcategoryId } = req.body;

        // Validation
        if (!expenseDate || !amount) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: expenseDate, amount'
            });
        }

        const expenseData = {
            expenseDate,
            amount: parseInt(amount),
            currency: currency || 'IQD',
            note,
            categoryId: categoryId ? parseInt(categoryId) : null,
            subcategoryId: subcategoryId ? parseInt(subcategoryId) : null
        };

        const result = await addExpense(expenseData);
        res.status(201).json({
            success: true,
            message: 'Expense created successfully',
            data: result
        });
    } catch (error) {
        console.error('Error creating expense:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create expense',
            message: error.message
        });
    }
});

/**
 * Update an existing expense
 */
router.put('/expenses/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { expenseDate, amount, currency, note, categoryId, subcategoryId } = req.body;

        // Validation
        if (!expenseDate || !amount) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: expenseDate, amount'
            });
        }

        const expenseData = {
            expenseDate,
            amount: parseInt(amount),
            currency: currency || 'IQD',
            note,
            categoryId: categoryId ? parseInt(categoryId) : null,
            subcategoryId: subcategoryId ? parseInt(subcategoryId) : null
        };

        const result = await updateExpense(parseInt(id), expenseData);
        res.json({
            success: true,
            message: 'Expense updated successfully',
            data: result
        });
    } catch (error) {
        console.error('Error updating expense:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update expense',
            message: error.message
        });
    }
});

/**
 * Delete an expense
 */
router.delete('/expenses/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await deleteExpense(parseInt(id));
        res.json({
            success: true,
            message: 'Expense deleted successfully',
            data: result
        });
    } catch (error) {
        console.error('Error deleting expense:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete expense',
            message: error.message
        });
    }
});

/**
 * Get expense summary by category and currency
 * Query params: startDate, endDate (required)
 */
router.get('/expenses-summary', async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        if (!startDate || !endDate) {
            return res.status(400).json({
                success: false,
                error: 'Missing required parameters: startDate, endDate'
            });
        }

        const summary = await getExpenseSummary(startDate, endDate);
        const totals = await getExpenseTotalsByCurrency(startDate, endDate);

        res.json({
            summary,
            totals
        });
    } catch (error) {
        console.error('Error fetching expense summary:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch expense summary',
            message: error.message
        });
    }
});

// Get work data for receipt from V_Report view (includes patient info, appointment, etc.)
router.get('/getworkforreceipt/:workId', async (req, res) => {
    try {
        const { workId } = req.params;
        if (!workId) {
            return res.status(400).json({ error: "Missing required parameter: workId" });
        }

        const result = await database.executeQuery(
            'SELECT PersonID, PatientName, Phone, TotalPaid, AppDate, workid, TotalRequired, Currency FROM dbo.V_Report WHERE workid = @WorkID',
            [['WorkID', database.TYPES.Int, parseInt(workId)]],
            (columns) => {
                const row = {};
                columns.forEach(column => {
                    row[column.metadata.colName] = column.value;
                });
                return row;
            }
        );

        if (!result || result.length === 0) {
            return res.status(404).json({ error: "Work not found" });
        }

        res.json(result[0]);
    } catch (error) {
        console.error("Error fetching work for receipt:", error);
        res.status(500).json({ error: "Failed to fetch work data" });
    }
});

export default router;