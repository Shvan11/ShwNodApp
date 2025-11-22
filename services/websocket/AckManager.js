/**
 * ACK Manager - Message Acknowledgment and Sequence Number Management
 *
 * Provides guaranteed message delivery through:
 * 1. Acknowledgment protocol (clients must confirm receipt)
 * 2. Automatic retry mechanism (up to 3 attempts)
 * 3. Sequence numbers for detecting missed/out-of-order messages
 * 4. Sliding window buffer for event replay
 *
 * PHASE 1 ENHANCEMENT for 99.5%+ reliability
 */

import { logger } from '../core/Logger.js';
import { createStandardMessage, WebSocketEvents } from '../messaging/websocket-events.js';

/**
 * Message requiring acknowledgment
 */
class PendingMessage {
    constructor(messageId, message, ws, sequenceNum) {
        this.messageId = messageId;
        this.message = message;
        this.ws = ws;
        this.sequenceNum = sequenceNum;
        this.sentAt = Date.now();
        this.attempts = 1;
        this.maxAttempts = 3;
        this.timeout = null;
        this.ackTimeoutMs = 5000; // 5 seconds
    }

    /**
     * Check if message has exceeded max retry attempts
     */
    hasExceededMaxAttempts() {
        return this.attempts >= this.maxAttempts;
    }

    /**
     * Increment retry counter
     */
    incrementAttempts() {
        this.attempts++;
    }

    /**
     * Clear pending timeout
     */
    clearTimeout() {
        if (this.timeout) {
            clearTimeout(this.timeout);
            this.timeout = null;
        }
    }
}

/**
 * ACK Manager - Handles message acknowledgments and sequence numbers
 */
export class AckManager {
    constructor() {
        // Map of messageId -> PendingMessage
        this.pendingMessages = new Map();

        // Map of date -> sequence number for appointment events
        this.sequenceCounters = new Map();

        // Sliding window buffer: date -> array of last 100 events
        this.eventBuffers = new Map();
        this.maxBufferSize = 100;

        // Message ID counter
        this.messageIdCounter = 0;

        // Statistics
        this.stats = {
            messagesSent: 0,
            messagesAcked: 0,
            messagesRetried: 0,
            messagesFailed: 0,
            averageAckTimeMs: 0
        };
    }

    /**
     * Generate unique message ID
     */
    generateMessageId() {
        return `msg_${Date.now()}_${++this.messageIdCounter}`;
    }

    /**
     * Get next sequence number for a date
     */
    getNextSequenceNumber(date) {
        const currentSeq = this.sequenceCounters.get(date) || 0;
        const nextSeq = currentSeq + 1;
        this.sequenceCounters.set(date, nextSeq);
        return nextSeq;
    }

    /**
     * Get current sequence number for a date (without incrementing)
     */
    getCurrentSequenceNumber(date) {
        return this.sequenceCounters.get(date) || 0;
    }

    /**
     * Add event to sliding window buffer
     */
    addToEventBuffer(date, event) {
        if (!this.eventBuffers.has(date)) {
            this.eventBuffers.set(date, []);
        }

        const buffer = this.eventBuffers.get(date);
        buffer.push(event);

        // Keep only last maxBufferSize events
        if (buffer.length > this.maxBufferSize) {
            buffer.shift();
        }
    }

    /**
     * Get events from buffer within sequence range
     */
    getEventsFromBuffer(date, fromSeq, toSeq = null) {
        const buffer = this.eventBuffers.get(date);
        if (!buffer) return [];

        const endSeq = toSeq || this.getCurrentSequenceNumber(date);

        return buffer.filter(event =>
            event.sequenceNum >= fromSeq && event.sequenceNum <= endSeq
        );
    }

