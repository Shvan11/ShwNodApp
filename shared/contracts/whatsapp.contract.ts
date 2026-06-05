/**
 * API contract — WhatsApp send endpoints (`/api/wa/*`).
 *
 * REQUEST-ONLY by design. These handlers answer with RAW top-level payloads
 * (`res.json({ success, messageId, … })` / `res.send('OK')` / the sendmedia2
 * `state` object), and the client reads them through the raw whatsapp `apiClient`
 * which does NOT unwrap the `sendSuccess` envelope — so the responses are
 * deliberately NOT modeled here (nesting under `data` would hide the fields the
 * consumers read). Only the request bodies are contracted: they are fully
 * enumerated strict `z.object`s wired via `validate({ body })` on the routes
 * (server-side validation is independent of the client's response transport), and
 * the route's hand-written `Send*Body` interfaces are deleted in favour of these
 * `z.infer` exports. See docs/shared-contract-progress.md.
 */
import { z } from 'zod';

// POST /api/wa/send-receipt — { workId } (number or numeric string; the handler
// re-`parseInt`s it). Raw response.
export const sendReceipt = {
  body: z.object({ workId: z.coerce.number() }),
} as const;
export type SendReceiptBody = z.infer<typeof sendReceipt.body>;

// POST /api/wa/send-appointment — { appointmentId }.
export const sendAppointment = {
  body: z.object({ appointmentId: z.coerce.number() }),
} as const;
export type SendAppointmentBody = z.infer<typeof sendAppointment.body>;

// POST /api/wa/sendmedia — { file (base64 PNG), phone }.
export const sendMedia = {
  body: z.object({ file: z.string(), phone: z.string() }),
} as const;
export type SendMediaBody = z.infer<typeof sendMedia.body>;

// POST /api/wa/sendmedia2 — { file (comma-separated paths), phone, prog }.
// Multipart (`upload.none()`), so `validate({ body })` runs AFTER the multer
// middleware (req.body is populated by then).
export const sendMedia2 = {
  body: z.object({
    file: z.string(),
    phone: z.string(),
    prog: z.enum(['WhatsApp', 'Telegram']),
  }),
} as const;
export type SendMedia2Body = z.infer<typeof sendMedia2.body>;

// GET /api/wa/initial-state & /api/wa/qr — flat objects (NOT the sendSuccess
// envelope, so the funnel passes them through). Response-only client guards: loose
// `looseObject` asserts the object class and PRESERVES every realtime
// connection-state field (qr/clientReady/status/…) the consumers read. Deliberately
// not tightened — these fields vary across connection lifecycle and can't be
// runtime-verified without a live WhatsApp client; tighten in Phase 3 if stable.
export const initialState = { response: z.looseObject({}) } as const;
export const qr = { response: z.looseObject({}) } as const;

// GET send-by-date endpoints (`?date=`). Type-only — handlers read `date` directly.
export const sendByDateQuery = z.object({ date: z.string().optional() });
export type SendByDateQuery = z.infer<typeof sendByDateQuery>;
