// services/messaging/websocket-events.ts
/**
 * Universal WebSocket Event Constants and Utilities
 *
 * This module provides standardized event naming conventions for all WebSocket
 * communications throughout the application. It ensures consistency between
 * frontend and backend event handling.
 */

import { log } from '../../utils/logger.js';

/**
 * Universal WebSocket Event Types
 *
 * Naming Convention:
 * - Use SCREAMING_SNAKE_CASE for constants
 * - Use descriptive, consistent patterns
 * - Server events: noun_verb (e.g., PATIENT_LOADED)
 * - Client events: verb_noun (e.g., REQUEST_PATIENT)
 * - Status events: noun_status (e.g., CLIENT_READY)
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

  // ===========================================
  // APPOINTMENT SYSTEM EVENTS
  // ===========================================

  /** Appointment data loaded/updated */
  APPOINTMENTS_UPDATED: 'appointments_updated',

  /** Request appointment data for specific date */
  REQUEST_APPOINTMENTS: 'request_appointments',

  /** Appointment data response */
  APPOINTMENTS_DATA: 'appointments_data',

  // ===========================================
  // PATIENT MANAGEMENT EVENTS
  // ===========================================

  /** Patient data loaded and displayed */
  PATIENT_LOADED: 'patient_loaded',

  /** Patient data unloaded/cleared */
  PATIENT_UNLOADED: 'patient_unloaded',

  /** Request patient data */
  REQUEST_PATIENT: 'request_patient',

  /** Patient data response */
  PATIENT_DATA: 'patient_data',

  /** Patient images loaded */
  PATIENT_IMAGES_LOADED: 'patient_images_loaded',

  /** Patient visit data updated */
  PATIENT_VISIT_UPDATED: 'patient_visit_updated',

  // ===========================================
  // WHATSAPP MESSAGING EVENTS
  // ===========================================

  /** WhatsApp client ready for messaging */
  WHATSAPP_CLIENT_READY: 'whatsapp_client_ready',

  /** WhatsApp client initializing */
  WHATSAPP_CLIENT_INITIALIZING: 'whatsapp_client_initializing',

  /** WhatsApp client disconnected */
  WHATSAPP_CLIENT_DISCONNECTED: 'whatsapp_client_disconnected',

  /** WhatsApp session restoration in progress */
  WHATSAPP_SESSION_RESTORING: 'whatsapp_session_restoring',

  /** QR code updated for WhatsApp authentication */
  WHATSAPP_QR_UPDATED: 'whatsapp_qr_updated',

  /** Message status updated */
  WHATSAPP_MESSAGE_STATUS: 'whatsapp_message_status',

  /** Batch message status updates */
  WHATSAPP_MESSAGE_BATCH_STATUS: 'whatsapp_message_batch_status',

  /** Message sending process started */
  WHATSAPP_SENDING_STARTED: 'whatsapp_sending_started',

  /** Message sending process finished */
  WHATSAPP_SENDING_FINISHED: 'whatsapp_sending_finished',

  /** Message sending progress update */
  WHATSAPP_SENDING_PROGRESS: 'whatsapp_sending_progress',

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
} as const;

export type WebSocketEventType = (typeof WebSocketEvents)[keyof typeof WebSocketEvents];

/**
 * Event Direction Types
 * Indicates whether event is sent from client to server or server to client
 */
export const EventDirection = {
  /** Client to Server */
  CLIENT_TO_SERVER: 'client_to_server',
  /** Server to Client */
  SERVER_TO_CLIENT: 'server_to_client',
  /** Bidirectional */
  BIDIRECTIONAL: 'bidirectional',
} as const;

export type EventDirectionType = (typeof EventDirection)[keyof typeof EventDirection];

/**
 * Event data type definition
 */
interface EventDataType {
  [key: string]: string;
}

/**
 * Event metadata definition
 */
interface EventMetadataEntry {
  direction: EventDirectionType;
  description: string;
  data: EventDataType;
}

/**
 * Event Metadata - describes each event type
 */
