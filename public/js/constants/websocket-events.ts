/**
 * Frontend WebSocket Event Constants
 *
 * This module provides the same WebSocket event constants used on the backend
 * to ensure consistency across frontend and backend event handling.
 */

export const WebSocketEvents = {
  // ===========================================
  // CONNECTION & LIFECYCLE EVENTS
  // ===========================================

  /** Connection established successfully */
  CONNECTION_ESTABLISHED: 'connection_established',

  /** Connection lost/disconnected */
  CONNECTION_LOST: 'connection_lost',

  /** Connection error occurred */
  CONNECTION_ERROR: 'connection_error',

  /** Client is reconnecting */
  CONNECTION_RECONNECTING: 'connection_reconnecting',

  /** Heartbeat ping */
  HEARTBEAT_PING: 'heartbeat_ping',

  /** Heartbeat pong response */
  HEARTBEAT_PONG: 'heartbeat_pong',

  /** Server-pushed liveness heartbeat (server -> client every 15s) */
  SERVER_HEARTBEAT: 'server_heartbeat',

  // ===========================================
  // APPOINTMENT SYSTEM EVENTS
  // ===========================================

  /** Appointment data loaded/updated */
  APPOINTMENTS_UPDATED: 'appointments_updated',

  // ===========================================
  // CHAIR DISPLAY EVENTS
  // ===========================================

  /** Patient data loaded for chair-side public display */
  CHAIR_DISPLAY_PATIENT_LOADED: 'chair_display_patient_loaded',

  /** Chair-side public display should clear patient data */
  CHAIR_DISPLAY_PATIENT_CLEARED: 'chair_display_patient_cleared',

  // ===========================================
  // WHATSAPP MESSAGING EVENTS
  // ===========================================

  /** WhatsApp client ready for messaging */
  WHATSAPP_CLIENT_READY: 'whatsapp_client_ready',

  /** WhatsApp client initializing */
  WHATSAPP_CLIENT_INITIALIZING: 'whatsapp_client_initializing',

  /** WhatsApp client disconnected */
  WHATSAPP_CLIENT_DISCONNECTED: 'whatsapp_client_disconnected',

  /** QR code updated for WhatsApp authentication */
  WHATSAPP_QR_UPDATED: 'whatsapp_qr_updated',

  /** Message status updated */
  WHATSAPP_MESSAGE_STATUS: 'whatsapp_message_status',

  /** Batch message status updates */
  WHATSAPP_MESSAGE_BATCH_STATUS: 'whatsapp_message_batch_status',

  /** Message sending process finished */
  WHATSAPP_SENDING_FINISHED: 'whatsapp_sending_finished',

  /** Request initial WhatsApp state */
  REQUEST_WHATSAPP_INITIAL_STATE: 'request_whatsapp_initial_state',

  /** WhatsApp initial state response */
  WHATSAPP_INITIAL_STATE_RESPONSE: 'whatsapp_initial_state_response',

  // ===========================================
  // SYSTEM & ERROR EVENTS
  // ===========================================

  /** General system error */
  SYSTEM_ERROR: 'system_error',

  /** Data update completed */
  DATA_UPDATED: 'data_updated',

  /** Broadcast message to all clients */
  BROADCAST_MESSAGE: 'broadcast_message',

  /** Request client capabilities */
  REQUEST_CAPABILITIES: 'request_capabilities',

  /** Client capabilities response */
  CLIENT_CAPABILITIES: 'client_capabilities',

  // ===========================================
  // CONNECTION MULTIPLEXING EVENTS
  // ===========================================

  /** Client requests to be added to an additional connection type after initial handshake */
  REGISTER_CLIENT_TYPE: 'register_client_type',

  /** Client requests to be removed from a connection type without closing the socket */
  UNREGISTER_CLIENT_TYPE: 'unregister_client_type',
} as const;

// Type for WebSocket event values
export type WebSocketEventType = (typeof WebSocketEvents)[keyof typeof WebSocketEvents];

// Type for WebSocket event keys
export type WebSocketEventKey = keyof typeof WebSocketEvents;

// Event categories type
export interface EventsByCategory {
  connection: WebSocketEventType[];
  appointments: WebSocketEventType[];
  chairDisplay: WebSocketEventType[];
  whatsapp: WebSocketEventType[];
  system: WebSocketEventType[];
}

/**
 * Check if an event name is valid
 * @param eventName - Event name to check
 * @returns Whether the event name is valid
 */
export function isValidEvent(eventName: string): eventName is WebSocketEventType {
  return Object.values(WebSocketEvents).includes(eventName as WebSocketEventType);
}

/**
 * Get all event names grouped by category
 * @returns Events grouped by category
 */
export function getEventsByCategory(): EventsByCategory {
  return {
    connection: [
      WebSocketEvents.CONNECTION_ESTABLISHED,
      WebSocketEvents.CONNECTION_LOST,
      WebSocketEvents.CONNECTION_ERROR,
      WebSocketEvents.CONNECTION_RECONNECTING,
      WebSocketEvents.HEARTBEAT_PING,
      WebSocketEvents.HEARTBEAT_PONG,
      WebSocketEvents.SERVER_HEARTBEAT,
    ],
    appointments: [
      WebSocketEvents.APPOINTMENTS_UPDATED,
    ],
    chairDisplay: [
      WebSocketEvents.CHAIR_DISPLAY_PATIENT_LOADED,
      WebSocketEvents.CHAIR_DISPLAY_PATIENT_CLEARED,
    ],
    whatsapp: [
      WebSocketEvents.WHATSAPP_CLIENT_READY,
      WebSocketEvents.WHATSAPP_CLIENT_INITIALIZING,
      WebSocketEvents.WHATSAPP_CLIENT_DISCONNECTED,
      WebSocketEvents.WHATSAPP_QR_UPDATED,
      WebSocketEvents.WHATSAPP_MESSAGE_STATUS,
      WebSocketEvents.WHATSAPP_MESSAGE_BATCH_STATUS,
      WebSocketEvents.WHATSAPP_SENDING_FINISHED,
      WebSocketEvents.REQUEST_WHATSAPP_INITIAL_STATE,
      WebSocketEvents.WHATSAPP_INITIAL_STATE_RESPONSE,
    ],
    system: [
      WebSocketEvents.SYSTEM_ERROR,
      WebSocketEvents.DATA_UPDATED,
      WebSocketEvents.BROADCAST_MESSAGE,
      WebSocketEvents.REQUEST_CAPABILITIES,
      WebSocketEvents.CLIENT_CAPABILITIES,
      WebSocketEvents.REGISTER_CLIENT_TYPE,
      WebSocketEvents.UNREGISTER_CLIENT_TYPE,
    ],
  };
}

export default WebSocketEvents;
