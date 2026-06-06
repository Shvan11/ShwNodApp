/**
 * API contract — messaging endpoints (`/api/messaging/*`).
 *
 * Single source of truth for each endpoint's response shapes, imported by BOTH
 * the Express routes (relative `.js`) and the React app (`@shared` alias). See
 * docs/shared-contract-progress.md.
 *
 * Phase 13 (Wave 2). Group B — now MODELED. `status/:date` is consumed by the
 * React-Query `useMessageStatus` hook (its rows ride `data.messages`); `count`/`reset`
 * ride the raw whatsapp-api-client (top-level `{success,data}` envelope), so their
 * schemas only drive the server-side dev-parse. Shapes mirror the service interfaces:
 * TransformedMessage / MessageCount (MessagingService) + ResetResult (messaging-queries).
 */
import { z } from 'zod';

// A transformed WhatsApp delivery row (TransformedMessage extends DatabaseMessage).
// `deliveryStatus` stays a plain string — it's a free-form provider status the table
// doesn't switch on, so a closed enum would risk a live-read throw on a new value.
const transformedMessage = z.object({
  sentStatus: z.boolean().nullable(),
  deliveryStatus: z.string().nullable(),
  patientName: z.string(),
  phone: z.string(),
  sentTimestamp: z.string(),
  messageId: z.string(),
  appointmentId: z.number().optional(),
  errorMessage: z.string().optional(),
  message: z.string(),
  status: z.number(),
  name: z.string(),
  timeSent: z.string(),
  originalSentStatus: z.boolean().nullable(),
  originalDeliveryStatus: z.string().nullable(),
});

// GET /api/messaging/status/:date → { date, summary, messages, error? }.
// Container stays looseObject: only `messages` is read by the hook; the spread-in
// `date`/`summary`/`error` ride the loose tail untouched.
export const status = {
  response: z.looseObject({ messages: z.array(transformedMessage) }),
} as const;

// GET /api/messaging/count/:date → MessageCount + the route-patched `date`.
export const count = {
  response: z.object({
    totalMessages: z.number(),
    eligibleForMessaging: z.number(),
    alreadySent: z.number(),
    pending: z.number(),
    date: z.string().optional(),
  }),
} as const;

// POST /api/messaging/reset/:date → ResetResult (per-channel reset tallies).
export const reset = {
  response: z.object({
    resetDate: z.string(),
    totalAppointments: z.number(),
    readyForWhatsApp: z.number(),
    readyForSMS: z.number(),
    alreadySentWA: z.number(),
    alreadyNotified: z.number(),
    appointmentsReset: z.number(),
    smsRecordsReset: z.number(),
  }),
} as const;

// Shared `:date` path param for the messaging endpoints. Type-only.
export const dateParams = z.object({ date: z.string() });
export type DateParams = z.infer<typeof dateParams>;
