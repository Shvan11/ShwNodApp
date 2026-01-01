// services/messaging/index.ts
/**
 * Messaging service exports
 */

export {
  WebSocketEvents,
  EventDirection,
  EventMetadata,
  validateEventData,
  createStandardMessage,
  getEventsByCategory,
  isValidEvent,
} from './websocket-events.js';
export type { WebSocketEventType, EventDirectionType, StandardMessage } from './websocket-events.js';

export {
  MessageSchemas,
  MessageStatus,
  WebSocketMessageTypes,
  createWebSocketMessage,
  validateWebSocketMessage,
  normalizeWebSocketMessage,
  sanitizeMessageData,
  createControlMessage,
  isValidMessageType,
} from './schemas.js';
export type { MessageStatusType, WebSocketMessageType, WebSocketMessage } from './schemas.js';
