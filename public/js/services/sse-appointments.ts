// public/js/services/sse-appointments.ts
//
// SSE singleton for the daily-appointments stream. The lifecycle, liveness
// watchdog and CLOSED-stream retry live in the shared `SseChannel`.

import { SseChannel } from './sse-channel';

export type { Freshness } from './sse-channel';

const sseAppointments = new SseChannel(
  '/api/sse/appointments',
  [
    'appointments_updated',
    // A background photo render finished (photo-editor save). The photos grid
    // rides this stream and refetches its gallery; everyone else ignores it.
    'photos_rendered',
  ],
  'sse-appointments'
);

export default sseAppointments;
