/**
 * API contract — sync status endpoints (`/api/sync/*`) that the Settings shell reads.
 *
 * The two sink-status polls (`/supabase-status`, `/dolphin-status`) are still raw
 * (`query/queries.ts`); this file holds only what was added with a contract from
 * the start.
 */
import { z } from 'zod';

// GET /api/sync/features → which CDC sinks this install has at all. Cheap (env only,
// no network): the Settings shell reads it to show the Supabase / Dolphin status tabs
// only where there is something to report on — a new center with no mirror and no
// Dolphin saw two grey "not configured" tabs (audit FE-F22-7; owner: every role,
// only where configured, 2026-10-05).
export const features = {
  response: z.object({
    supabase: z.boolean(),
    dolphin: z.boolean(),
  }),
} as const;
export type SyncFeaturesResponse = z.infer<typeof features.response>;