    /**
     * Send message with ACK requirement
     * Returns promise that resolves when ACK is received or rejects on max retries
     */
    async sendWithAck(ws, message, date = null) {
        if (!ws || ws.readyState !== ws.OPEN) {
            throw new Error('WebSocket is not open');
        }

        const messageId = this.generateMessageId();
        let sequenceNum = null;

        // Add sequence number for appointment events
        if (date && message.type === WebSocketEvents.APPOINTMENTS_UPDATED) {
            sequenceNum = this.getNextSequenceNumber(date);
            message.sequenceNum = sequenceNum;
            message.date = date;

            // Add to event buffer
            this.addToEventBuffer(date, {
                sequenceNum,
                messageId,
                timestamp: Date.now(),
                data: message.data
            });
        }

        // Add message ID
        message.id = messageId;
        message.requiresAck = true;

        // Create pending message
        const pendingMessage = new PendingMessage(messageId, message, ws, sequenceNum);
        this.pendingMessages.set(messageId, pendingMessage);

        // Send message
        this._sendMessage(ws, message);
        this.stats.messagesSent++;

        // Schedule ACK timeout
        return this._scheduleAckTimeout(pendingMessage);
    }

    /**
     * Send message without waiting for ACK (fire-and-forget)
     */
    send(ws, message) {
        if (!ws || ws.readyState !== ws.OPEN) {
            return false;
        }

        this._sendMessage(ws, message);
        return true;
    }

    /**
     * Broadcast message to multiple clients with ACK tracking
     */
    async broadcastWithAck(clients, message, date = null) {
        const promises = [];

        for (const ws of clients) {
            if (ws.readyState !== ws.OPEN) continue;

            promises.push(
                this.sendWithAck(ws, { ...message }, date).catch(error => {
                    logger.websocket.error('Broadcast ACK failed for client', error);
                    return null; // Don't fail entire broadcast
                })
            );
        }

        const results = await Promise.allSettled(promises);
        const successCount = results.filter(r => r.status === 'fulfilled' && r.value !== null).length;

        logger.websocket.debug(`Broadcast completed: ${successCount}/${clients.length} clients acknowledged`);
        return successCount;
    }

    /**
     * Handle ACK received from client
     */
    handleAck(messageId) {
        const pendingMessage = this.pendingMessages.get(messageId);
        if (!pendingMessage) {
            logger.websocket.debug('Received ACK for unknown message', { messageId });
            return false;
        }

        // Clear timeout
        pendingMessage.clearTimeout();

        // Calculate ACK time
        const ackTimeMs = Date.now() - pendingMessage.sentAt;

        // Update statistics
        this.stats.messagesAcked++;
        this.stats.averageAckTimeMs =
            (this.stats.averageAckTimeMs * (this.stats.messagesAcked - 1) + ackTimeMs) /
            this.stats.messagesAcked;

        // Remove from pending
        this.pendingMessages.delete(messageId);

        logger.websocket.debug('Message acknowledged', {
            messageId,
            ackTimeMs,
            attempts: pendingMessage.attempts
        });

        return true;
    }

    /**
     * Handle client requesting missed events
     */
    handleMissedEventsRequest(ws, date, lastSeqNum) {
        const currentSeq = this.getCurrentSequenceNumber(date);

        if (lastSeqNum >= currentSeq) {
            // Client is up to date
            this.send(ws, createStandardMessage(WebSocketEvents.APPOINTMENTS_UPDATED, {
                date,
                sequenceNum: currentSeq,
                upToDate: true
            }));
            return;
        }

        // Get missed events from buffer
        const missedEvents = this.getEventsFromBuffer(date, lastSeqNum + 1, currentSeq);

        if (missedEvents.length === 0) {
            // Buffer doesn't have the events, client needs full refresh
            logger.websocket.warn('Client missed events outside buffer range', {
                date,
                lastSeqNum,
                currentSeq
            });

            this.send(ws, createStandardMessage(WebSocketEvents.APPOINTMENTS_UPDATED, {
                date,
                sequenceNum: currentSeq,
                fullRefreshRequired: true,
                reason: 'events_outside_buffer'
            }));
            return;
        }

        // Send missed events
        logger.websocket.info('Sending missed events to client', {
            date,
            missedCount: missedEvents.length,
            fromSeq: lastSeqNum + 1,
            toSeq: currentSeq
        });

        for (const event of missedEvents) {
            this.send(ws, createStandardMessage(WebSocketEvents.APPOINTMENTS_UPDATED, {
                date,
                sequenceNum: event.sequenceNum,
                ...event.data,
                isReplay: true
            }));
        }
    }

