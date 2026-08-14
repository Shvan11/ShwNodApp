// services/messaging/stateEvents.ts
/**
 * In-process event bus for WhatsApp send/QR/client-lifecycle state.
 *
 * NOT an SSE/wire channel — these names never leave the process. The bus couples
 * messageState (services/messaging/messageState.ts) to the WhatsApp service
 * (services/messaging/whatsapp.ts) and the QR routes without a hard import cycle.
 *
 * Keep `StateEventTypes` in sync with what is actually emitted: in development an
 * emit of an unlisted name logs a warning, which is the only guard against a typo'd
 * event name silently going nowhere.
 */
import EventEmitter from 'events';
import { log } from '../../utils/logger.js';

/**
 * Every event name carried on this bus. Emitters/listeners live in
 * messageState.ts, messaging/whatsapp.ts and routes/api/whatsapp.routes.ts.
 */
export const StateEventTypes = {
  // QR lifecycle
  QR_CLEANUP_REQUIRED: 'qr_cleanup_required',
  QR_VIEWER_CONNECTED: 'qr_viewer_connected',

  // Client lifecycle
  CLIENT_DISCONNECTED: 'client_disconnected',
  WHATSAPP_STATE_CHANGED: 'whatsapp_state_changed',
  WHATSAPP_INITIALIZATION_REQUESTED: 'whatsapp_initialization_requested',

  // Message status
  MESSAGE_STATUS_UPDATED: 'message_status_updated',
  MESSAGE_STATUS_ERROR: 'message_status_error',

  // Send-session state
  STATE_RESET: 'state_reset',
} as const;

export type StateEventType = (typeof StateEventTypes)[keyof typeof StateEventTypes];

// Create a singleton event bus for state-related events
const stateEvents = new EventEmitter();

// Set max listeners to prevent memory leak warnings for high-traffic events
stateEvents.setMaxListeners(50);

// Store original emit for enhancement
const originalEmit = stateEvents.emit.bind(stateEvents);

// Override emit to add dev-time name validation and error-event logging
stateEvents.emit = function (eventName: string | symbol, ...args: unknown[]): boolean {
  const eventNameStr = eventName.toString();

  // Validate event name against known types (development only)
  if (process.env.NODE_ENV === 'development') {
    const validEvents: readonly string[] = Object.values(StateEventTypes);
    if (!validEvents.includes(eventNameStr)) {
      log.warn('Unknown event type emitted. Consider adding to StateEventTypes.', {
        eventName: eventNameStr,
      });
    }
  }

  if (eventNameStr.includes('error') || eventNameStr.includes('failed')) {
    log.error('Critical event', { eventName: eventNameStr, data: args[0] });
  }

  return originalEmit(eventName, ...args);
};

// An unhandled 'error' event on an EventEmitter throws and takes the process
// down — this listener keeps a stray emit to a log line instead.
stateEvents.on('error', (error: Error) => {
  log.error('StateEvents error', { error: error.message, stack: error.stack });
});

export default stateEvents;
