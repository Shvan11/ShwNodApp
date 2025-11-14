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
import * as database from '../../services/database/index.js';
import * as messagingQueries from '../../services/database/queries/messaging-queries.js';
import { getWhatsAppMessages } from '../../services/database/queries/messaging-queries.js';
import messageState from '../../services/state/messageState.js';
import whatsapp from '../../services/messaging/whatsapp.js';
import { WebSocketEvents, createStandardMessage } from '../../services/messaging/websocket-events.js';
import { sendError, ErrorResponses } from '../../utils/error-response.js';

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
        console.error('Error in batch status update:', error);
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
        return ErrorResponses.internalError(res, error.message, error);
    }
});

export default router;
