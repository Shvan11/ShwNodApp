/**
 * API contract — utility endpoints (`/api/google`, `/api/convert-path`).
 *
 * Single source of truth for each endpoint's response shapes, imported by BOTH
 * the Express routes (relative `.js`) and the React app (`@shared` alias). See
 * docs/shared-contract-progress.md.
 *
 * Phase 13 (Wave 2). Group B — response-only (no client `{schema}`). The
 * `/sendtwilio` + `/checktwilio` endpoints are EXCLUDED (`res.send` plain text).
 */
import { z } from 'zod';

// GET /api/google?source= → contacts[].
// Intentionally loose: Google Contacts API returns dynamic contact objects;
// the field set varies by source and contact data completeness.
export const google = {
  // `refresh=1` bypasses the server-side phone-book cache (the dropdown's Refresh
  // control) — the crawl is otherwise cached for a few minutes per account.
  query: z.object({
    source: z.string().optional(),
    refresh: z.coerce.boolean().optional(),
  }),
  response: z.array(z.unknown()),
} as const;
export type GoogleQuery = z.infer<typeof google.query>;

// GET /api/convert-path?path= → { webPath, fullPath }.
export const convertPath = {
  query: z.object({ path: z.string().optional() }),
  response: z.object({ webPath: z.string(), fullPath: z.string() }),
} as const;
export type ConvertPathQuery = z.infer<typeof convertPath.query>;

// GET /sendtwilio & /checktwilio — shared `?date=` query (handlers keep their own
// required-param checks + plain-text `res.send`, so this is type-only, not validated).
export const twilioDate = {
  query: z.object({ date: z.string().optional() }),
} as const;
export type TwilioDateQuery = z.infer<typeof twilioDate.query>;
