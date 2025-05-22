// services/messaging/schemas.js
/**
 * Message schemas and validation for WhatsApp system
 */

export const MessageSchemas = {
  // WebSocket message formats
  WebSocketMessage: {
    QR_UPDATE: 'qr_update',
    CLIENT_READY: 'client_ready', 
    MESSAGE_STATUS: 'message_status',
    BATCH_STATUS: 'batch_status',
    ERROR: 'error',
    PING: 'ping',
    PONG: 'pong'
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
 * Enhanced validate WebSocket message format - more flexible validation
 */
export function validateWebSocketMessage(message) {
  if (!message || typeof message !== 'object') {
    return { valid: false, error: 'Message must be an object' };
  }
  
  if (!message.type) {
    return { valid: false, error: 'Message missing type field' };
  }
  
  // ===== FIXED: More flexible validation =====
  // Allow messages without data field for simple ping/pong and other control messages
  const simpleMessageTypes = ['ping', 'pong', 'heartbeat', 'ack'];
  
  if (simpleMessageTypes.includes(message.type)) {
    // Simple messages don't require data or timestamp
    return { valid: true };
  }
  
  // For other message types, require data but make timestamp optional
  if (message.data === undefined) {
    return { valid: false, error: 'Message missing data field' };
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
    'ping', 'pong', 'heartbeat', 'ack', 'error',
    'appointment_data', 'appointment_update', 
    'patient_data', 'patient_loaded', 'patient_unloaded',
    'sending_finished', 'updated'
  ];
  
  return allTypes.includes(type);
}

function generateMessageId() {
  return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}