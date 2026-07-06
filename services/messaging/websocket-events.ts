// services/messaging/websocket-events.ts
//
// Internal Node EventEmitter event names. Used by routes/services to fan out
// real-time updates to the SSE broadcasters (`sse-broadcaster.ts` and
// `sse-whatsapp.ts`). Never travels over the wire — the SSE broadcasters
// translate these to typed SSE frames at the boundary.

export const InternalEmitterEvents = {
  /** Appointment data changed for a date — fan out via SSE to today-viewers */
  DATA_UPDATED: 'data_updated',
  /** Staff loaded a patient on a chair — build the payload and push to the kiosk via SSE */
  CHAIR_PATIENT_LOAD: 'chair_patient_load',
  /** Staff cleared a chair — tell the kiosk via SSE to return to idle */
  CHAIR_PATIENT_CLEAR: 'chair_patient_clear',
  /** A photo-editor timepoint finished rendering in the background — tell any
   *  open photos grid for that patient/timepoint to refetch its gallery. */
  PHOTO_TIMEPOINT_RENDERED: 'photo_timepoint_rendered',

  // WhatsApp — typed payloads fan out via SSE to /api/sse/whatsapp.
  WHATSAPP_QR_UPDATED: 'whatsapp_qr_updated',
  WHATSAPP_CLIENT_READY: 'whatsapp_client_ready',
  WHATSAPP_MESSAGE_STATUS: 'whatsapp_message_status',
  WHATSAPP_SENDING_STARTED: 'whatsapp_sending_started',
  WHATSAPP_SENDING_PROGRESS: 'whatsapp_sending_progress',
  WHATSAPP_SENDING_FINISHED: 'whatsapp_sending_finished',
  /** A batch reported "sent" but ZERO delivery acks arrived in the watch
   *  window — the WhatsApp socket was silently dead and the messages almost
   *  certainly never left this machine. The UI must warn loudly. */
  WHATSAPP_SEND_UNCONFIRMED: 'whatsapp_send_unconfirmed',
} as const;

export type InternalEmitterEvent = (typeof InternalEmitterEvents)[keyof typeof InternalEmitterEvents];
