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

import { Router, type Request, type Response } from 'express';
import type { EventEmitter } from 'events';
import { log } from '../../utils/logger.js';
import * as database from '../../services/database/index.js';
import * as messagingQueries from '../../services/database/queries/messaging-queries.js';
import { getWhatsAppMessages } from '../../services/database/queries/messaging-queries.js';
import { ErrorResponses } from '../../utils/error-response.js';
import {
  transformMessageStatuses,
  calculateMessageCount,
  getMessageDetails
} from '../../services/business/MessagingService.js';

const router = Router();

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface DateParams {
  date: string;
}

interface BatchStatusUpdate {
  appointmentId: number;
  status: string;
  messageId?: string;
  error?: string;
}

/**
 * StatusUpdateMessage compatible with messaging-queries.ts
 */
interface StatusUpdateMessage {
  id: number;
  ack: number;
  whatsappMessageId?: string;
}

/**
 * Message status from database query result
 */
interface DatabaseMessageStatus {
  appointmentId: number;
  patientName: string;
  phone: string;
  sentStatus: boolean;
  deliveryStatus: string | null;
  messageId: string | null;
  sentTimestamp: Date | null;
  lastUpdated: Date | null;
}

/**
 * WhatsApp messages array type: [numbers, messages, ids, names]
 * Note: ids are numbers from the database
 */
type WhatsAppMessagesResult = [string[], string[], number[], string[]];

interface BatchStatusUpdateBody {
  updates: BatchStatusUpdate[];
}

interface ResetResult {
  resetDate: string;
  totalAppointments: number;
  readyForWhatsApp: number;
  readyForSMS: number;
  alreadySentWA: number;
  alreadyNotified: number;
  appointmentsReset: number;
  smsRecordsReset: number;
  [key: string]: string | number; // Index signature for Record<string, unknown> compatibility
}

/**
 * Convert string status to numeric ack code for messaging-queries compatibility
 */
function statusToAck(status: string): number {
  switch (status.toUpperCase()) {
    case 'ERROR':
      return -1;
    case 'PENDING':
      return 0;
    case 'SERVER':
      return 1;
    case 'DEVICE':
      return 2;
    case 'READ':
      return 3;
    case 'PLAYED':
      return 4;
    default:
      return 0;
  }
}

/**
 * Convert BatchStatusUpdate to StatusUpdateMessage for messaging-queries compatibility
 */
function convertToStatusUpdateMessage(update: BatchStatusUpdate): StatusUpdateMessage {
  return {
    id: update.appointmentId,
    ack: statusToAck(update.status),
    whatsappMessageId: update.messageId
  };
}

/**
 * Convert DatabaseMessageStatus to DatabaseMessage for MessagingService compatibility
 */
function convertToDatabaseMessage(msg: DatabaseMessageStatus): import('../../services/business/MessagingService.js').DatabaseMessage {
  return {
    sentStatus: msg.sentStatus,
    deliveryStatus: msg.deliveryStatus as import('../../services/business/MessagingService.js').DeliveryStatus,
    patientName: msg.patientName,
    phone: msg.phone,
    sentTimestamp: msg.sentTimestamp?.toISOString() ?? '',
    messageId: msg.messageId ?? '',
    appointmentId: msg.appointmentId
  };
}

/**
 * Convert WhatsApp messages result (with number[] ids) to WhatsAppMessagesArray (with string[] ids)
 */
function convertWhatsAppMessagesResult(
  result: WhatsAppMessagesResult
): import('../../services/business/MessagingService.js').WhatsAppMessagesArray {
  const [numbers, messages, ids, names] = result;
  return [numbers, messages, ids.map(String), names];
}

// WebSocket emitter will be injected to avoid circular imports
let wsEmitter: EventEmitter | null = null;

/**
 * Set the WebSocket emitter reference
 * @param emitter - WebSocket event emitter
 */
export function setWebSocketEmitter(emitter: EventEmitter): void {
  wsEmitter = emitter;
}

/**
 * Circuit breaker status for messaging operations
 */
router.get(
  '/circuit-breaker-status',
  (_req: Request, res: Response): void => {
    try {
      const status = messagingQueries.getCircuitBreakerStatus();
      res.json({
        success: true,
        ...status
      });
    } catch (error) {
      ErrorResponses.internalError(res, (error as Error).message, error as Error);
    }
  }
);

/**
 * Reset circuit breaker (manual recovery)
 */
router.post(
  '/reset-circuit-breaker',
  (_req: Request, res: Response): void => {
    try {
      const result = messagingQueries.resetCircuitBreaker();
      res.json(result);
    } catch (error) {
      ErrorResponses.internalError(res, (error as Error).message, error as Error);
    }
  }
);

/**
 * Batch status update endpoint
 */
router.post(
  '/batch-status-update',
  async (
    req: Request<unknown, unknown, BatchStatusUpdateBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { updates } = req.body;

      if (!updates || !Array.isArray(updates)) {
        ErrorResponses.badRequest(res, 'Updates array is required');
        return;
      }

      // Convert BatchStatusUpdate[] to StatusUpdateMessage[] for messaging-queries compatibility
      const statusUpdates = updates.map(convertToStatusUpdateMessage);
      const result = await messagingQueries.batchUpdateMessageStatuses(
        statusUpdates,
        wsEmitter
      );
      res.json(result);
    } catch (error) {
      log.error('Error in batch status update:', error);
      ErrorResponses.internalError(res, (error as Error).message, error as Error);
    }
  }
);

