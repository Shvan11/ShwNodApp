/**
 * Utility Routes Module
 *
 * This module contains miscellaneous utility endpoints for the API:
 * - /clear: Serve the clear.html page
 * - /sendtwilio: Send SMS reminders via Twilio
 * - /checktwilio: Check SMS delivery status
 * - /updaterp: Legacy report update endpoint (deprecated - use WebSocket instead)
 * - /google: Fetch Google contacts via OAuth
 * - /convert-path: Convert web paths to full file system paths
 */

import express from 'express';
import sms from '../../services/messaging/sms.js';
import messageState from '../../services/state/messageState.js';
import { getContacts } from '../../services/authentication/google.js';
import { createPathResolver } from '../../utils/path-resolver.js';
import config from '../../config/config.js';

const router = express.Router();

/**
 * GET /clear
 * Serve the clear.html page
 */
router.get('/clear', (req, res) => {
    res.sendFile('./public/clear.html', { root: '.' });
});

/**
 * GET /sendtwilio
 * Send SMS reminders via Twilio for a specific date
 *
 * Query Parameters:
 * - date: The date for which to send SMS reminders
 */
router.get('/sendtwilio', async (req, res) => {
    const dateparam = req.query.date;
    try {
        await sms.sendSms(dateparam);
        res.send("SMS sent successfully");
    } catch (error) {
        res.status(500).send("Failed to send SMS");
    }
});

/**
 * GET /checktwilio
 * Check SMS delivery status for a specific date
 *
 * Query Parameters:
 * - date: The date for which to check SMS status
 */
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
 * GET /updaterp
 * Legacy report update endpoint
 *
 * @deprecated Use WebSocket for real-time report updates instead
 *
 * Returns the current status of message client initialization and report generation
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
 * GET /google
 * Fetch Google contacts for a user via OAuth
 *
 * Query Parameters:
 * - source: The OAuth source/identifier for fetching contacts
 *
 * Returns:
 * - contacts: Array of contacts from Google
 */
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

/**
 * GET /convert-path
 * Convert web-relative paths to full file system paths
 *
 * Supports converting DolImgs paths to working directory paths using the
 * configured MACHINE_PATH environment variable for cross-platform compatibility
 *
 * Query Parameters:
 * - path: The web-relative path to convert (e.g., 'DolImgs/filename.jpg')
 *
 * Returns:
 * - webPath: The original web path provided
 * - fullPath: The converted full file system path
 */
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

export default router;
