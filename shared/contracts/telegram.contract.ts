/**
 * API contract — Telegram file-sharing endpoints (`/api/telegram/*`).
 *
 * Single source of truth for each endpoint's request + response shapes, imported
 * by BOTH the Express routes (relative `.js`) and the React app (`@shared`
 * alias). One exported `const <action> = { body?, params?, query?, response }
 * as const` per endpoint; types via `z.infer`. See docs/shared-contract-progress.md.
 *
 * Reuses the LocalSend `sendFileRef` shape — the browser sends the same untrusted
 * `{source, personId, ref}` for any share target, resolved server-side by
 * `services/files/share-ref.ts`. Every shape is a CLOSED `z.object`: the server
 * builds each DTO field-for-field, so there is no long tail to preserve.
 */
import { z } from 'zod';
import { sendFileRef } from './localsend.contract.js';

// GET /api/telegram/status → { enabled }. Whether the server can send via Telegram.
export const status = {
  response: z.object({ enabled: z.boolean() }),
} as const;
export type StatusResponse = z.infer<typeof status.response>;

// POST /api/telegram/send → { enabled, sent, total, errors }.
// Sends each resolved file to one recipient phone (international format).
export const send = {
  body: z.object({
    phone: z.string().min(1),
    files: z.array(sendFileRef).min(1),
  }),
  response: z.object({
    enabled: z.boolean(),
    sent: z.number(),
    total: z.number(),
    errors: z.array(z.string()),
  }),
} as const;
export type SendBody = z.infer<typeof send.body>;
export type SendResponse = z.infer<typeof send.response>;