/**
 * Get message status by date
 */
router.get(
  '/status/:date',
  async (req: Request<DateParams>, res: Response): Promise<void> => {
    try {
      const { date } = req.params;
      const result = await messagingQueries.getMessageStatusByDate(date);

      // Delegate to service layer for status transformation
      // Convert database message format to service layer format
      if (result && result.messages) {
        const dbMessages = (result.messages as DatabaseMessageStatus[]).map(convertToDatabaseMessage);
        const transformedMessages = transformMessageStatuses(dbMessages);
        res.json({
          ...result,
          messages: transformedMessages
        });
        return;
      }

      res.json(result);
    } catch (error) {
      log.error('Error getting message status:', error);
      ErrorResponses.internalError(res, (error as Error).message, error as Error);
    }
  }
);

/**
 * Get message count for a specific date
 * Returns how many appointments are scheduled and eligible for messaging
 */
router.get(
  '/count/:date',
  async (req: Request<DateParams>, res: Response): Promise<void> => {
    try {
      const { date } = req.params;
      log.info(`Getting message count for date: ${date}`);

      // Get actual WhatsApp messages to be sent for the date
      const whatsappMessagesResult = await getWhatsAppMessages(date);
      // Convert number[] ids to string[] for WhatsAppMessagesArray compatibility
      const whatsappMessages = convertWhatsAppMessagesResult(whatsappMessagesResult);

      // Get existing message statuses for this date
      let existingMessages: import('../../services/business/MessagingService.js').TransformedMessage[] = [];
      try {
        const statusResult = await messagingQueries.getMessageStatusByDate(date);
        if (statusResult && statusResult.messages) {
          // Convert database format to service format and transform
          const dbMessages = (statusResult.messages as DatabaseMessageStatus[]).map(convertToDatabaseMessage);
          existingMessages = transformMessageStatuses(dbMessages);
        }
      } catch (msgError) {
        log.warn(
          'Could not get existing message statuses:',
          (msgError as Error).message
        );
        // Continue without existing message data
      }

      // Delegate to service layer for count calculation
      const messageCount = calculateMessageCount(whatsappMessages, existingMessages);
      (messageCount as { date?: string }).date = date;

      log.info(`Message count for ${date}:`, messageCount);

      res.json({
        success: true,
        data: messageCount,
        timestamp: Date.now()
      });
    } catch (error) {
      log.error('Error getting message count:', error);
      ErrorResponses.internalError(res, (error as Error).message, error as Error);
    }
  }
);

/**
 * Reset messaging status for a specific date
 * Calls the ResetMessagingForDate stored procedure
 */
router.post(
  '/reset/:date',
  async (req: Request<DateParams>, res: Response): Promise<void> => {
    try {
      const { date } = req.params;
      log.info(`Resetting messaging for date: ${date}`);

      // Execute the stored procedure
      const result = await database.executeStoredProcedure<ResetResult | null, ResetResult>(
        'ResetMessagingForDate',
        [['ResetDate', database.TYPES.Date, date]],
        undefined,
        (columns) => {
          // Map the result columns
          if (columns.length >= 7) {
            return {
              resetDate: columns[0].value as string,
              totalAppointments: columns[1].value as number,
              readyForWhatsApp: columns[2].value as number,
              readyForSMS: columns[3].value as number,
              alreadySentWA: columns[4].value as number,
              alreadyNotified: columns[5].value as number,
              appointmentsReset: columns[6].value as number,
              smsRecordsReset: (columns[7]?.value as number) || 0
            };
          }
          return null;
        },
        (result) => {
          // Filter out null values and get the first valid result
          const validResults = result.filter((r): r is ResetResult => r !== null);
          const resetStats: ResetResult =
            validResults.length > 0
              ? validResults[0]
              : {
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
      ErrorResponses.internalError(
        res,
        'Failed to reset messaging status',
        error as Error
      );
    }
  }
);

/**
 * Get detailed message information for a specific date
 * Returns both potential messages and existing message statuses
 */
router.get(
  '/details/:date',
  async (req: Request<DateParams>, res: Response): Promise<void> => {
    try {
      const { date } = req.params;
      log.info(`Getting message details for date: ${date}`);

      // Get WhatsApp messages to be sent for the date
      const whatsappMessagesResult = await getWhatsAppMessages(date);
      // Convert number[] ids to string[] for WhatsAppMessagesArray compatibility
      const whatsappMessages = convertWhatsAppMessagesResult(whatsappMessagesResult);

      // Get existing message statuses
      let existingMessages: import('../../services/business/MessagingService.js').TransformedMessage[] = [];
      try {
        const messageStatuses = await messagingQueries.getMessageStatusByDate(date);
        if (messageStatuses && messageStatuses.messages) {
          // Convert database format to service format and transform
          const dbMessages = (messageStatuses.messages as DatabaseMessageStatus[]).map(convertToDatabaseMessage);
          existingMessages = transformMessageStatuses(dbMessages);
        }
      } catch (msgError) {
        log.warn(
          'Could not get message statuses for details:',
          (msgError as Error).message
        );
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
      ErrorResponses.internalError(res, (error as Error).message, error as Error);
    }
  }
);

export default router;
