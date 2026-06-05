/**
 * API contract — messaging endpoints (`/api/messaging/*`).
 *
 * Single source of truth for each endpoint's response shapes, imported by BOTH
 * the Express routes (relative `.js`) and the React app (`@shared` alias). See
 * docs/shared-contract-progress.md.
 *
 * Phase 13 (Wave 2). Group B — response-only. `status/:date` is consumed by the
 * React-Query `useMessageStatus` hook (its rows ride `data.messages`); the
 * `count`/`reset` payloads are rich service objects — intentionally preserved as loose guards.
 */
import { z } from 'zod';

// GET /api/messaging/status/:date → { messages, summary, … }.
// Intentionally loose: messages are transformed WhatsApp delivery objects; summary
// is a live aggregate — both shapes are preserved without field enumeration.
export const status = {
  response: z.looseObject({ messages: z.array(z.unknown()) }),
} as const;

// GET /api/messaging/count/:date → MessageCount (rich service object).
// Intentionally loose: MessageCount aggregates per-channel delivery stats; shape varies.
export const count = {
  response: z.unknown(),
} as const;

// POST /api/messaging/reset/:date → reset result (rich service object).
// Intentionally loose: reset result contains channel-specific status maps.
export const reset = {
  response: z.unknown(),
} as const;

// Shared `:date` path param for the messaging endpoints. Type-only.
export const dateParams = z.object({ date: z.string() });
export type DateParams = z.infer<typeof dateParams>;
