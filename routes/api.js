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


const router = express.Router();
const upload = multer();





// Modify the event handlers to add more logging
whatsapp.on('MessageSent', (p) => {
    console.log("MessageSent event fired:", p);
    try {
        p.success = '&#10004;';
        const result = messageState.addPerson(p);
        console.log("messageState after MessageSent:", messageState.dump());
    } catch (error) {
        console.error("Error handling MessageSent event:", error);
    }
});

whatsapp.on('MessageFailed', (p) => {
    console.log("MessageFailed event fired:", p);
    messageState.change = true;
    messageState.failedMessages += 1;
    p.success = '&times;';
    messageState.persons.push(p);
});

// Create a singleton instance
//const messageState = new MessageState();

// Set up event handlers for WhatsApp service
// Use arrow functions to preserve 'this' context


whatsapp.on('finishedSending', () => {
    messageState.finishedSending = true;
});

whatsapp.on('finish_report', (date) => {
    messageState.finishReport = true;
    sendSMSNoti(date);
});

whatsapp.on('ClientIsReady', () => {
    messageState.clientReady = true;
});

whatsapp.on('qr', (aqr) => {
    messageState.qr = aqr;
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



router.get('/wa/send', (req, res) => {
   
    const dateparam = req.query.date;
    
    // Check if client is ready
    if (!whatsapp.isReady()) {
      return res.status(400).json({
        success: false,
        message: "WhatsApp client is not ready. Please wait for initialization to complete.",
        clientStatus: whatsapp.getStatus()
      });
    }
    
    console.log(`Starting WhatsApp send process for date: ${dateparam}`);
    
    // Call the send method without waiting for it to complete
    whatsapp.send(dateparam);
    
    // Respond immediately
    res.json({ 
      success: true, 
      message: "WhatsApp sending process started",
      htmltext: 'Starting...'
    });
    
    // REMOVE THIS TIMEOUT - the persistent client handles reporting
    // const delay = messageState.gturbo ? 300000 : 3600000;
    // setTimeout(() => { whatsapp.report(dateparam); }, delay);
  });

// router.get('/wa/report', (req, res) => {
//     const dateparam = req.query.date;
//     whatsapp.report(dateparam);
//     res.json({ htmltext: 'Starting...' });
// });

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
router.get('/update', (req, res) => {
    // Modify it as follows:
    
    console.log("Update endpoint called, messageState:", messageState.dump());
  
    let html = '';
    let finished = messageState.finishedSending;
    
    // Get client status from WhatsApp service
    const clientStatus = whatsapp.getStatus();
  
    if (messageState.clientReady || clientStatus.active) {
      if (finished) {
        html = `<p>${messageState.sentMessages} Messages Sent!</p><p>${messageState.failedMessages} Messages Failed!</p><p>Finished</p>`;
      } else {
        html = `<p>${messageState.sentMessages} Messages Sent!</p><p>${messageState.failedMessages} Messages Failed!</p><p>Sending...</p>`;
      }
    } else if (messageState.qr) {
      html = '<p>QR code ready...</p>';
    } else {
      html = '<p>Initializing the client...</p>';
    }
  
    // Get status updates from messageState
    const statusUpdates = messageState.getStatusUpdates ? messageState.getStatusUpdates() : [];
  
    // Always return the current state
    res.json({
      htmltext: html,
      finished,
      clientReady: messageState.clientReady || clientStatus.active,
      clientStatus: clientStatus,
      persons: messageState.persons,
      qr: messageState.qr,
      statusUpdates
    });
  
    // Reset change flag after sending
    if (messageState.change) {
      messageState.change = false;
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