    /**
     * Internal: Send message via WebSocket
     */
    _sendMessage(ws, message) {
        try {
            ws.send(JSON.stringify(message));
        } catch (error) {
            logger.websocket.error('Failed to send message', error);
            throw error;
        }
    }

    /**
     * Internal: Schedule ACK timeout and retry logic
     */
    _scheduleAckTimeout(pendingMessage) {
        return new Promise((resolve, reject) => {
            const attemptRetry = () => {
                if (pendingMessage.hasExceededMaxAttempts()) {
                    // Max attempts reached, fail
                    this.stats.messagesFailed++;
                    this.pendingMessages.delete(pendingMessage.messageId);

                    logger.websocket.error('Message failed after max retries', {
                        messageId: pendingMessage.messageId,
                        attempts: pendingMessage.attempts
                    });

                    reject(new Error(`Message ${pendingMessage.messageId} failed after ${pendingMessage.attempts} attempts`));
                    return;
                }

                // Retry
                if (pendingMessage.ws.readyState !== pendingMessage.ws.OPEN) {
                    // WebSocket closed, fail immediately
                    this.stats.messagesFailed++;
                    this.pendingMessages.delete(pendingMessage.messageId);
                    reject(new Error('WebSocket closed during retry'));
                    return;
                }

                pendingMessage.incrementAttempts();
                this.stats.messagesRetried++;

                logger.websocket.warn('Retrying message', {
                    messageId: pendingMessage.messageId,
                    attempt: pendingMessage.attempts
                });

                this._sendMessage(pendingMessage.ws, pendingMessage.message);

                // Schedule next timeout
                pendingMessage.timeout = setTimeout(attemptRetry, pendingMessage.ackTimeoutMs);
            };

            // Check if already acknowledged (race condition)
            if (!this.pendingMessages.has(pendingMessage.messageId)) {
                resolve();
                return;
            }

            // Override the promise resolution in handleAck
            const originalHandleAck = this.handleAck.bind(this);
            const messageId = pendingMessage.messageId;

            this.handleAck = (id) => {
                const result = originalHandleAck(id);
                if (result && id === messageId) {
                    resolve();
                }
                return result;
            };

            // Schedule first timeout
            pendingMessage.timeout = setTimeout(attemptRetry, pendingMessage.ackTimeoutMs);
        });
    }

    /**
     * Clean up resources for a specific client
     */
    cleanupClient(ws) {
        // Remove pending messages for this client
        for (const [messageId, pendingMessage] of this.pendingMessages.entries()) {
            if (pendingMessage.ws === ws) {
                pendingMessage.clearTimeout();
                this.pendingMessages.delete(messageId);
            }
        }
    }

    /**
     * Get statistics
     */
    getStats() {
        return {
            ...this.stats,
            pendingMessages: this.pendingMessages.size,
            eventBuffers: this.eventBuffers.size
        };
    }

    /**
     * Clear old event buffers (cleanup task)
     */
    clearOldBuffers(maxAgeMs = 24 * 60 * 60 * 1000) { // 24 hours default
        const now = Date.now();
        const datesToRemove = [];

        for (const [date, buffer] of this.eventBuffers.entries()) {
            if (buffer.length === 0) continue;

            const latestEvent = buffer[buffer.length - 1];
            if (now - latestEvent.timestamp > maxAgeMs) {
                datesToRemove.push(date);
            }
        }

        for (const date of datesToRemove) {
            this.eventBuffers.delete(date);
            this.sequenceCounters.delete(date);
            logger.websocket.debug('Cleared old event buffer', { date });
        }

        return datesToRemove.length;
    }
}

export default AckManager;
