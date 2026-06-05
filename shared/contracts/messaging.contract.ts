/**
 * API contract — messaging endpoints (`/api/messaging/*`).
 *
 * Single source of truth for each endpoint's response shapes, imported by BOTH
 * the Express routes (relative `.js`) and the React app (`@shared` alias). See
 * docs/shared-contract-progress.md.
 *
 * Phase 13 (Wave 2). Group B — response-only. `status/:date` is consumed by the
 * React-Query `useMessageStatus` hook (its rows ride `data.messages`); the
 * `count`/`reset` payloads are rich service objects → `z.unknown()` (preserve).
 */
import { z } from 'zod';

// "is it an array" guard — flip-free (every type is assignable to `unknown`).
const anyArray = z.array(z.unknown());

// GET /api/messaging/status/:date → { messages, summary, … }.
export const status = {
  response: z.looseObject({ messages: anyArray }),
} as const;

// GET /api/messaging/count/:date → MessageCount (rich → preserve).
export const count = {
  response: z.unknown(),
} as const;

// POST /api/messaging/reset/:date → reset result (rich → preserve).
export const reset = {
  response: z.unknown(),
} as const;

// Shared `:date` path param for the messaging endpoints. Type-only.
export const dateParams = z.object({ date: z.string() });
export type DateParams = z.infer<typeof dateParams>;
