/**
 * API contract — holiday endpoints (`/api/holidays/*`).
 *
 * Single source of truth for each endpoint's response shapes, imported by BOTH
 * the Express routes (relative `.js`) and the React app (`@shared` alias). See
 * docs/shared-contract-progress.md.
 *
 * Phase 13 (Wave 2). Group B — response-only. `appointments-on-date` warns the
 * calendar/holiday editor when a date already has appointments.
 */
import { z } from 'zod';

// "is it an array" guard — flip-free (every type is assignable to `unknown`).
const anyArray = z.array(z.unknown());

// GET /api/holidays/appointments-on-date?date= → { appointments, count }.
export const appointmentsOnDate = {
  query: z.object({ date: z.string().optional() }),
  response: z.object({ appointments: anyArray, count: z.number() }),
} as const;
export type DateQuery = z.infer<typeof appointmentsOnDate.query>;
