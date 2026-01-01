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
 * Message status codes
 * - 0: Pending (not sent yet)
 * - -1: Error/Failed
 * - 1: Server (received by WhatsApp server)
 * - 2: Device (delivered to user's device)
 * - 3: Read (read by user)
 * - 4: Played (voice message played)
 */
export type MessageStatusCode = -1 | 0 | 1 | 2 | 3 | 4;

/**
 * Delivery status from database
 */
export type DeliveryStatus =
  | 'ERROR'
  | 'SERVER'
  | 'DEVICE'
  | 'READ'
  | 'read'
  | 'PLAYED'
  | null;

/**
 * Database message format
 */
export interface DatabaseMessage {
  sentStatus: boolean;
  deliveryStatus: DeliveryStatus;
  patientName: string;
  phone: string;
  sentTimestamp: string;
  messageId: string;
  appointmentId?: number;
  message?: string;
  errorMessage?: string;
}

/**
 * Transformed message for frontend
 */
export interface TransformedMessage extends DatabaseMessage {
  status: MessageStatusCode;
  name: string;
  timeSent: string;
  message: string;
  originalSentStatus: boolean;
  originalDeliveryStatus: DeliveryStatus;
}

/**
 * Message count statistics
 */
export interface MessageCount {
  totalMessages: number;
  eligibleForMessaging: number;
  alreadySent: number;
  pending: number;
}

/**
 * Message summary statistics
 */
export interface MessageSummary {
  messagesSent: number;
  messagesDelivered: number;
  messagesFailed: number;
  messagesPending: number;
}

/**
 * WhatsApp messages format: [numbers, messages, ids, names]
 */
export type WhatsAppMessagesArray = [string[], string[], string[], string[]];

/**
 * Message to send object
 */
export interface MessageToSend {
  id: string;
  number: string;
  name: string;
  message: string;
}

/**
 * Full summary statistics
 */
export interface FullSummary extends MessageSummary {
  totalMessages: number;
  eligibleForMessaging: number;
}

/**
 * Message details result
 */
export interface MessageDetails {
  date: string;
  messagesToSend: MessageToSend[];
  existingMessages: TransformedMessage[];
  summary: FullSummary;
}

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
 * @param msg - Message object from database
 * @returns Transformed message with numeric status
 */
export function transformMessageStatus(
  msg: DatabaseMessage
): TransformedMessage {
  // Convert sentStatus (boolean) + deliveryStatus (string) to numeric status
  let status: MessageStatusCode = 0; // Default to pending

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
  } else if (
    msg.deliveryStatus === 'read' ||
    msg.deliveryStatus === 'READ'
  ) {
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
    originalDeliveryStatus: msg.deliveryStatus,
  };
}

/**
 * Transform array of message statuses
 * @param messages - Array of messages from database
 * @returns Transformed messages
 */
export function transformMessageStatuses(
  messages: DatabaseMessage[]
): TransformedMessage[] {
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
 * @param whatsappMessages - Array of [numbers, messages, ids, names] from getWhatsAppMessages
 * @param existingMessages - Existing message statuses
 * @returns Message count statistics
 */
export function calculateMessageCount(
  whatsappMessages: WhatsAppMessagesArray | null,
  existingMessages: TransformedMessage[] = []
): MessageCount {
  // whatsappMessages format: [numbers, messages, ids, names]
  const [numbers = []] = whatsappMessages || [[], [], [], []];

  const messageCount: MessageCount = {
    totalMessages: numbers.length,
    eligibleForMessaging: numbers.length,
    alreadySent: 0,
    pending: 0,
  };

  // Count existing message statuses
  if (Array.isArray(existingMessages) && existingMessages.length > 0) {
    messageCount.alreadySent = existingMessages.filter(
      (m) => m.status >= 1
    ).length;
    messageCount.pending = existingMessages.filter(
      (m) => m.status === 0
    ).length;
  }

  return messageCount;
}

/**
 * Calculate message summary statistics
 *
 * Aggregates message status counts for dashboard/summary views
 *
 * @param messages - Array of messages with numeric status
 * @returns Summary statistics
 */
export function calculateMessageSummary(
  messages: TransformedMessage[]
): MessageSummary {
  const summary: MessageSummary = {
    messagesSent: 0,
    messagesDelivered: 0,
    messagesFailed: 0,
    messagesPending: 0,
  };

  if (!Array.isArray(messages)) {
    return summary;
  }

  messages.forEach((msg) => {
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
 * @param whatsappMessages - Array of [numbers, messages, ids, names]
 * @returns Array of message objects
 */
export function formatMessagesToSend(
  whatsappMessages: WhatsAppMessagesArray | null
): MessageToSend[] {
  const [numbers = [], messages = [], ids = [], names = []] =
    whatsappMessages || [[], [], [], []];

  if (numbers.length === 0) {
    return [];
  }

  return numbers.map((number, index) => ({
    id: ids[index] || '',
    number: number || '',
    name: names[index] || '',
    message: messages[index] || '',
  }));
}

/**
 * Get message details with multi-source coordination
 *
 * Combines messages to be sent with existing message statuses and calculates summary
 *
 * @param date - Date to get details for
 * @param whatsappMessages - Messages to be sent from getWhatsAppMessages
 * @param existingMessages - Existing message statuses
 * @returns Detailed message information
 */
export function getMessageDetails(
  date: string,
  whatsappMessages: WhatsAppMessagesArray | null,
  existingMessages: TransformedMessage[] = []
): MessageDetails {
  const result: MessageDetails = {
    date: date,
    messagesToSend: [],
    existingMessages: existingMessages,
    summary: {
      totalMessages: 0,
      eligibleForMessaging: 0,
      messagesSent: 0,
      messagesDelivered: 0,
      messagesFailed: 0,
      messagesPending: 0,
    },
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

  log.info(
    `Message details for ${date}: ${result.summary.totalMessages} messages to send, ${result.existingMessages.length} existing messages`
  );

  return result;
}

export default {
  transformMessageStatus,
  transformMessageStatuses,
  calculateMessageCount,
  calculateMessageSummary,
  formatMessagesToSend,
  getMessageDetails,
};