export const EventMetadata: Partial<Record<WebSocketEventType, EventMetadataEntry>> = {
  [WebSocketEvents.CONNECTION_ESTABLISHED]: {
    direction: EventDirection.SERVER_TO_CLIENT,
    description: 'WebSocket connection successfully established',
    data: { timestamp: 'number', serverInfo: 'object?' },
  },

  [WebSocketEvents.CONNECTION_LOST]: {
    direction: EventDirection.SERVER_TO_CLIENT,
    description: 'WebSocket connection lost or disconnected',
    data: { code: 'number', reason: 'string', wasClean: 'boolean' },
  },

  [WebSocketEvents.CONNECTION_ERROR]: {
    direction: EventDirection.SERVER_TO_CLIENT,
    description: 'WebSocket connection error occurred',
    data: { error: 'string', timestamp: 'number' },
  },

  [WebSocketEvents.HEARTBEAT_PING]: {
    direction: EventDirection.BIDIRECTIONAL,
    description: 'Heartbeat ping to maintain connection',
    data: { timestamp: 'number', id: 'string?' },
  },

  [WebSocketEvents.HEARTBEAT_PONG]: {
    direction: EventDirection.BIDIRECTIONAL,
    description: 'Heartbeat pong response',
    data: { timestamp: 'number', originalId: 'string?' },
  },

  [WebSocketEvents.APPOINTMENTS_UPDATED]: {
    direction: EventDirection.SERVER_TO_CLIENT,
    description: 'Appointment data has been updated',
    data: { tableData: 'object', date: 'string' },
  },

  [WebSocketEvents.REQUEST_APPOINTMENTS]: {
    direction: EventDirection.CLIENT_TO_SERVER,
    description: 'Request appointment data for specific date',
    data: { date: 'string' },
  },

  [WebSocketEvents.APPOINTMENTS_DATA]: {
    direction: EventDirection.SERVER_TO_CLIENT,
    description: 'Appointment data response',
    data: { tableData: 'object', date: 'string' },
  },

  [WebSocketEvents.PATIENT_LOADED]: {
    direction: EventDirection.SERVER_TO_CLIENT,
    description: 'Patient data loaded and should be displayed',
    data: { pid: 'string', images: 'array', latestVisit: 'object?' },
  },

  [WebSocketEvents.PATIENT_UNLOADED]: {
    direction: EventDirection.SERVER_TO_CLIENT,
    description: 'Patient data should be unloaded/cleared',
    data: {},
  },

  [WebSocketEvents.REQUEST_PATIENT]: {
    direction: EventDirection.CLIENT_TO_SERVER,
    description: 'Request patient data',
    data: { patientId: 'string' },
  },

  [WebSocketEvents.PATIENT_DATA]: {
    direction: EventDirection.SERVER_TO_CLIENT,
    description: 'Patient data response',
    data: { pid: 'string', images: 'array', latestVisit: 'object?' },
  },

  [WebSocketEvents.WHATSAPP_CLIENT_READY]: {
    direction: EventDirection.SERVER_TO_CLIENT,
    description: 'WhatsApp client is ready for messaging',
    data: { status: 'object', timestamp: 'number' },
  },

  [WebSocketEvents.WHATSAPP_SESSION_RESTORING]: {
    direction: EventDirection.SERVER_TO_CLIENT,
    description: 'WhatsApp session restoration in progress',
    data: { elapsed: 'number', maxWait: 'number' },
  },

  [WebSocketEvents.WHATSAPP_QR_UPDATED]: {
    direction: EventDirection.SERVER_TO_CLIENT,
    description: 'QR code updated for WhatsApp authentication',
    data: { qr: 'string', timestamp: 'number' },
  },

  [WebSocketEvents.WHATSAPP_MESSAGE_STATUS]: {
    direction: EventDirection.SERVER_TO_CLIENT,
    description: 'Message status updated',
    data: { messageId: 'string', status: 'number', date: 'string' },
  },

  [WebSocketEvents.WHATSAPP_MESSAGE_BATCH_STATUS]: {
    direction: EventDirection.SERVER_TO_CLIENT,
    description: 'Batch message status updates',
    data: { statusUpdates: 'array', date: 'string' },
  },

  [WebSocketEvents.WHATSAPP_SENDING_STARTED]: {
    direction: EventDirection.SERVER_TO_CLIENT,
    description: 'Message sending process started',
    data: {
      total: 'number',
      sent: 'number',
      failed: 'number',
      started: 'boolean',
      finished: 'boolean',
      sessionId: 'string',
      date: 'string',
    },
  },

  [WebSocketEvents.REQUEST_WHATSAPP_INITIAL_STATE]: {
    direction: EventDirection.CLIENT_TO_SERVER,
    description: 'Request initial WhatsApp state',
    data: { needsQR: 'boolean?', date: 'string?' },
  },

  [WebSocketEvents.WHATSAPP_INITIAL_STATE_RESPONSE]: {
    direction: EventDirection.SERVER_TO_CLIENT,
    description: 'WhatsApp initial state response',
    data: {
      htmltext: 'string',
      finished: 'boolean',
      clientReady: 'boolean',
      qr: 'string?',
      stats: 'object',
    },
  },

  [WebSocketEvents.SYSTEM_ERROR]: {
    direction: EventDirection.SERVER_TO_CLIENT,
    description: 'System error occurred',
    data: { error: 'string', timestamp: 'number', context: 'string?' },
  },
};

