/**
 * API contract — appointment endpoints.
 *
 * Single source of truth for an endpoint's request/response shapes, imported by
 * BOTH the Express routes (relative `.js`) and the React app (`@shared` alias).
 * One exported `const <action> = { body?, params?, query?, response } as const`
 * per endpoint; types via `z.infer`. See docs/shared-contract-progress.md.
 *
 * Phase 0: response-only (migrated from the deleted public/js/core/api.schemas.ts).
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// GET /api/getDailyAppointments?AppsDate=YYYY-MM-DD
// services/database/queries/appointment-queries.ts#getDailyAppointmentsOptimized
//
// Container is a closed key set → plain z.object. Rows stay z.looseObject so the
// UI keeps the long tail of row fields (core/http returns the PARSED payload, so
// looseObject is load-bearing — see the tracker's Findings log).
// ---------------------------------------------------------------------------

const appointmentRowSchema = z.looseObject({
  appointment_id: z.number(),
});

const appointmentStatsSchema = z.object({
  total: z.number(),
  checkedIn: z.number(),
  absent: z.number(),
  waiting: z.number(),
});

export const dailyAppointments = {
  response: z.object({
    allAppointments: z.array(appointmentRowSchema),
    checkedInAppointments: z.array(appointmentRowSchema),
    stats: appointmentStatsSchema,
  }),
} as const;
export type DailyAppointmentsResponse = z.infer<typeof dailyAppointments.response>;
