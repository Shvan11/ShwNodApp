// services/messaging/schemas.js
/**
 * Message schemas and validation for WhatsApp system
 */
import { WebSocketEvents } from './websocket-events.js';

export const MessageSchemas = {
  // WebSocket message formats - using universal event constants
  WebSocketMessage: {
    QR_UPDATE: WebSocketEvents.WHATSAPP_QR_UPDATED,
    CLIENT_READY: WebSocketEvents.WHATSAPP_CLIENT_READY, 
    MESSAGE_STATUS: WebSocketEvents.WHATSAPP_MESSAGE_STATUS,
    BATCH_STATUS: WebSocketEvents.WHATSAPP_MESSAGE_BATCH_STATUS,
    ERROR: WebSocketEvents.SYSTEM_ERROR,
    PING: WebSocketEvents.HEARTBEAT_PING,
    PONG: WebSocketEvents.HEARTBEAT_PONG
  },

  // Message status constants
  MessageStatus: {
    PENDING: 0,
    SERVER: 1,
    DEVICE: 2,
    READ: 3,
    PLAYED: 4,
    ERROR: -1
  }
};

/**
 * Create standardized WebSocket message
 */
export function createWebSocketMessage(type, data = {}, metadata = {}) {
  return {
    type,
    data,
    timestamp: Date.now(),
    id: generateMessageId(),
    ...metadata
  };
}

/**
 * Enhanced validate WebSocket message format with comprehensive security checks
 */
export function validateWebSocketMessage(message) {
  // Basic type validation
  if (!message || typeof message !== 'object') {
    return { valid: false, error: 'Message must be an object' };
  }
  
  // Prevent prototype pollution
  if (message.hasOwnProperty('__proto__') || 
      message.hasOwnProperty('constructor') || 
      message.hasOwnProperty('prototype')) {
    return { valid: false, error: 'Message contains forbidden properties' };
  }
  
  // Check for required type field
  if (!message.type) {
    return { valid: false, error: 'Message missing type field' };
  }
  
  // Type validation - must be string
  if (typeof message.type !== 'string' || message.type.length === 0) {
    return { valid: false, error: 'Message type must be a non-empty string' };
  }
  
  // Validate type against known types
  const validTypes = [
    ...Object.values(MessageSchemas.WebSocketMessage),
    ...Object.values(WebSocketEvents)
  ];
  
  if (!validTypes.includes(message.type)) {
    return { valid: false, error: `Unknown message type: ${message.type}` };
  }
  
  // Allow messages without data field for simple ping/pong and other control messages
  const simpleMessageTypes = [
    WebSocketEvents.HEARTBEAT_PING, 
    WebSocketEvents.HEARTBEAT_PONG, 
    'heartbeat', 
    'ack'
  ];
  
  if (simpleMessageTypes.includes(message.type)) {
    // Simple messages don't require data or timestamp
    return { valid: true };
  }
  
  // For other message types, require data but make timestamp optional
  if (message.data === undefined || message.data === null) {
    return { valid: false, error: 'Message missing data field' };
  }
  
  // Validate data field is an object for complex messages
  if (typeof message.data !== 'object') {
    return { valid: false, error: 'Message data must be an object' };
  }
  
  // Validate timestamp if present
  if (message.timestamp !== undefined && (typeof message.timestamp !== 'number' || message.timestamp <= 0)) {
    return { valid: false, error: 'Message timestamp must be a positive number' };
  }
  
  // Validate id if present
  if (message.id !== undefined && typeof message.id !== 'string') {
    return { valid: false, error: 'Message id must be a string' };
  }
  
  return { valid: true };
}

/**
 * Normalize WebSocket message - ensures all messages have consistent structure
 */
export function normalizeWebSocketMessage(message) {
  if (!message || typeof message !== 'object') {
    return null;
  }
  
  // Ensure basic structure
  const normalized = {
    type: message.type,
    data: message.data || {},
    timestamp: message.timestamp || Date.now(),
    id: message.id || generateMessageId()
  };
  
  // Copy any additional properties
  Object.keys(message).forEach(key => {
    if (!['type', 'data', 'timestamp', 'id'].includes(key)) {
      normalized[key] = message[key];
    }
  });
  
  return normalized;
}

/**
 * Generate a unique message ID
 */
function generateMessageId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 9);
  return `msg_${timestamp}_${random}`;
}

/**
 * Sanitize message data to prevent XSS and other attacks
 */
export function sanitizeMessageData(data) {
  if (typeof data !== 'object' || data === null) {
    return data;
  }
  
  const sanitized = {};
  
  for (const [key, value] of Object.entries(data)) {
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
export function createControlMessage(type, additionalData = {}) {
  return {
    type,
    ...additionalData,
    timestamp: Date.now()
  };
}

/**
 * Validate message type against known types
 */
export function isValidMessageType(type) {
  const allTypes = [
    ...Object.values(MessageSchemas.WebSocketMessage),
    ...Object.values(WebSocketEvents)
  ];
  
  return allTypes.includes(type);
}

