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
import { sendError, ErrorResponses } from '../../utils/error-response.js';
import { log } from '../../utils/logger.js';

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
        return ErrorResponses.internalError(res, "Failed to send SMS", error);
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
        return ErrorResponses.internalError(res, "Failed to check SMS", error);
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
    log.info("Legacy updaterp endpoint called - WebSocket recommended");

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
            return ErrorResponses.missingParameter(res, "source");
        }

        const contacts = await getContacts(source);
        res.json(contacts);
    } catch (error) {
        log.error("Error fetching Google contacts:", error);
        return ErrorResponses.internalError(res, "Failed to fetch Google contacts", error);
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

        log.info('Convert-path request received:', { webPath, machinePath: config.fileSystem.machinePath });

        if (!webPath) {
            return ErrorResponses.missingParameter(res, "path");
        }

        if (!config.fileSystem.machinePath) {
            log.error('MACHINE_PATH environment variable not set');
            return ErrorResponses.internalError(res, "MACHINE_PATH environment variable not configured");
        }

        // Create path resolver
        const pathResolver = createPathResolver(config.fileSystem.machinePath);

        // Convert DolImgs path to full file system path
        if (webPath.startsWith('DolImgs/')) {
            const fileName = webPath.replace('DolImgs/', '');
            const fullPath = pathResolver(`working/${fileName}`);

            log.info('Path conversion successful:', { webPath, fileName, fullPath });

            res.json({
                webPath: webPath,
                fullPath: fullPath
            });
        } else {
            // If not a DolImgs path, return as-is (could be already a full path)
            log.info('Path not a DolImgs path, returning as-is:', webPath);
            res.json({
                webPath: webPath,
                fullPath: webPath
            });
        }

    } catch (error) {
        log.error('Error converting path:', error);
        return ErrorResponses.internalError(res, "Internal server error", error);
    }
});

export default router;
