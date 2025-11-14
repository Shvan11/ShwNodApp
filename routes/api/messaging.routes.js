/**
 * Messaging System Routes
 *
 * This module handles all messaging-related API endpoints including:
 * - Circuit breaker status and control
 * - Batch message status updates
 * - Message status tracking by date
 * - Message counting and details
 * - Messaging reset operations
 *
 * These routes integrate with the messaging queries service and WebSocket
 * for real-time message status updates.
 */

import express from 'express';
import { log } from '../../utils/logger.js';
import * as database from '../../services/database/index.js';
import * as messagingQueries from '../../services/database/queries/messaging-queries.js';
import { getWhatsAppMessages } from '../../services/database/queries/messaging-queries.js';
import messageState from '../../services/state/messageState.js';
import whatsapp from '../../services/messaging/whatsapp.js';
import { WebSocketEvents, createStandardMessage } from '../../services/messaging/websocket-events.js';
import { sendError, ErrorResponses } from '../../utils/error-response.js';
import {
    transformMessageStatuses,
    calculateMessageCount,
    getMessageDetails
} from '../../services/business/MessagingService.js';

const router = express.Router();

// WebSocket emitter will be injected to avoid circular imports
let wsEmitter = null;

/**
 * Set the WebSocket emitter reference
 * @param {EventEmitter} emitter - WebSocket event emitter
 */
export function setWebSocketEmitter(emitter) {
    wsEmitter = emitter;
}

/**
 * Circuit breaker status for messaging operations
 */
router.get('/circuit-breaker-status', (req, res) => {
    try {
        const status = messagingQueries.getCircuitBreakerStatus();
        res.json({
            success: true,
            ...status
        });
    } catch (error) {
        return ErrorResponses.internalError(res, error.message, error);
    }
});

/**
 * Reset circuit breaker (manual recovery)
 */
router.post('/reset-circuit-breaker', (req, res) => {
    try {
        const result = messagingQueries.resetCircuitBreaker();
        res.json(result);
    } catch (error) {
        return ErrorResponses.internalError(res, error.message, error);
    }
});

/**
 * Batch status update endpoint
 */
router.post('/batch-status-update', async (req, res) => {
    try {
        const { updates } = req.body;

        if (!updates || !Array.isArray(updates)) {
            return ErrorResponses.badRequest(res, 'Updates array is required');
        }

        const result = await messagingQueries.batchUpdateMessageStatuses(updates, wsEmitter);
        res.json(result);

    } catch (error) {
        log.error('Error in batch status update:', error);
        return ErrorResponses.internalError(res, error.message, error);
    }
});

/**
 * Get message status by date
 */
router.get('/status/:date', async (req, res) => {
    try {
        const { date } = req.params;
        const result = await messagingQueries.getMessageStatusByDate(date);

        // Delegate to service layer for status transformation
        if (result && result.messages) {
            result.messages = transformMessageStatuses(result.messages);
        }

        res.json(result);
    } catch (error) {
        log.error('Error getting message status:', error);
        return ErrorResponses.internalError(res, error.message, error);
    }
});

/**
 * Get message count for a specific date
 * Returns how many appointments are scheduled and eligible for messaging
 */
router.get('/count/:date', async (req, res) => {
    try {
        const { date } = req.params;
        log.info(`Getting message count for date: ${date}`);

        // Get actual WhatsApp messages to be sent for the date
        const whatsappMessages = await getWhatsAppMessages(date);

        // Get existing message statuses for this date
        let existingMessages = [];
        try {
            const statusResult = await messagingQueries.getMessageStatusByDate(date);
            if (statusResult && statusResult.messages) {
                existingMessages = statusResult.messages;
            }
        } catch (msgError) {
            log.warn('Could not get existing message statuses:', msgError.message);
            // Continue without existing message data
        }

        // Delegate to service layer for count calculation
        const messageCount = calculateMessageCount(whatsappMessages, existingMessages);
        messageCount.date = date;

        log.info(`Message count for ${date}:`, messageCount);

        res.json({
            success: true,
            data: messageCount,
            timestamp: Date.now()
        });

    } catch (error) {
        log.error('Error getting message count:', error);
        return ErrorResponses.internalError(res, error.message, error);
    }
});

/**
 * Reset messaging status for a specific date
 * Calls the ResetMessagingForDate stored procedure
 */
router.post('/reset/:date', async (req, res) => {
    try {
        const { date } = req.params;
        log.info(`Resetting messaging for date: ${date}`);

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

                log.info(`Reset completed for ${date}:`, resetStats);
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
        log.error('Error resetting messaging:', error);
        return ErrorResponses.internalError(res, 'Failed to reset messaging status', error);
    }
});

/**
 * Get detailed message information for a specific date
 * Returns both potential messages and existing message statuses
 */
router.get('/details/:date', async (req, res) => {
    try {
        const { date } = req.params;
        log.info(`Getting message details for date: ${date}`);

        // Get WhatsApp messages to be sent for the date
        const whatsappMessages = await getWhatsAppMessages(date);

        // Get existing message statuses
        let existingMessages = [];
        try {
            const messageStatuses = await messagingQueries.getMessageStatusByDate(date);
            if (messageStatuses && messageStatuses.messages) {
                existingMessages = messageStatuses.messages;
            }
        } catch (msgError) {
            log.warn('Could not get message statuses for details:', msgError.message);
        }

        // Delegate to service layer for multi-source coordination and summary
        const result = getMessageDetails(date, whatsappMessages, existingMessages);

        res.json({
            success: true,
            data: result,
            timestamp: Date.now()
        });

    } catch (error) {
        log.error('Error getting message details:', error);
        return ErrorResponses.internalError(res, error.message, error);
    }
});

export default router;
