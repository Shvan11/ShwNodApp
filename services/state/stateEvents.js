// services/state/stateEvents.js
import EventEmitter from 'events';

// Create a singleton event bus for state-related events
const stateEvents = new EventEmitter();

// ===== ADDED: Enhanced event configuration =====
// Set max listeners to prevent memory leak warnings for high-traffic events
stateEvents.setMaxListeners(50);

// ===== ADDED: Event type constants for better type safety and documentation =====
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
  FAILOVER_TRIGGERED: 'failover_triggered'
};

// ===== ADDED: Event validation and debugging helpers =====
const originalEmit = stateEvents.emit;

// Override emit to add validation and debugging
stateEvents.emit = function(eventName, ...args) {
  // Validate event name against known types (optional, for development)
  if (process.env.NODE_ENV === 'development') {
    const validEvents = Object.values(StateEventTypes);
    if (!validEvents.includes(eventName)) {
      console.warn(`⚠️  Unknown event type emitted: ${eventName}. Consider adding to StateEventTypes.`);
    }
  }
  
  // Add timestamp to event data for debugging
  const eventData = {
    timestamp: Date.now(),
    eventName,
    args
  };
  
  // Log critical events
  if (eventName.includes('error') || eventName.includes('critical') || eventName.includes('failed')) {
    console.error(`🔴 Critical event: ${eventName}`, args[0]);
  }
  
  // Call original emit
  return originalEmit.call(this, eventName, ...args);
};

// ===== ADDED: Convenience methods for common event patterns =====

/**
 * Emit a QR code related event with standardized data structure
 * @param {string} eventType - Type of QR event
 * @param {Object} data - Event data
 */
stateEvents.emitQREvent = function(eventType, data = {}) {
  this.emit(eventType, {
    ...data,
    category: 'qr',
    timestamp: Date.now()
  });
};

/**
 * Emit a client state change event
 * @param {string} eventType - Type of client event
 * @param {Object} data - Event data
 */
stateEvents.emitClientEvent = function(eventType, data = {}) {
  this.emit(eventType, {
    ...data,
    category: 'client',
    timestamp: Date.now()
  });
};

/**
 * Emit a message status event with standardized structure
 * @param {string} eventType - Type of message event
 * @param {Object} data - Event data including messageId, status, etc.
 */
stateEvents.emitMessageEvent = function(eventType, data = {}) {
  this.emit(eventType, {
    ...data,
    category: 'message',
    timestamp: Date.now()
  });
};

/**
 * Emit a database event with connection and transaction info
 * @param {string} eventType - Type of database event
 * @param {Object} data - Event data
 */
stateEvents.emitDatabaseEvent = function(eventType, data = {}) {
  this.emit(eventType, {
    ...data,
    category: 'database',
    timestamp: Date.now()
  });
};

/**
 * Emit a health monitoring event
 * @param {string} eventType - Type of health event
 * @param {Object} data - Health data
 */
stateEvents.emitHealthEvent = function(eventType, data = {}) {
  this.emit(eventType, {
    ...data,
    category: 'health',
    timestamp: Date.now()
  });
};

/**
 * Emit a system-level event
 * @param {string} eventType - Type of system event
 * @param {Object} data - System event data
 */
stateEvents.emitSystemEvent = function(eventType, data = {}) {
  this.emit(eventType, {
    ...data,
    category: 'system',
    timestamp: Date.now()
  });
};

// ===== ADDED: Event statistics and monitoring =====
let eventStats = {
  totalEvents: 0,
  eventCounts: {},
  lastReset: Date.now()
};

// Track event statistics
const originalEmitForStats = stateEvents.emit;
stateEvents.emit = function(eventName, ...args) {
  // Update statistics
  eventStats.totalEvents++;
  eventStats.eventCounts[eventName] = (eventStats.eventCounts[eventName] || 0) + 1;
  
  return originalEmitForStats.call(this, eventName, ...args);
};

/**
 * Get event statistics
 * @returns {Object} Event statistics
 */
stateEvents.getEventStats = function() {
  return {
    ...eventStats,
    uptime: Date.now() - eventStats.lastReset,
    averageEventsPerMinute: Math.round((eventStats.totalEvents / (Date.now() - eventStats.lastReset)) * 60000)
  };
};

/**
 * Reset event statistics
 */
stateEvents.resetEventStats = function() {
  eventStats = {
    totalEvents: 0,
    eventCounts: {},
    lastReset: Date.now()
  };
};

// ===== ADDED: Error handling for event listeners =====
stateEvents.on('error', (error) => {
  console.error('🔴 StateEvents error:', error);
  
  // Emit a system error event
  stateEvents.emitSystemEvent(StateEventTypes.CRITICAL_ERROR_OCCURRED, {
    error: error.message,
    stack: error.stack,
    source: 'state-events'
  });
});

// ===== ADDED: Cleanup method for graceful shutdown =====
stateEvents.cleanup = function() {
  console.log('🧹 Cleaning up state events...');
  
  // Log final statistics
  const stats = this.getEventStats();
  console.log(`📊 Final event statistics:`, stats);
  
  // Remove all listeners
  this.removeAllListeners();
  
  // Reset statistics
  this.resetEventStats();
  
  console.log('✅ State events cleanup completed');
};

// ===== ADDED: Development helpers =====
if (process.env.NODE_ENV === 'development') {
  // Log all events in development mode (can be disabled via env var)
  if (process.env.LOG_STATE_EVENTS === 'true') {
    stateEvents.onAny = function(eventName, ...args) {
      console.log(`🔄 StateEvent: ${eventName}`, args[0]);
    };
    
    // Override emit to log all events
    const originalEmitForLogging = stateEvents.emit;
    stateEvents.emit = function(eventName, ...args) {
      if (this.onAny) {
        this.onAny(eventName, ...args);
      }
      return originalEmitForLogging.call(this, eventName, ...args);
    };
  }
  
  // Add method to list all current listeners (for debugging)
  stateEvents.debugListeners = function() {
    const events = this.eventNames();
    const listenerCounts = {};
    
    events.forEach(event => {
      listenerCounts[event] = this.listenerCount(event);
    });
    
    console.log('🔍 Current event listeners:', listenerCounts);
    return listenerCounts;
  };
}

// Export the enhanced event bus
export default stateEvents;