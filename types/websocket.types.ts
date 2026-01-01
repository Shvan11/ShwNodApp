/**
 * WebSocket Types
 * Type definitions for WebSocket communication
 */

import type { Appointment, AppointmentStats } from './database.types.js';

// ===========================================
// CONNECTION TYPES
// ===========================================

/**
 * WebSocket connection status
 */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

/**
 * Connection state object
 */
export interface ConnectionState {
  status: ConnectionStatus;
  reconnectAttempts: number;
  lastActivity: number;
  hasConnectedBefore: boolean;
  lastError?: string;
}

// ===========================================
// MESSAGE TYPES
// ===========================================

/**
 * Base WebSocket message structure
 */
export interface WebSocketMessage<T = unknown> {
  type: string;
  data: T;
  timestamp?: number;
  sequenceNumber?: number;
  clientId?: string;
}

/**
 * Message with acknowledgment
 */
export interface AckMessage<T = unknown> extends WebSocketMessage<T> {
  ackId?: string;
  requiresAck?: boolean;
}

// ===========================================
// EVENT TYPES
// ===========================================

/**
 * WebSocket event names (mirrors websocket-events.js)
 */
export const WebSocketEvents = {
  // Connection & Lifecycle
  CONNECTION_ESTABLISHED: 'connection_established',
  CONNECTION_LOST: 'connection_lost',
  CONNECTION_ERROR: 'connection_error',
  CONNECTION_RECONNECTING: 'connection_reconnecting',
  HEARTBEAT_PING: 'heartbeat_ping',
  HEARTBEAT_PONG: 'heartbeat_pong',

  // Appointment System
  APPOINTMENTS_UPDATED: 'appointments_updated',
  REQUEST_APPOINTMENTS: 'request_appointments',
  APPOINTMENTS_DATA: 'appointments_data',

  // Patient Management
  PATIENT_LOADED: 'patient_loaded',
  PATIENT_UNLOADED: 'patient_unloaded',
  REQUEST_PATIENT: 'request_patient',
  PATIENT_DATA: 'patient_data',
  PATIENT_IMAGES_LOADED: 'patient_images_loaded',
  PATIENT_VISIT_UPDATED: 'patient_visit_updated',

  // WhatsApp Messaging
  WHATSAPP_CLIENT_READY: 'whatsapp_client_ready',
  WHATSAPP_CLIENT_INITIALIZING: 'whatsapp_client_initializing',
  WHATSAPP_CLIENT_DISCONNECTED: 'whatsapp_client_disconnected',
  WHATSAPP_SESSION_RESTORING: 'whatsapp_session_restoring',
  WHATSAPP_QR_UPDATED: 'whatsapp_qr_updated',
  WHATSAPP_MESSAGE_STATUS: 'whatsapp_message_status',
  WHATSAPP_BATCH_STATUS: 'whatsapp_batch_status',
  WHATSAPP_SESSION_STATUS: 'whatsapp_session_status',

  // System Events
  SYSTEM_NOTIFICATION: 'system_notification',
  ERROR: 'error',
} as const;

export type WebSocketEventName = typeof WebSocketEvents[keyof typeof WebSocketEvents];

// ===========================================
// EVENT DATA TYPES
// ===========================================

/**
 * Connection established event data
 */
export interface ConnectionEstablishedData {
  timestamp: number;
  serverInfo?: {
    version?: string;
    environment?: string;
  };
}

/**
 * Appointment update event data
 */
export interface AppointmentUpdateData {
  date: string;
  appointments: Appointment[];
  stats: AppointmentStats;
  sequenceNumber: number;
  actionId?: string;
  sourceClientId?: string;
}

/**
 * Patient loaded event data
 */
export interface PatientLoadedData {
  patientId: number;
  patientName: string;
  timestamp: number;
}

/**
 * Patient unloaded event data
 */
export interface PatientUnloadedData {
  patientId: number;
  timestamp: number;
}

// ===========================================
// WHATSAPP EVENT TYPES
// ===========================================

/**
 * WhatsApp message status values
 */
export type WhatsAppMessageStatusValue = 'pending' | 'server' | 'delivered' | 'read' | 'error' | 'failed';

/**
 * WhatsApp message status update
 */
export interface WhatsAppMessageStatus {
  messageId: string;
  status: WhatsAppMessageStatusValue;
  patientName: string;
  phone: string;
  timeSent: string | null;
  message: string;
  error?: string;
  appointmentId?: number;
  timestamp?: number;
}

/**
 * WhatsApp batch status update
 */
export interface WhatsAppBatchStatus {
  batchId: string;
  totalMessages: number;
  sentCount: number;
  failedCount: number;
  status: 'in_progress' | 'completed' | 'failed';
  messages: WhatsAppMessageStatus[];
}

/**
 * WhatsApp QR code update
 */
export interface WhatsAppQRData {
  qr: string;
  timestamp: number;
}

/**
 * WhatsApp client state
 */
export type WhatsAppClientState =
  | 'DISCONNECTED'
  | 'INITIALIZING'
  | 'QR_READY'
  | 'AUTHENTICATED'
  | 'READY'
  | 'ERROR';

/**
 * WhatsApp session status
 */
export interface WhatsAppSessionStatus {
  state: WhatsAppClientState;
  isReady: boolean;
  qrCode?: string | null;
  error?: string;
  timestamp: number;
}

// ===========================================
// CLIENT-SIDE TYPES
// ===========================================

/**
 * WebSocket service configuration
 */
export interface WebSocketConfig {
  url?: string;
  reconnect?: boolean;
  maxReconnectAttempts?: number;
  reconnectInterval?: number;
  heartbeatInterval?: number;
  debug?: boolean;
}

/**
 * Event handler function type
 */
export type EventHandler<T = unknown> = (data: T) => void;

/**
 * Event listener map
 */
export type EventListenerMap = Map<string, Set<EventHandler>>;

// ===========================================
// SERVER-SIDE TYPES
// ===========================================

/**
 * WebSocket client info (server-side)
 */
export interface WSClientInfo {
  id: string;
  connectedAt: number;
  lastActivity: number;
  subscriptions: Set<string>;
  isAlive: boolean;
}

/**
 * Broadcast options
 */
export interface BroadcastOptions {
  excludeClient?: string;
  includeClients?: string[];
  event: string;
  data: unknown;
}
