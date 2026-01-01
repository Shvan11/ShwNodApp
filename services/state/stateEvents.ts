// services/state/stateEvents.ts
import EventEmitter from 'events';
import { log } from '../../utils/logger.js';

/**
 * State Event Types
 */
export const StateEventTypes = {
  // QR Code Management Events
  QR_CLEANUP_REQUIRED: 'qr_cleanup_required',
  QR_VIEWER_CONNECTED: 'qr_viewer_connected',
  QR_VIEWER_DISCONNECTED: 'qr_viewer_disconnected',
  QR_CODE_GENERATED: 'qr_code_generated',
  QR_CODE_SCANNED: 'qr_code_scanned',

  // Client Connection Events
  CLIENT_CONNECTED: 'client_connected',
  CLIENT_DISCONNECTED: 'client_disconnected',
  CLIENT_READY: 'client_ready',
  CLIENT_INITIALIZING: 'client_initializing',
  CLIENT_ERROR: 'client_error',
  CLIENT_RECONNECTING: 'client_reconnecting',
  WHATSAPP_STATE_CHANGED: 'whatsapp_state_changed',

  // Message Status Events
  MESSAGE_STATUS_UPDATED: 'message_status_updated',
  MESSAGE_STATUS_ERROR: 'message_status_error',
  MESSAGE_BATCH_PROCESSED: 'message_batch_processed',
  MESSAGE_QUEUE_FULL: 'message_queue_full',
  MESSAGE_DELIVERY_CONFIRMED: 'message_delivery_confirmed',

  // State Management Events
  STATE_RESET: 'state_reset',
  STATE_BACKUP_CREATED: 'state_backup_created',
  STATE_RESTORED: 'state_restored',
  STATE_CORRUPTION_DETECTED: 'state_corruption_detected',

  // Database Events
  DATABASE_CONNECTION_ESTABLISHED: 'database_connection_established',
  DATABASE_CONNECTION_LOST: 'database_connection_lost',
  DATABASE_TRANSACTION_FAILED: 'database_transaction_failed',
  DATABASE_CIRCUIT_BREAKER_OPENED: 'database_circuit_breaker_opened',
  DATABASE_CIRCUIT_BREAKER_CLOSED: 'database_circuit_breaker_closed',

  // Health Monitoring Events
  HEALTH_CHECK_PASSED: 'health_check_passed',
  HEALTH_CHECK_FAILED: 'health_check_failed',
  SYSTEM_OVERLOAD_DETECTED: 'system_overload_detected',
  MEMORY_PRESSURE_WARNING: 'memory_pressure_warning',

  // WebSocket Events
  WEBSOCKET_CLIENT_CONNECTED: 'websocket_client_connected',
  WEBSOCKET_CLIENT_DISCONNECTED: 'websocket_client_disconnected',
  WEBSOCKET_BROADCAST_SENT: 'websocket_broadcast_sent',
  WEBSOCKET_CONNECTION_ERROR: 'websocket_connection_error',

  // Appointment System Events
  APPOINTMENTS_UPDATED: 'appointments_updated',
  APPOINTMENT_REMINDER_SENT: 'appointment_reminder_sent',
  APPOINTMENT_CONFIRMATION_RECEIVED: 'appointment_confirmation_received',

  // Patient Management Events
  PATIENT_DATA_ACCESSED: 'patient_data_accessed',
  PATIENT_IMAGES_LOADED: 'patient_images_loaded',
  PATIENT_VISIT_RECORDED: 'patient_visit_recorded',

  // System Events
  SYSTEM_STARTUP_COMPLETE: 'system_startup_complete',
  SYSTEM_SHUTDOWN_INITIATED: 'system_shutdown_initiated',
  SYSTEM_RESOURCE_CLEANUP: 'system_resource_cleanup',

  // Error and Recovery Events
  CRITICAL_ERROR_OCCURRED: 'critical_error_occurred',
  RECOVERY_INITIATED: 'recovery_initiated',
  RECOVERY_COMPLETED: 'recovery_completed',
  FAILOVER_TRIGGERED: 'failover_triggered',
} as const;

