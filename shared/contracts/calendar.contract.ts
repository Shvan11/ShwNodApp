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
 */
import { z } from 'zod';
import { dateString } from '../validation.js';

// "is it an array" guard — flip-free (every type is assignable to `unknown`).
const anyArray = z.array(z.unknown());

// GET /api/calendar/week?date=&doctorId= → { weekStart, …, days, timeSlots }.
export const week = {
  query: z.object({ date: dateString, doctorId: z.string().optional() }),
  response: z.looseObject({ days: anyArray }),
} as const;

// GET /api/calendar/month?date=&doctorId= → { monthStart, …, days }.
export const month = {
  query: z.object({ date: dateString, doctorId: z.string().optional() }),
  response: z.looseObject({ days: anyArray }),
} as const;

// GET /api/calendar/stats?date= → { stats }.
export const stats = {
  query: z.object({ date: dateString }),
  response: z.object({ stats: z.unknown() }),
} as const;

// POST /api/calendar/regenerate → { entriesAdded, message }.
export const regenerate = {
  response: z.looseObject({ message: z.string() }),
} as const;

// GET /api/calendar/available-slots?date= → { date, slots, … }.
export const availableSlots = {
  query: z.object({ date: dateString }),
  response: z.looseObject({ slots: anyArray }),
} as const;

// GET /api/calendar/month-availability?startDate=&endDate= → { availability, holidays, … }.
export const monthAvailability = {
  query: z.object({ startDate: dateString, endDate: dateString }),
  response: z.looseObject({ availability: z.unknown() }),
} as const;
