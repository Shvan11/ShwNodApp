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
import { log } from '../../utils/logger.js';
import * as messagingQueries from '../../services/database/queries/messaging-queries.js';
import { getWhatsAppMessages } from '../../services/database/queries/messaging-queries.js';
import { sendSuccess, ErrorResponses } from '../../utils/error-response.js';
import {
  transformMessageStatuses,
  calculateMessageCount
} from '../../services/business/MessagingService.js';

const router = Router();

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface DateParams {
  date: string;
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
 * note: ids are numbers from the database
 */
type WhatsAppMessagesResult = [string[], string[], number[], string[]];

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
        // Envelope the payload (audit M5); the transformed list rides `data.messages`,
        // which the raw APIClient consumer reads via its `data.data.messages` branch.
        sendSuccess(res, {
          ...result,
          messages: transformedMessages
        });
        return;
      }

      sendSuccess(res, result);
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

      // Wire-identical to the previous hand-rolled { success, data, timestamp }
      // envelope (audit H4); the raw whatsapp-api-client consumer's
      // expectedFields:['success','data'] still hold.
      sendSuccess(res, messageCount);
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

      // Reset messaging state for the date (was the ResetMessagingForDate proc).
      const result = await messagingQueries.resetMessagingForDate(date);
      log.info(`Reset completed for ${date}:`, result);

      // Wire-identical to the previous hand-rolled envelope (audit H4).
      sendSuccess(res, result, `Messaging reset completed for ${date}`);
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

export default router;