export type StateEventType = (typeof StateEventTypes)[keyof typeof StateEventTypes];

/**
 * Event data interfaces
 */
export interface BaseEventData {
  timestamp: number;
  category?: string;
}

export interface QREventData extends BaseEventData {
  category: 'qr';
  qr?: string;
  viewerId?: string;
}

export interface ClientEventData extends BaseEventData {
  category: 'client';
  clientId?: string;
  state?: string;
  error?: string;
}

export interface MessageEventData extends BaseEventData {
  category: 'message';
  messageId?: string;
  status?: number;
  error?: string;
}

export interface DatabaseEventData extends BaseEventData {
  category: 'database';
  connectionId?: string;
  query?: string;
  error?: string;
}

export interface HealthEventData extends BaseEventData {
  category: 'health';
  checkName?: string;
  healthy?: boolean;
  details?: Record<string, unknown>;
}

export interface SystemEventData extends BaseEventData {
  category: 'system';
  source?: string;
  error?: string;
  stack?: string;
}

export type EventData =
  | QREventData
  | ClientEventData
  | MessageEventData
  | DatabaseEventData
  | HealthEventData
  | SystemEventData
  | BaseEventData;

/**
 * Event statistics interface
 */
interface EventStats {
  totalEvents: number;
  eventCounts: Record<string, number>;
  lastReset: number;
}

/**
 * Extended EventEmitter with state event helpers
 */
interface StateEventsEmitter extends EventEmitter {
  emitQREvent: (eventType: string, data?: Partial<QREventData>) => boolean;
  emitClientEvent: (eventType: string, data?: Partial<ClientEventData>) => boolean;
  emitMessageEvent: (eventType: string, data?: Partial<MessageEventData>) => boolean;
  emitDatabaseEvent: (eventType: string, data?: Partial<DatabaseEventData>) => boolean;
  emitHealthEvent: (eventType: string, data?: Partial<HealthEventData>) => boolean;
  emitSystemEvent: (eventType: string, data?: Partial<SystemEventData>) => boolean;
  getEventStats: () => EventStats & { uptime: number; averageEventsPerMinute: number };
  resetEventStats: () => void;
  cleanup: () => void;
  debugListeners?: () => Record<string, number>;
  onAny?: (eventName: string, ...args: unknown[]) => void;
}

// Create a singleton event bus for state-related events
const stateEvents: StateEventsEmitter = new EventEmitter() as StateEventsEmitter;

// Set max listeners to prevent memory leak warnings for high-traffic events
stateEvents.setMaxListeners(50);

// Event statistics tracking
let eventStats: EventStats = {
  totalEvents: 0,
  eventCounts: {},
  lastReset: Date.now(),
};

// Store original emit for enhancement
const originalEmit = stateEvents.emit.bind(stateEvents);

// Override emit to add validation, debugging, and statistics
stateEvents.emit = function (eventName: string | symbol, ...args: unknown[]): boolean {
  const eventNameStr = eventName.toString();

  // Validate event name against known types (optional, for development)
  if (process.env.NODE_ENV === 'development') {
    const validEvents = Object.values(StateEventTypes);
    if (!validEvents.includes(eventNameStr as StateEventType)) {
      log.warn('Unknown event type emitted. Consider adding to StateEventTypes.', { eventName: eventNameStr });
    }
  }

  // Update statistics
  eventStats.totalEvents++;
  eventStats.eventCounts[eventNameStr] = (eventStats.eventCounts[eventNameStr] || 0) + 1;

  // Log critical events
  if (
    eventNameStr.includes('error') ||
    eventNameStr.includes('critical') ||
    eventNameStr.includes('failed')
  ) {
    log.error('Critical event', { eventName: eventNameStr, data: args[0] });
  }

  // Call onAny if defined (development mode)
  if (this.onAny) {
    this.onAny(eventNameStr, ...args);
  }

  // Call original emit
  return originalEmit(eventName, ...args);
};

