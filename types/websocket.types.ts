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
 * Chair-display: patient loaded event payload
 */
export interface ChairDisplayPatientLoadedData {
  pid: string;
  images: Array<{ name: string }>;
  latestVisit: unknown | null;
}

/**
 * Chair-display: patient cleared event payload (intentionally empty)
 */
export interface ChairDisplayPatientClearedData {
  // no fields
  [key: string]: never;
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
