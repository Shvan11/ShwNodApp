// services/messaging/schemas.ts
/**
 * Message schemas and validation for WhatsApp system
 */
import { WebSocketEvents } from './websocket-events.js';

/**
 * Message status constants
 */
export const MessageStatus = {
  PENDING: 0,
  SERVER: 1,
  DEVICE: 2,
  READ: 3,
  PLAYED: 4,
  ERROR: -1,
} as const;

export type MessageStatusType = (typeof MessageStatus)[keyof typeof MessageStatus];

/**
 * WebSocket message type constants
 */
export const WebSocketMessageTypes = {
  QR_UPDATE: WebSocketEvents.WHATSAPP_QR_UPDATED,
  CLIENT_READY: WebSocketEvents.WHATSAPP_CLIENT_READY,
  MESSAGE_STATUS: WebSocketEvents.WHATSAPP_MESSAGE_STATUS,
  BATCH_STATUS: WebSocketEvents.WHATSAPP_MESSAGE_BATCH_STATUS,
  ERROR: WebSocketEvents.SYSTEM_ERROR,
  PING: WebSocketEvents.HEARTBEAT_PING,
  PONG: WebSocketEvents.HEARTBEAT_PONG,
} as const;

export type WebSocketMessageType = (typeof WebSocketMessageTypes)[keyof typeof WebSocketMessageTypes];

/**
 * Message schemas export
 */
export const MessageSchemas = {
  WebSocketMessage: WebSocketMessageTypes,
  MessageStatus,
};

/**
 * WebSocket message interface
 */
export interface WebSocketMessage {
  type: string;
  data?: Record<string, unknown>;
  timestamp?: number;
  id?: string;
  source?: string;
  version?: string;
  correlationId?: string;
  // Index signature for additional dynamic properties
  [key: string]: unknown;
}

/**
 * Validation result interface
 */
interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Generate a unique message ID
 */
function generateMessageId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 11);
  return `msg_${timestamp}_${random}`;
}

/**
 * Create standardized WebSocket message
 */
export function createWebSocketMessage(
  type: string,
  data: Record<string, unknown> = {},
  metadata: Record<string, unknown> = {}
): WebSocketMessage {
  return {
    type,
    data,
    timestamp: Date.now(),
    id: generateMessageId(),
    ...metadata,
  };
}

/**
 * Enhanced validate WebSocket message format with comprehensive security checks
 */
export function validateWebSocketMessage(message: unknown): ValidationResult {
  // Basic type validation
  if (!message || typeof message !== 'object') {
    return { valid: false, error: 'Message must be an object' };
  }

  const msg = message as Record<string, unknown>;

  // Prevent prototype pollution
  if (
    Object.prototype.hasOwnProperty.call(msg, '__proto__') ||
    Object.prototype.hasOwnProperty.call(msg, 'constructor') ||
    Object.prototype.hasOwnProperty.call(msg, 'prototype')
  ) {
    return { valid: false, error: 'Message contains forbidden properties' };
  }

  // Check for required type field
  if (!msg.type) {
    return { valid: false, error: 'Message missing type field' };
  }

  // Type validation - must be string
  if (typeof msg.type !== 'string' || msg.type.length === 0) {
    return { valid: false, error: 'Message type must be a non-empty string' };
  }

  // Validate type against known types
  const validTypes: string[] = [
    ...Object.values(MessageSchemas.WebSocketMessage),
    ...Object.values(WebSocketEvents),
  ];

  if (!validTypes.includes(msg.type as string)) {
    return { valid: false, error: `Unknown message type: ${msg.type}` };
  }

  // Allow messages without data field for simple ping/pong and other control messages
  const simpleMessageTypes = [
    WebSocketEvents.HEARTBEAT_PING,
    WebSocketEvents.HEARTBEAT_PONG,
    'heartbeat',
    'ack',
  ];

  if (simpleMessageTypes.includes(msg.type as string)) {
    // Simple messages don't require data or timestamp
    return { valid: true };
  }

  // For other message types, require data but make timestamp optional
  if (msg.data === undefined || msg.data === null) {
    return { valid: false, error: 'Message missing data field' };
  }

  // Validate data field is an object for complex messages
  if (typeof msg.data !== 'object') {
    return { valid: false, error: 'Message data must be an object' };
  }

  // Validate timestamp if present
  if (
    msg.timestamp !== undefined &&
    (typeof msg.timestamp !== 'number' || msg.timestamp <= 0)
  ) {
    return { valid: false, error: 'Message timestamp must be a positive number' };
  }

  // Validate id if present
  if (msg.id !== undefined && typeof msg.id !== 'string') {
    return { valid: false, error: 'Message id must be a string' };
  }

  return { valid: true };
}

/**
 * Normalize WebSocket message - ensures all messages have consistent structure
 */
export function normalizeWebSocketMessage(message: unknown): WebSocketMessage | null {
  if (!message || typeof message !== 'object') {
    return null;
  }

  const msg = message as Record<string, unknown>;

  // Ensure basic structure
  const normalized: WebSocketMessage = {
    type: msg.type as string,
    data: (msg.data as Record<string, unknown>) || {},
    timestamp: (msg.timestamp as number) || Date.now(),
    id: (msg.id as string) || generateMessageId(),
  };

  // Copy any additional properties
  Object.keys(msg).forEach((key) => {
    if (!['type', 'data', 'timestamp', 'id'].includes(key)) {
      normalized[key] = msg[key];
    }
  });

  return normalized;
}

/**
 * Sanitize message data to prevent XSS and other attacks
 */
export function sanitizeMessageData(
  data: unknown
): Record<string, unknown> | unknown {
  if (typeof data !== 'object' || data === null) {
    return data;
  }

  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    // Skip dangerous properties
    if (['__proto__', 'constructor', 'prototype'].includes(key)) {
      continue;
    }

    if (typeof value === 'string') {
      // Basic HTML/script tag sanitization
      sanitized[key] = value
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
        .replace(/javascript:/gi, '')
        .replace(/on\w+\s*=/gi, '');
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeMessageData(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Create a simple control message (ping, pong, etc.)
 */
export function createControlMessage(
  type: string,
  additionalData: Record<string, unknown> = {}
): WebSocketMessage {
  return {
    type,
    ...additionalData,
    timestamp: Date.now(),
  };
}

/**
 * Validate message type against known types
 */
export function isValidMessageType(type: string): boolean {
  const allTypes: string[] = [
    ...Object.values(MessageSchemas.WebSocketMessage),
    ...Object.values(WebSocketEvents),
  ];

  return allTypes.includes(type);
}