// Convenience methods for common event patterns

/**
 * Emit a QR code related event with standardized data structure
 */
stateEvents.emitQREvent = function (eventType: string, data: Partial<QREventData> = {}): boolean {
  return this.emit(eventType, {
    ...data,
    category: 'qr',
    timestamp: Date.now(),
  } as QREventData);
};

/**
 * Emit a client state change event
 */
stateEvents.emitClientEvent = function (eventType: string, data: Partial<ClientEventData> = {}): boolean {
  return this.emit(eventType, {
    ...data,
    category: 'client',
    timestamp: Date.now(),
  } as ClientEventData);
};

/**
 * Emit a message status event with standardized structure
 */
stateEvents.emitMessageEvent = function (eventType: string, data: Partial<MessageEventData> = {}): boolean {
  return this.emit(eventType, {
    ...data,
    category: 'message',
    timestamp: Date.now(),
  } as MessageEventData);
};

/**
 * Emit a database event with connection and transaction info
 */
stateEvents.emitDatabaseEvent = function (eventType: string, data: Partial<DatabaseEventData> = {}): boolean {
  return this.emit(eventType, {
    ...data,
    category: 'database',
    timestamp: Date.now(),
  } as DatabaseEventData);
};

/**
 * Emit a health monitoring event
 */
stateEvents.emitHealthEvent = function (eventType: string, data: Partial<HealthEventData> = {}): boolean {
  return this.emit(eventType, {
    ...data,
    category: 'health',
    timestamp: Date.now(),
  } as HealthEventData);
};

/**
 * Emit a system-level event
 */
stateEvents.emitSystemEvent = function (eventType: string, data: Partial<SystemEventData> = {}): boolean {
  return this.emit(eventType, {
    ...data,
    category: 'system',
    timestamp: Date.now(),
  } as SystemEventData);
};

/**
 * Get event statistics
 */
stateEvents.getEventStats = function (): EventStats & { uptime: number; averageEventsPerMinute: number } {
  const uptime = Date.now() - eventStats.lastReset;
  return {
    ...eventStats,
    uptime,
    averageEventsPerMinute: uptime > 0 ? Math.round((eventStats.totalEvents / uptime) * 60000) : 0,
  };
};

/**
 * Reset event statistics
 */
stateEvents.resetEventStats = function (): void {
  eventStats = {
    totalEvents: 0,
    eventCounts: {},
    lastReset: Date.now(),
  };
};

/**
 * Cleanup method for graceful shutdown
 */
stateEvents.cleanup = function (): void {
  log.info('Cleaning up state events...');

  // Log final statistics
  const stats = this.getEventStats();
  log.debug('Final event statistics', { stats });

  // Remove all listeners
  this.removeAllListeners();

  // Reset statistics
  this.resetEventStats();

  log.info('State events cleanup completed');
};

// Error handling for event listeners
stateEvents.on('error', (error: Error) => {
  log.error('StateEvents error', { error: error.message, stack: error.stack });

  // Emit a system error event
  stateEvents.emitSystemEvent(StateEventTypes.CRITICAL_ERROR_OCCURRED, {
    error: error.message,
    stack: error.stack,
    source: 'state-events',
  });
});

// Development helpers
if (process.env.NODE_ENV === 'development') {
  // Log all events in development mode (can be disabled via env var)
  if (process.env.LOG_STATE_EVENTS === 'true') {
    stateEvents.onAny = function (eventName: string, ...args: unknown[]): void {
      log.debug('StateEvent', { eventName, data: args[0] });
    };
  }

  // Add method to list all current listeners (for debugging)
  stateEvents.debugListeners = function (): Record<string, number> {
    const events = this.eventNames();
    const listenerCounts: Record<string, number> = {};

    events.forEach((event) => {
      listenerCounts[event.toString()] = this.listenerCount(event);
    });

    log.debug('Current event listeners', { listenerCounts });
    return listenerCounts;
  };
}

// Export the enhanced event bus
export default stateEvents;