/**
 * Validation result interface
 */
interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate event data structure against metadata
 */
export function validateEventData(eventName: string, data: unknown): ValidationResult {
  const metadata = EventMetadata[eventName as WebSocketEventType];
  if (!metadata) {
    return { valid: false, errors: [`Unknown event type: ${eventName}`] };
  }

  const errors: string[] = [];
  const expectedData = metadata.data || {};

  // Basic validation - check if data is object when expected
  if (Object.keys(expectedData).length > 0 && (!data || typeof data !== 'object')) {
    errors.push('Event data must be an object');
    return { valid: false, errors };
  }

  const dataObj = data as Record<string, unknown>;

  // Check required fields (those without '?' suffix)
  for (const [field, type] of Object.entries(expectedData)) {
    const isOptional = type.endsWith('?');
    const actualType = type.replace('?', '');

    if (!isOptional && (dataObj[field] === undefined || dataObj[field] === null)) {
      errors.push(`Missing required field: ${field}`);
      continue;
    }

    if (dataObj[field] !== undefined && dataObj[field] !== null) {
      const dataType = Array.isArray(dataObj[field]) ? 'array' : typeof dataObj[field];
      if (dataType !== actualType) {
        errors.push(`Field ${field} should be ${actualType}, got ${dataType}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Standard message interface
 */
export interface StandardMessage {
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
  id: string;
  source?: string;
  version?: string;
  correlationId?: string;
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
 * Create a standardized WebSocket message
 */
export function createStandardMessage(
  eventType: string,
  data: Record<string, unknown> = {},
  metadata: Record<string, unknown> = {}
): StandardMessage {
  // Validate the event data
  const validation = validateEventData(eventType, data);
  if (!validation.valid) {
    log.warn('Invalid event data', { eventType, errors: validation.errors });
  }

  return {
    type: eventType,
    data,
    timestamp: Date.now(),
    id: generateMessageId(),
    ...metadata,
  };
}

/**
 * Events grouped by category
 */
interface EventsByCategory {
  connection: WebSocketEventType[];
  appointments: WebSocketEventType[];
  patient: WebSocketEventType[];
  whatsapp: WebSocketEventType[];
  system: WebSocketEventType[];
}

/**
 * Get all event names grouped by category
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
    ],
    appointments: [
      WebSocketEvents.APPOINTMENTS_UPDATED,
      WebSocketEvents.REQUEST_APPOINTMENTS,
      WebSocketEvents.APPOINTMENTS_DATA,
    ],
    patient: [
      WebSocketEvents.PATIENT_LOADED,
      WebSocketEvents.PATIENT_UNLOADED,
      WebSocketEvents.REQUEST_PATIENT,
      WebSocketEvents.PATIENT_DATA,
      WebSocketEvents.PATIENT_IMAGES_LOADED,
      WebSocketEvents.PATIENT_VISIT_UPDATED,
    ],
    whatsapp: [
      WebSocketEvents.WHATSAPP_CLIENT_READY,
      WebSocketEvents.WHATSAPP_CLIENT_INITIALIZING,
      WebSocketEvents.WHATSAPP_CLIENT_DISCONNECTED,
      WebSocketEvents.WHATSAPP_SESSION_RESTORING,
      WebSocketEvents.WHATSAPP_QR_UPDATED,
      WebSocketEvents.WHATSAPP_MESSAGE_STATUS,
      WebSocketEvents.WHATSAPP_MESSAGE_BATCH_STATUS,
      WebSocketEvents.WHATSAPP_SENDING_STARTED,
      WebSocketEvents.WHATSAPP_SENDING_FINISHED,
      WebSocketEvents.WHATSAPP_SENDING_PROGRESS,
      WebSocketEvents.REQUEST_WHATSAPP_INITIAL_STATE,
      WebSocketEvents.WHATSAPP_INITIAL_STATE_RESPONSE,
    ],
    system: [
      WebSocketEvents.SYSTEM_ERROR,
      WebSocketEvents.DATA_UPDATED,
      WebSocketEvents.BROADCAST_MESSAGE,
      WebSocketEvents.REQUEST_CAPABILITIES,
      WebSocketEvents.CLIENT_CAPABILITIES,
    ],
  };
}

/**
 * Check if an event name is valid
 */
export function isValidEvent(eventName: string): eventName is WebSocketEventType {
  return Object.values(WebSocketEvents).includes(eventName as WebSocketEventType);
}

export default {
  WebSocketEvents,
  EventDirection,
  EventMetadata,
  validateEventData,
  createStandardMessage,
  getEventsByCategory,
  isValidEvent,
};
