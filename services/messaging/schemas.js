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
      ERROR: 'error'
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
  export function createWebSocketMessage(type, data, metadata = {}) {
    return {
      type,
      data,
      timestamp: Date.now(),
      id: generateMessageId(),
      ...metadata
    };
  }
  
  /**
   * Validate WebSocket message format
   */
  export function validateWebSocketMessage(message) {
    if (!message || typeof message !== 'object') {
      return { valid: false, error: 'Message must be an object' };
    }
    
    if (!message.type || !message.data || !message.timestamp) {
      return { valid: false, error: 'Message missing required fields' };
    }
    
    return { valid: true };
  }
  
  function generateMessageId() {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }