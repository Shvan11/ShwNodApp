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
import { dateString, optionalDateString } from '../validation.js';

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

// GET /sendtwilio & /checktwilio — shared `?date=` query. Now VALIDATED (it used to
// be type-only): Express hands back an ARRAY for a repeated key (`?date=a&date=b`),
// so a handler typed `date?: string` was passing `string[]` straight into
// `sms.sendSms()`. `optionalDateString` keeps the handlers' own "date is required"
// message reachable (it admits `undefined` and `''`) while rejecting an array or a
// non-calendar date at the boundary.
export const twilioDate = {
  query: z.object({ date: optionalDateString }),
} as const;
export type TwilioDateQuery = z.infer<typeof twilioDate.query>;

// POST /sendtwilio — { date }. The send half moved off GET (csurf exempts safe
// methods, and the session cookie is `sameSite: 'lax'`), so the date is a
// required BODY field here; `/checktwilio` is a real read and keeps the query
// above. Plain-text `res.send` response, so there is no response schema.
export const sendTwilio = {
  body: z.object({ date: dateString }),
} as const;
export type SendTwilioBody = z.infer<typeof sendTwilio.body>;
