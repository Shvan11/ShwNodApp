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
 * MODELED — the route (`routes/api/calendar.routes.ts`) assembles them from fixed interfaces
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

// ── Nested row schemas (mirror the interfaces in routes/api/calendar.routes.ts) ───────────

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

// GET /api/calendar/range?start=&end=&doctorId= → { days, timeSlots, stats, … }.
// Powers the density-zoom Week grid: an arbitrary span of working days (Fridays
// excluded by the query) rendered as N day-columns. Same week-shaped day rows as
// `week`, with the utilisation `stats` folded in so the grid needs one round-trip.
/**
 * Longest span `/range` will materialise. The handler expands EVERY slot row in
 * the window into JS objects and then scans them again for stats, so an
 * unbounded span (`start=2000-01-01&end=2035-01-01`) is a one-request memory
 * blow-up. A quarter comfortably covers the widest zoom the client offers.
 * (`/statistics/multi-year` caps its own range the same way, at 10 years.)
 */
export const MAX_CALENDAR_RANGE_DAYS = 92;

export const range = {
  query: z
    .object({ start: dateString, end: dateString, doctorId: z.string().optional() })
    .refine((q) => q.start <= q.end, {
      message: 'start must be on or before end',
      path: ['start'],
    })
    .refine(
      (q) =>
        (Date.parse(`${q.end}T00:00:00Z`) - Date.parse(`${q.start}T00:00:00Z`)) / 86_400_000 <=
        MAX_CALENDAR_RANGE_DAYS,
      {
        message: `Date range cannot exceed ${MAX_CALENDAR_RANGE_DAYS} days`,
        path: ['end'],
      }
    ),
  response: z.looseObject({
    days: z.array(weekDay),
    timeSlots: z.array(z.string()),
    stats: calendarStats,
  }),
} as const;
export type CalendarRangeResponse = z.infer<typeof range.response>;

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

// Per-endpoint query TYPES, derived from the very schemas `validate()` runs above.
//
// There used to be ONE loose `calendarQuery` view here — every field optional,
// every field a plain `string` — that all six handlers typed themselves from. It
// was a type-lie in the direction that hurts: `validate({ query: week.query })`
// had already proved `date` present and a real calendar date, but the handler's
// generic said `string | undefined`, so each one re-checked what the boundary
// guaranteed, and `/month-availability` could read `req.query.date` (always
// undefined there) without a compile error. Typing from the endpoint's own schema
// makes each handler see exactly the query its route validated.
export type CalendarWeekQuery = z.infer<typeof week.query>;
export type CalendarMonthQuery = z.infer<typeof month.query>;
export type CalendarRangeQuery = z.infer<typeof range.query>;
export type CalendarStatsQuery = z.infer<typeof stats.query>;
export type AvailableSlotsQuery = z.infer<typeof availableSlots.query>;
export type MonthAvailabilityQuery = z.infer<typeof monthAvailability.query>;
