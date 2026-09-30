// public/js/services/sse-whatsapp.ts
//
// SSE singleton for the WhatsApp channel. The lifecycle, liveness watchdog and
// CLOSED-stream retry live in the shared `SseChannel`.
//
// Transport-only: ensureConnected does NOT prime initial state. The hooks
// (useWhatsAppAuth, useWhatsAppSync) call `fetch('/api/wa/initial-state')`
// themselves — they already own the date-change, visibility, and 30 s QR-
// refresh triggers.

import { SseChannel } from './sse-channel';

export type { Freshness } from './sse-channel';

const sseWhatsapp = new SseChannel(
  '/api/sse/whatsapp',
  [
    'whatsapp_qr_updated',
    'whatsapp_client_ready',
    'whatsapp_message_status',
    'whatsapp_sending_started',
    'whatsapp_sending_progress',
    'whatsapp_sending_finished',
    'whatsapp_send_unconfirmed',
  ],
  'sse-whatsapp'
);

export default sseWhatsapp;
