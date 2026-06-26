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


/**
 * Message status codes
 * - 0: Not Sent Yet (sent_wa IS NULL — never attempted)
 * - 5: Ready to Resend (sent_wa = 0 — explicitly reset)
 * - -1: Error/Failed
 * - 1: Server (received by WhatsApp server)
 * - 2: Device (delivered to user's device)
 * - 3: Read (read by user)
 * - 4: Played (voice message played)
 */
export type MessageStatusCode = -1 | 0 | 1 | 2 | 3 | 4 | 5;

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
  sentStatus: boolean | null;
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
  originalSentStatus: boolean | null;
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
 * WhatsApp messages format: [numbers, messages, ids, names]
 */
export type WhatsAppMessagesArray = [string[], string[], string[], string[]];

/**
 * Transform message status from database format to frontend format
 *
 * Database format: sentStatus (boolean | null) + deliveryStatus (string)
 * Frontend format: numeric status code
 *
 * status mapping:
 * - 0: Not Sent Yet (sent_wa IS NULL — fresh appointment)
 * - 5: Ready to Resend (sent_wa = 0 — explicitly reset)
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
  let status: MessageStatusCode = 0;

  if (msg.sentStatus === null || msg.sentStatus === undefined) {
    // Never attempted to send
    status = 0;
  } else if (msg.sentStatus === false) {
    // Explicitly reset — ready to resend
    status = 5;
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

  // Count existing message statuses. status 5 (reset/ready) is treated as pending,
  // not as sent — it needs to be re-sent.
  if (Array.isArray(existingMessages) && existingMessages.length > 0) {
    messageCount.alreadySent = existingMessages.filter(
      (m) => m.status >= 1 && m.status !== 5
    ).length;
    messageCount.pending = existingMessages.filter(
      (m) => m.status === 0 || m.status === 5
    ).length;
  }

  return messageCount;
}

export default {
  transformMessageStatus,
  transformMessageStatuses,
  calculateMessageCount,
};
