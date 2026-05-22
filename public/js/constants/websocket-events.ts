/**
 * WebSocket event constants — client side.
 *
 * Mirrors `services/messaging/websocket-events.ts` `WebSocketEvents`. These
 * are the message `type` strings that travel over the wire in either direction.
 *
 * The server also has an `InternalEmitterEvents` namespace for in-process
 * `EventEmitter` event names — those never leave the server, so they have
 * no equivalent here.
 */

export const WebSocketEvents = {
  // Liveness
  SERVER_HEARTBEAT: 'server_heartbeat',

  // Appointments
  APPOINTMENTS_UPDATED: 'appointments_updated',

  // Chair-side public display
  CHAIR_DISPLAY_PATIENT_LOADED: 'chair_display_patient_loaded',
  CHAIR_DISPLAY_PATIENT_CLEARED: 'chair_display_patient_cleared',

  // WhatsApp messaging
  WHATSAPP_CLIENT_READY: 'whatsapp_client_ready',
  WHATSAPP_SESSION_RESTORING: 'whatsapp_session_restoring',
  WHATSAPP_QR_UPDATED: 'whatsapp_qr_updated',
  WHATSAPP_MESSAGE_STATUS: 'whatsapp_message_status',
  WHATSAPP_MESSAGE_BATCH_STATUS: 'whatsapp_message_batch_status',
  WHATSAPP_SENDING_STARTED: 'whatsapp_sending_started',
  WHATSAPP_SENDING_PROGRESS: 'whatsapp_sending_progress',
  WHATSAPP_SENDING_FINISHED: 'whatsapp_sending_finished',
  REQUEST_WHATSAPP_INITIAL_STATE: 'request_whatsapp_initial_state',
  WHATSAPP_INITIAL_STATE_RESPONSE: 'whatsapp_initial_state_response',

  // System
  SYSTEM_ERROR: 'system_error',

  // Client-type subscription (client → server)
  REGISTER_CLIENT_TYPE: 'register_client_type',
  UNREGISTER_CLIENT_TYPE: 'unregister_client_type',
} as const;

export type WebSocketEventType = (typeof WebSocketEvents)[keyof typeof WebSocketEvents];
export type WebSocketEventKey = keyof typeof WebSocketEvents;

export default WebSocketEvents;
