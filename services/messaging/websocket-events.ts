// services/messaging/websocket-events.ts
/**
 * WebSocket event constants — server side.
 *
 * Two distinct namespaces:
 *
 * - `WebSocketEvents`: message `type` values that travel over the wire,
 *   in either direction. Mirrored in `public/js/constants/websocket-events.ts`.
 *
 * - `InternalEmitterEvents`: names used on the in-process Node `EventEmitter`
 *   that routes/services use to fan out broadcasts. These never leave the
 *   server and have no client counterpart. Consumed by the WS server
 *   (waStatus/auth fan-out) AND the SSE broadcaster (appointments + chair).
 */

/**
 * WebSocket message types (server↔client).
 */
export const WebSocketEvents = {
  // Liveness
  /** Server-pushed liveness heartbeat (server → client every 15s) */
  SERVER_HEARTBEAT: 'server_heartbeat',

  // Note: APPOINTMENTS_UPDATED / CHAIR_DISPLAY_* events moved to SSE — see
  // services/messaging/sse-broadcaster.ts. Wire names are hard-coded there.

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

/**
 * Internal Node EventEmitter event names. Used by routes/services to fan out
 * to the WS broadcaster (`utils/websocket.ts` listens here). Not part of the
 * over-the-wire protocol.
 */
export const InternalEmitterEvents = {
  /** Appointment data changed for a date — fan out via SSE to today-viewers */
  DATA_UPDATED: 'data_updated',
  /** Pre-formed WS message to route to the appropriate broadcast set */
  BROADCAST_MESSAGE: 'broadcast_message',
  /** Staff loaded a patient on a chair — build the payload and push to the kiosk via SSE */
  CHAIR_PATIENT_LOAD: 'chair_patient_load',
  /** Staff cleared a chair — tell the kiosk via SSE to return to idle */
  CHAIR_PATIENT_CLEAR: 'chair_patient_clear',
} as const;

export type InternalEmitterEvent = (typeof InternalEmitterEvents)[keyof typeof InternalEmitterEvents];

/**
 * Standard message envelope produced by `createStandardMessage`.
 * Generic on the `data` payload so typed payloads (e.g. ChairPatientPayload)
 * round-trip without an unsafe cast — every downstream consumer just
 * `JSON.stringify`s the envelope anyway.
 */
export interface StandardMessage<TData extends object = Record<string, unknown>> {
  type: string;
  data: TData;
  timestamp: number;
  id: string;
  source?: string;
  version?: string;
  correlationId?: string;
}

function generateMessageId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 11);
  return `msg_${timestamp}_${random}`;
}

/**
 * Build a standardized WS message envelope.
 */
export function createStandardMessage<TData extends object = Record<string, unknown>>(
  eventType: string,
  data: TData = {} as TData,
  metadata: Record<string, unknown> = {}
): StandardMessage<TData> {
  return {
    type: eventType,
    data,
    timestamp: Date.now(),
    id: generateMessageId(),
    ...metadata,
  };
}
