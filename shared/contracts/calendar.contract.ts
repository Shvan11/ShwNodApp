/**
 * API contract — calendar endpoints (`/api/calendar/*`).
 *
 * Single source of truth for each endpoint's request + response shapes, imported
 * by BOTH the Express routes (relative `.js`) and the React app (`@shared`
 * alias). See docs/shared-contract-progress.md.
 *
 * Phase 14 (Wave 2) — ROOT MIGRATION (the heaviest). Each GET spread 5–8 keys at
 * the TOP LEVEL (`{ success, weekStart, …, days, timeSlots }`) that the funnel
 * passed through untouched; they now ride `sendData` (`{success,data}`), so the
 * funnel unwraps to the payload and the consumer's existing key access
 * (`.days`/`.timeSlots`/`.stats`/`.availability`/`.slots`) still resolves — the
 * dead `.success`-at-2xx checks are dropped. Containers stay `looseObject` (the
 * unmodeled keys — `weekStart`, `maxAppointmentsPerSlot`, … — must survive the
 * parse). The `date`/`startDate`/`endDate` query guards become `validate()`.
 *
 * Phase 3 Group 6: all response slots are intentionally loose — hierarchical
 * day/slot/availability structures are assembled by the calendar service and
 * their nested shape varies by doctor filter and date range.
 */
import { z } from 'zod';
import { dateString } from '../validation.js';

// "is it an array" guard — flip-free (every type is assignable to unknown).
const anyArray = z.array(z.unknown());

// GET /api/calendar/week?date=&doctorId= → { weekStart, …, days, timeSlots }.
export const week = {
  query: z.object({ date: dateString, doctorId: z.string().optional() }),
  // Intentionally loose: days are hierarchical appointment rows assembled by the calendar service — structure varies by doctor filter
  response: z.looseObject({ days: anyArray }),
} as const;

// GET /api/calendar/month?date=&doctorId= → { monthStart, …, days }.
export const month = {
  query: z.object({ date: dateString, doctorId: z.string().optional() }),
  // Intentionally loose: days are hierarchical appointment rows assembled by the calendar service — structure varies by doctor filter
  response: z.looseObject({ days: anyArray }),
} as const;

// GET /api/calendar/stats?date= → { stats }.
export const stats = {
  query: z.object({ date: dateString }),
  // Intentionally loose: stats is a service-computed aggregate object — nested shape varies by date
  response: z.object({ stats: z.unknown() }),
} as const;

// POST /api/calendar/regenerate → { entriesAdded, message }.
export const regenerate = {
  response: z.looseObject({ message: z.string() }),
} as const;

// GET /api/calendar/available-slots?date= → { date, slots, … }.
export const availableSlots = {
  query: z.object({ date: dateString }),
  // Intentionally loose: slots are time-slot objects assembled by the calendar service — nested shape varies by availability
  response: z.looseObject({ slots: anyArray }),
} as const;

// GET /api/calendar/month-availability?startDate=&endDate= → { availability, holidays, … }.
export const monthAvailability = {
  query: z.object({ startDate: dateString, endDate: dateString }),
  // Intentionally loose: availability is a date-keyed map assembled by the calendar service — structure varies by date range
  response: z.looseObject({ availability: z.unknown() }),
} as const;

// Shared route-level query view (handlers read the strings directly; the per-endpoint
// `dateString` query schemas above stay the validated boundary). Type-only.
export const calendarQuery = z.object({
  date: z.string().optional(),
  doctorId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});
export type CalendarQueryParams = z.infer<typeof calendarQuery>;
