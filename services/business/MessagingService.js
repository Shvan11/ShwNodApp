/**
 * Messaging Service - Business Logic Layer
 *
 * This service handles all messaging business logic including:
 * - Message status transformation from database to frontend format
 * - Message count calculations
 * - Multi-source data coordination (messages to send + existing statuses)
 * - Summary statistics calculations
 *
 * This layer sits between route handlers and database queries,
 * encapsulating transformation and aggregation logic.
 */

import { log } from '../../utils/logger.js';

/**
 * Transform message status from database format to frontend format
 *
 * Database format: sentStatus (boolean) + deliveryStatus (string)
 * Frontend format: numeric status code
 *
 * Status mapping:
 * - 0: Pending (not sent yet)
 * - -1: Error/Failed
 * - 1: Server (received by WhatsApp server)
 * - 2: Device (delivered to user's device)
 * - 3: Read (read by user)
 * - 4: Played (voice message played)
 *
 * @param {Object} msg - Message object from database
 * @param {boolean} msg.sentStatus - Whether message was sent
 * @param {string} msg.deliveryStatus - Delivery status (ERROR, SERVER, DEVICE, READ, PLAYED)
 * @param {string} msg.patientName - Patient name
 * @param {string} msg.phone - Phone number
 * @param {string} msg.sentTimestamp - When message was sent
 * @param {string} msg.messageId - Message ID
 * @returns {Object} Transformed message with numeric status
 */
export function transformMessageStatus(msg) {
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
        status = 1;
    } else if (msg.deliveryStatus === 'DEVICE') {
        // Delivered to user's device
        status = 2;
    } else if (msg.deliveryStatus === 'read' || msg.deliveryStatus === 'READ') {
        // Read by user
        status = 3;
    } else if (msg.deliveryStatus === 'PLAYED') {
        // Voice message played
        status = 4;
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
}

/**
 * Transform array of message statuses
 * @param {Array<Object>} messages - Array of messages from database
 * @returns {Array<Object>} Transformed messages
 */
export function transformMessageStatuses(messages) {
    if (!Array.isArray(messages)) {
        return [];
    }
    return messages.map(transformMessageStatus);
}

/**
 * Calculate message count statistics for a date
 *
 * Combines data from WhatsApp messages (to be sent) and existing message statuses
 *
 * @param {Array} whatsappMessages - Array of [numbers, messages, ids, names] from getWhatsAppMessages
 * @param {Array<Object>} existingMessages - Existing message statuses
 * @returns {Object} Message count statistics
 */
export function calculateMessageCount(whatsappMessages, existingMessages = []) {
    // whatsappMessages format: [numbers, messages, ids, names]
    const [numbers = [], messages = [], ids = [], names = []] = whatsappMessages || [[], [], [], []];

    const messageCount = {
        totalMessages: numbers.length,
        eligibleForMessaging: numbers.length,
        alreadySent: 0,
        pending: 0
    };

    // Count existing message statuses
    if (Array.isArray(existingMessages) && existingMessages.length > 0) {
        messageCount.alreadySent = existingMessages.filter(m => m.status >= 1).length;
        messageCount.pending = existingMessages.filter(m => m.status === 0).length;
    }

    return messageCount;
}

/**
 * Calculate message summary statistics
 *
 * Aggregates message status counts for dashboard/summary views
 *
 * @param {Array<Object>} messages - Array of messages with numeric status
 * @returns {Object} Summary statistics
 */
export function calculateMessageSummary(messages) {
    const summary = {
        messagesSent: 0,
        messagesDelivered: 0,
        messagesFailed: 0,
        messagesPending: 0
    };

    if (!Array.isArray(messages)) {
        return summary;
    }

    messages.forEach(msg => {
        if (msg.status === 0) {
            summary.messagesPending++;
        } else if (msg.status === 1) {
            summary.messagesSent++;
        } else if (msg.status >= 2) {
            summary.messagesDelivered++;
        } else if (msg.status === -1) {
            summary.messagesFailed++;
        }
    });

    return summary;
}

/**
 * Convert WhatsApp message arrays to objects
 *
 * WhatsApp messages come as parallel arrays: [numbers, messages, ids, names]
 * This converts them to an array of objects for easier frontend consumption
 *
 * @param {Array} whatsappMessages - Array of [numbers, messages, ids, names]
 * @returns {Array<Object>} Array of message objects
 */
export function formatMessagesToSend(whatsappMessages) {
    const [numbers = [], messages = [], ids = [], names = []] = whatsappMessages || [[], [], [], []];

    if (numbers.length === 0) {
        return [];
    }

    return numbers.map((number, index) => ({
        id: ids[index] || '',
        number: number || '',
        name: names[index] || '',
        message: messages[index] || ''
    }));
}

/**
 * Get message details with multi-source coordination
 *
 * Combines messages to be sent with existing message statuses and calculates summary
 *
 * @param {string} date - Date to get details for
 * @param {Array} whatsappMessages - Messages to be sent from getWhatsAppMessages
 * @param {Array<Object>} existingMessages - Existing message statuses
 * @returns {Object} Detailed message information
 */
export function getMessageDetails(date, whatsappMessages, existingMessages = []) {
    const result = {
        date: date,
        messagesToSend: [],
        existingMessages: existingMessages,
        summary: {
            totalMessages: 0,
            eligibleForMessaging: 0,
            messagesSent: 0,
            messagesDelivered: 0,
            messagesFailed: 0,
            messagesPending: 0
        }
    };

    // Convert WhatsApp messages to objects
    result.messagesToSend = formatMessagesToSend(whatsappMessages);
    result.summary.totalMessages = result.messagesToSend.length;
    result.summary.eligibleForMessaging = result.messagesToSend.length;

    // Calculate summary statistics from existing messages
    const statusSummary = calculateMessageSummary(existingMessages);
    result.summary.messagesSent = statusSummary.messagesSent;
    result.summary.messagesDelivered = statusSummary.messagesDelivered;
    result.summary.messagesFailed = statusSummary.messagesFailed;
    result.summary.messagesPending = statusSummary.messagesPending;

    log.info(`Message details for ${date}: ${result.summary.totalMessages} messages to send, ${result.existingMessages.length} existing messages`);

    return result;
}

export default {
    transformMessageStatus,
    transformMessageStatuses,
    calculateMessageCount,
    calculateMessageSummary,
    formatMessagesToSend,
    getMessageDetails
};
