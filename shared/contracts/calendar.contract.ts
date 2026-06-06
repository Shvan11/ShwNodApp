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
 * Phase 3 Group 6 (revisited): the day/slot/availability structures are now
 * MODELED — the route (`routes/calendar.ts`) assembles them from fixed interfaces
 * (DayData / MonthlyDayData / SlotInfo / AppointmentInfo / CalendarStatsRow), so the
 * nested rows are closed `z.object` schemas mirroring those interfaces (closed →
 * the route interfaces stay assignable to `sendData` without an interface→type
 * flip). The CONTAINERS stay `z.looseObject` so the top-level metadata each handler
 * spreads in (`weekStart`, `doctorId`, `maxAppointmentsPerSlot`, `holidays`, …) and
 * any future key survive the parse; only the one array/map key the client reads is
 * tightened. Field nullability mirrors the interfaces exactly so a real null never
 * trips the client guard.
 */
import { z } from 'zod';
import { dateString } from '../validation.js';

// ── Nested row schemas (mirror the interfaces in routes/calendar.ts) ───────────

// One appointment inside a slot/day. `app_date`/`person_id`/`time` are the
// compatibility aliases the route adds for EditAppointmentForm.
const appointmentInfo = z.object({
  appointment_id: z.number(),
  appDetail: z.string().nullable(),
  drID: z.number().nullable(),
  patientName: z.string().nullable(),
  personID: z.number().nullable(),
  slotStatus: z.string().optional(),
  slotDateTime: z.string().optional(),
  app_date: z.string().optional(),
  person_id: z.number().nullable().optional(),
  time: z.string().optional(),
});

// A time-slot bucket in the WEEK view (SlotInfo) — appointments grouped per slot.
const slotInfo = z.object({
  appointments: z.array(appointmentInfo),
  appointmentCount: z.number(),
  slotStatus: z.string(),
});

// A day in the WEEK view (DayData) — `appointments` keyed by 'HH:MM' slot.
const weekDay = z.object({
  date: z.string(),
  dayName: z.string(),
  dayOfWeek: z.number(),
  appointments: z.record(z.string(), slotInfo),
  isHoliday: z.boolean(),
  holidayId: z.number().nullable(),
  holidayName: z.string().nullable(),
  holidayDescription: z.string().nullable(),
});

// A day in the MONTH view (MonthlyDayData) — `appointments` flat list + slot tallies.
const monthDay = z.object({
  date: z.string(),
  dayName: z.string(),
  dayOfWeek: z.number(),
  appointments: z.array(appointmentInfo),
  appointmentCount: z.number(),
  totalSlots: z.number(),
  availableSlots: z.number(),
  bookedSlots: z.number(),
  utilizationPercent: z.number().optional(),
  isHoliday: z.boolean(),
  holidayId: z.number().nullable(),
  holidayName: z.string().nullable(),
  holidayDescription: z.string().nullable(),
});

// Weekly utilization stats (CalendarStatsRow).
const calendarStats = z.object({
  weekStart: z.string(),
  weekEnd: z.string(),
  totalSlots: z.number(),
  availableSlots: z.number(),
  bookedSlots: z.number(),
  pastSlots: z.number(),
  utilizationPercent: z.number(),
});

// One slot row in available-slots (the route's `allSlots` literal).
const availableSlot = z.object({
  date: z.string(),
  time: z.string(),
  dateTime: z.string(),
  slotStatus: z.string(),
  appointmentCount: z.number(),
  appointments: z.array(appointmentInfo),
});

// Per-day availability summary in month-availability (the route's `availability` map values).
const dayAvailability = z.object({
  availableCount: z.number(),
  totalCount: z.number(),
  appointmentCount: z.number(),
  hasAvailability: z.boolean(),
  isHoliday: z.boolean(),
  holidayName: z.string().nullable(),
  holidayDescription: z.string().nullable(),
});

// GET /api/calendar/week?date=&doctorId= → { weekStart, …, days, timeSlots }.
export const week = {
  query: z.object({ date: dateString, doctorId: z.string().optional() }),
  response: z.looseObject({ days: z.array(weekDay), timeSlots: z.array(z.string()) }),
} as const;
export type CalendarWeekResponse = z.infer<typeof week.response>;

// GET /api/calendar/month?date=&doctorId= → { monthStart, …, days }.
export const month = {
  query: z.object({ date: dateString, doctorId: z.string().optional() }),
  response: z.looseObject({ days: z.array(monthDay) }),
} as const;
export type CalendarMonthResponse = z.infer<typeof month.response>;

// GET /api/calendar/stats?date= → { stats }.
export const stats = {
  query: z.object({ date: dateString }),
  response: z.object({ stats: calendarStats }),
} as const;
export type CalendarStatsResponse = z.infer<typeof stats.response>;

// POST /api/calendar/regenerate → { entriesAdded, message }.
export const regenerate = {
  response: z.looseObject({ message: z.string() }),
} as const;

// GET /api/calendar/available-slots?date= → { date, slots, … }.
export const availableSlots = {
  query: z.object({ date: dateString }),
  response: z.looseObject({ slots: z.array(availableSlot) }),
} as const;
export type AvailableSlotsResponse = z.infer<typeof availableSlots.response>;

// GET /api/calendar/month-availability?startDate=&endDate= → { availability, holidays, … }.
export const monthAvailability = {
  query: z.object({ startDate: dateString, endDate: dateString }),
  response: z.looseObject({ availability: z.record(z.string(), dayAvailability) }),
} as const;
export type MonthAvailabilityResponse = z.infer<typeof monthAvailability.response>;

// Shared route-level query view (handlers read the strings directly; the per-endpoint
// `dateString` query schemas above stay the validated boundary). Type-only.
export const calendarQuery = z.object({
  date: z.string().optional(),
  doctorId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});
export type CalendarQueryParams = z.infer<typeof calendarQuery>;
