// services/messaging/message-status.ts
//
// Numeric ack status codes from whatsapp-web.js, mirrored into our own
// constant so DB writes and event payloads can use named values.

export const MessageStatus = {
  PENDING: 0,
  SERVER: 1,
  DEVICE: 2,
  READ: 3,
  PLAYED: 4,
  ERROR: -1,
} as const;

export type MessageStatusType = (typeof MessageStatus)[keyof typeof MessageStatus];
