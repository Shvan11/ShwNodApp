/**
 * WhatsApp Send Page Constants
 * Shared configuration and constants for the WhatsApp send page
 */

// Configuration Constants — the date picker's range (the rest of this object
// had no reader; FE-F16-15).
export const CONFIG = {
  DATE_RANGE_DAYS_BACK: 7,
  DATE_RANGE_DAYS_FORWARD: 30,
} as const;

// API Endpoints
export const API_ENDPOINTS = {
  MESSAGE_COUNT: (date: string): string => `/api/messaging/count/${date}`,
  MESSAGE_RESET: (date: string): string => `/api/messaging/reset/${date}`,
  MESSAGE_STATUS: (date: string): string => `/api/messaging/status/${date}`,
  MESSAGE_TEXT: (appointmentId: number): string => `/api/messaging/message-text/${appointmentId}`,
  // POST — the date rides in the body. It was a GET, which csurf exempts while
  // the session cookie is sameSite: 'lax', so one cross-site link click fired the
  // whole day's reminder batch.
  WA_SEND: '/api/wa/send',
  WA_RESEND: '/api/wa/resend-appointment',
  WA_GROUP_SETTINGS: '/api/wa/group-settings',
  SEND_EMAIL: (date: string): string => `/api/email/send-appointments?date=${date}`,
} as const;

// State Constants
// The send page's SSE transport states (the batch's own state is `SendingProgress`).
export const UI_STATES = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  ERROR: 'error',
} as const;

export type UIState = (typeof UI_STATES)[keyof typeof UI_STATES];

// Message Status Constants
// PENDING = never attempted (SentWa IS NULL)
// READY   = explicitly reset, awaiting resend (SentWa = 0)
export const MESSAGE_STATUS = {
  PENDING: 0,
  SERVER: 1,
  DEVICE: 2,
  READ: 3,
  PLAYED: 4,
  READY: 5,
  FAILED: -1,
  INVALID_PHONE: -2,
} as const;

export type MessageStatusValue = (typeof MESSAGE_STATUS)[keyof typeof MESSAGE_STATUS];

export const MESSAGE_STATUS_TEXT: Record<MessageStatusValue, string> = {
  [MESSAGE_STATUS.PENDING]: 'Not Sent Yet',
  [MESSAGE_STATUS.SERVER]: 'Server',
  [MESSAGE_STATUS.DEVICE]: 'Device',
  [MESSAGE_STATUS.READ]: 'Read',
  [MESSAGE_STATUS.PLAYED]: 'Played',
  [MESSAGE_STATUS.READY]: 'Ready to Resend',
  [MESSAGE_STATUS.FAILED]: 'Failed',
  [MESSAGE_STATUS.INVALID_PHONE]: 'Invalid Phone',
};
