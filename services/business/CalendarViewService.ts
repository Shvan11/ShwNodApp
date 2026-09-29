/**
 * Calendar view assembly.
 *
 * Split out of `routes/api/calendar.routes.ts` (C2 — pure move). The route layer
 * is left with request adaptation + the DB calls; everything below is the part
 * that has nothing to do with HTTP:
 *
 *  - the **view-model types** the five calendar reads return;
 *  - the **week/month grid math** — the clinic week runs Saturday→Thursday and
 *    Friday has no column at all, which is why these are hand-rolled instead of
 *    a date library's `startOfWeek`;
 *  - the **grid builders**: the week/day grid and the month view are built from
 *    the appointments themselves (`buildGridDays`, `buildMonthDays`), and the
 *    booking picker's two reads fold the `calendar` slot table
 *    (`transformToCalendarStructure`);
 *  - the `MaxAppointmentsPerSlot` option read and the throttled calendar-horizon
 *    check, which are shared by every one of those reads.
 *
 * All of it is pure except `getMaxAppointmentsPerSlot` (one option read) and
 * `noteCalendarRange` (fire-and-forget; extends the slot table when short).
 */

import { log } from '../../utils/logger.js';
import { parseLocalDate } from '../../utils/date.js';
import { getOption } from '../database/queries/options-queries.js';
import {
  ensureCalendarRange,
  fillCalendar,
  type CalendarAppointmentRow,
  type CalendarStatsRow,
} from '../database/queries/calendar-queries.js';

// ============================================================================
// CLINIC OPTIONS / CALENDAR HORIZON
// ============================================================================

/** Fallback when the `MaxAppointmentsPerSlot` option row is missing or unparseable. */
export const DEFAULT_MAX_APPOINTMENTS_PER_SLOT = 3;

/**
 * Read the `MaxAppointmentsPerSlot` clinic option.
 *
 * Was copy-pasted verbatim into five handlers in this file, each with its own
 * literal default — so a change to the fallback had to be made in five places or
 * the views silently disagreed. `/range` reads it as part of a batched
 * multi-option query and keeps doing so.
 */
export async function getMaxAppointmentsPerSlot(): Promise<number> {
  const raw = await getOption('MaxAppointmentsPerSlot');
  const parsed = raw != null ? parseInt(raw, 10) : NaN;
  return Number.isNaN(parsed) ? DEFAULT_MAX_APPOINTMENTS_PER_SLOT : parsed;
}

/**
 * How often the calendar-horizon check may actually run (per process).
 */
const CALENDAR_RANGE_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
let lastCalendarRangeCheck = 0;

/**
 * Keep the booking picker's slot table `daysAhead` ahead of today.
 *
 * `ensureCalendarRange()` is a report (a `MAX(app_date)` over `calendar`). This
 * runs it at most once an hour per process, OFF the request path (never
 * awaited), and when the table has run short it now EXTENDS it with
 * `fillCalendar()`: that fill is additive and idempotent, and nothing else ever
 * ran it except a manual Regenerate, so a year after the last one the picker
 * showed every day as unbookable with no explanation (audit FE-F10-2, "the
 * horizon"). The week grid no longer depends on this table at all.
 */
export function noteCalendarRange(daysAhead: number): void {
  const now = Date.now();
  if (now - lastCalendarRangeCheck < CALENDAR_RANGE_CHECK_INTERVAL_MS) return;
  lastCalendarRangeCheck = now;

  void ensureCalendarRange(daysAhead)
    .then(async (result) => {
      if (result?.status !== 'Calendar needs updating') return;
      const { DaysAdded } = await fillCalendar();
      log.info('Calendar slot table extended', {
        daysAhead,
        previousMaxDate: result.previousMaxDate,
        slotsAdded: DaysAdded,
      });
    })
    .catch((error: unknown) => {
      log.warn('Calendar range check failed', { error: (error as Error).message });
    });
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface CalendarSlotData {
  slotDateTime: string;
  calendarDate: string;
  dayName: string;
  dayOfWeek: number;
  appointment_id: number | null;
  appDetail: string | null;
  drID: number | null;
  patientName: string | null;
  personID: number | null;
  slotStatus: string;
  appointmentCount: number;
}

export interface Holiday {
  id: number;
  holiday_date: Date | string;
  holiday_name: string;
  description: string;
}

export interface SlotInfo {
  appointments: AppointmentInfo[];
  appointmentCount: number;
  slotStatus: string;
}

export interface AppointmentInfo {
  appointment_id: number;
  appDetail: string | null;
  drID: number | null;
  patientName: string | null;
  personID: number | null;
  slotStatus?: string;
  slotDateTime?: string;
  time?: string;
}

export interface DayData {
  date: string;
  dayName: string;
  dayOfWeek: number;
  appointments: Record<string, SlotInfo>;
  isHoliday: boolean;
  holidayId: number | null;
  holidayName: string | null;
  holidayDescription: string | null;
}

export interface MonthlyDayData {
  date: string;
  dayName: string;
  dayOfWeek: number;
  appointments: AppointmentInfo[];
  appointmentCount: number;
  totalSlots: number;
  availableSlots: number;
  bookedSlots: number;
  utilizationPercent?: number;
  isHoliday: boolean;
  holidayId: number | null;
  holidayName: string | null;
  holidayDescription: string | null;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Format a Date object to YYYY-MM-DD using local timezone
 * Avoids UTC conversion that can shift dates by a day
 */
/**
 * Parse a `YYYY-MM-DD` calendar boundary to a LOCAL-midnight Date.
 *
 * `new Date('2026-09-15')` parses as UTC midnight, which every local getter below then reads back
 * one day earlier on any negative-UTC-offset host — the whole month grid would shift by a day and
 * the Saturday-start week maths would land on the wrong weekday. The app is wall-clock throughout
 * (CLAUDE.md §Database: `date`/`timestamp` are WITHOUT time zone), so a calendar boundary must be
 * parsed as local. Latent today only because prod runs `TZ=Asia/Baghdad` (+3).
 *
 * Falls back to the raw parse for anything that is not a plain date string (the callers all pass
 * one — these are this module's own formatted outputs — so the fallback is unreachable defence).
 */
function parseCalendarDate(value: string): Date {
  return parseLocalDate(value) ?? new Date(value);
}

export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Week starts on Saturday (day 6)
export function getWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  // Calculate days to subtract to get to Saturday
  // Saturday = 6, Sunday = 0, Monday = 1, etc.
  const diff = day === 6 ? 0 : day + 1;
  const weekStart = new Date(d);
  weekStart.setDate(weekStart.getDate() - diff);
  // Format in local timezone to avoid UTC conversion
  const year = weekStart.getFullYear();
  const month = String(weekStart.getMonth() + 1).padStart(2, '0');
  const dayNum = String(weekStart.getDate()).padStart(2, '0');
  return `${year}-${month}-${dayNum}`;
}

export function getWeekEnd(weekStart: string): string {
  const d = parseCalendarDate(weekStart);
  // Week: Sat, Sun, Mon, Tue, Wed, Thu (6 days, excluding Friday)
  d.setDate(d.getDate() + 5); // Thursday end (5 days after Saturday)
  // Format in local timezone to avoid UTC conversion
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const dayNum = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${dayNum}`;
}

// Get month start (first day of month)
export function getMonthStart(date: Date): string {
  const d = new Date(date.getFullYear(), date.getMonth(), 1);
  // Format in local timezone to avoid UTC conversion
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Get month end (last day of month)
export function getMonthEnd(date: Date): string {
  // Day 0 of the NEXT month = the last day of this one. Built in one step: the old
  // `setMonth(+1)` then `setDate(0)` overflowed from the 29th–31st (Oct 31 → "Nov
  // 31" = Dec 1 → Nov 30), so the grid spilled into the next month (FE-F10-5).
  const d = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  // Format in local timezone to avoid UTC conversion
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Get calendar grid start (Saturday before or at month start)
export function getCalendarGridStart(date: Date): string {
  return getWeekStart(parseCalendarDate(getMonthStart(date)));
}

// Get calendar grid end (Thursday after or at month end, excluding Friday)
export function getCalendarGridEnd(date: Date): string {
  const gridEnd = parseCalendarDate(getMonthEnd(date));
  const dayOfWeek = gridEnd.getDay();
  // Add days to get to Thursday (day 4), skip Friday
  let daysToAdd: number;
  if (dayOfWeek === 4) {
    daysToAdd = 0; // Already Thursday
  } else if (dayOfWeek === 5) {
    daysToAdd = 6; // Friday -> next Thursday (skip Friday)
  } else if (dayOfWeek === 6) {
    daysToAdd = 5; // Saturday -> Thursday
  } else if (dayOfWeek === 0) {
    daysToAdd = 4; // Sunday -> Thursday
  } else {
    daysToAdd = 4 - dayOfWeek; // Mon-Wed -> Thursday
  }
  gridEnd.setDate(gridEnd.getDate() + daysToAdd);
  // Format in local timezone to avoid UTC conversion
  const year = gridEnd.getFullYear();
  const month = String(gridEnd.getMonth() + 1).padStart(2, '0');
  const dayNum = String(gridEnd.getDate()).padStart(2, '0');
  return `${year}-${month}-${dayNum}`;
}

export function transformToCalendarStructure(
  flatData: CalendarSlotData[],
  maxAppointmentsPerSlot: number = 3,
  holidayMap: Map<string, Holiday> = new Map()
): { days: DayData[]; timeSlots: string[] } {
  const days: Record<string, DayData> = {};
  const timeSlots = new Set<string>();

  flatData.forEach((item) => {
    // CalendarDate is now a string in format 'YYYY-MM-DD' - use directly
    const dateKey = item.calendarDate;

    if (!days[dateKey]) {
      const holiday = holidayMap.get(dateKey);
      days[dateKey] = {
        date: dateKey,
        dayName: item.dayName,
        dayOfWeek: item.dayOfWeek,
        appointments: {},
        isHoliday: !!holiday,
        holidayId: holiday ? holiday.id : null,
        holidayName: holiday ? holiday.holiday_name : null,
        holidayDescription: holiday ? holiday.description : null
      };
    }

    // SlotDateTime is now a string in format 'YYYY-MM-DD HH:MM:SS' - extract time portion
    // This avoids timezone conversion issues
    const timePart = item.slotDateTime.split(' ')[1]; // Get 'HH:MM:SS'
    const timeKey = timePart.substring(0, 5); // Get 'HH:MM'
    timeSlots.add(timeKey);

    // MULTIPLE APPOINTMENTS SUPPORT: Group appointments by time slot
    if (!days[dateKey].appointments[timeKey]) {
      days[dateKey].appointments[timeKey] = {
        appointments: [],
        appointmentCount: 0,
        slotStatus: 'available'
      };
    }

    // Only add valid appointments (skip empty slots with appointmentID = 0)
    if (item.appointment_id && item.appointment_id > 0) {
      days[dateKey].appointments[timeKey].appointments.push({
        appointment_id: item.appointment_id,
        appDetail: item.appDetail,
        drID: item.drID,
        patientName: item.patientName,
        personID: item.personID,
        slotStatus: item.slotStatus,
        slotDateTime: item.slotDateTime,
      });
    }

    // Update appointment count
    days[dateKey].appointments[timeKey].appointmentCount =
      days[dateKey].appointments[timeKey].appointments.length;

    // Determine slot status based on appointment count and time
    // Parse slotDateTime string properly without timezone conversion
    const slotDateTime = new Date(item.slotDateTime.replace(' ', 'T'));
    const now = new Date();
    const appointmentCount =
      days[dateKey].appointments[timeKey].appointmentCount;

    if (slotDateTime < now) {
      days[dateKey].appointments[timeKey].slotStatus = 'past';
    } else if (appointmentCount >= maxAppointmentsPerSlot) {
      days[dateKey].appointments[timeKey].slotStatus = 'full';
    } else if (appointmentCount > 0) {
      days[dateKey].appointments[timeKey].slotStatus = 'booked';
    } else {
      days[dateKey].appointments[timeKey].slotStatus = 'available';
    }
  });

  return {
    days: Object.values(days).sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    ),
    timeSlots: Array.from(timeSlots).sort((a, b) => {
      // Sort time slots chronologically
      const timeA = new Date(`1970-01-01T${a}:00`);
      const timeB = new Date(`1970-01-01T${b}:00`);
      return timeA.getTime() - timeB.getTime();
    })
  };
}

// ============================================================================
// GRID BUILDERS — from the appointments, not the slot table (audit FE-F10-2)
// ============================================================================

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Every working day (Friday skipped) from `start` to `end` inclusive, as local dates. */
function eachWorkingDay(start: string, end: string): Date[] {
  const out: Date[] = [];
  const last = parseCalendarDate(end);
  for (let d = parseCalendarDate(start); d <= last; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 5) continue; // Friday: the clinic's one day off, no column
    out.push(new Date(d));
  }
  return out;
}

/** `'YYYY-MM-DD HH:MM:SS'` → `['YYYY-MM-DD', 'HH:MM']`. */
function splitSlotDateTime(slotDateTime: string): [string, string] {
  const [datePart, timePart = '00:00'] = slotDateTime.split(' ');
  return [datePart, timePart.substring(0, 5)];
}

function toAppointmentInfo(a: CalendarAppointmentRow, time: string): AppointmentInfo {
  return {
    appointment_id: a.appointment_id,
    appDetail: a.app_detail,
    drID: a.dr_id,
    patientName: a.patient_name,
    personID: a.person_id,
    slotDateTime: a.slotDateTime,
    time,
  };
}

/** `appointments` grouped by day, then by 'HH:MM', plus the clinic-wide count per slot. */
function indexAppointments(
  appointments: CalendarAppointmentRow[],
  doctorId: number | null
): {
  shown: Map<string, Map<string, CalendarAppointmentRow[]>>;
  clinicCount: Map<string, number>;
} {
  const shown = new Map<string, Map<string, CalendarAppointmentRow[]>>();
  const clinicCount = new Map<string, number>();
  for (const a of appointments) {
    const [date, time] = splitSlotDateTime(a.slotDateTime);
    const key = `${date} ${time}`;
    clinicCount.set(key, (clinicCount.get(key) ?? 0) + 1);
    if (doctorId != null && a.dr_id !== doctorId) continue;
    let day = shown.get(date);
    if (!day) {
      day = new Map();
      shown.set(date, day);
    }
    const slot = day.get(time);
    if (slot) slot.push(a);
    else day.set(time, [a]);
  }
  return { shown, clinicCount };
}

function holidayFields(holiday: Holiday | undefined) {
  return {
    isHoliday: !!holiday,
    holidayId: holiday ? holiday.id : null,
    holidayName: holiday ? holiday.holiday_name : null,
    holidayDescription: holiday ? holiday.description : null,
  };
}

export interface GridBuildInput {
  start: string;
  end: string;
  /** Every appointment in the span, every doctor (the doctor filter is applied here). */
  appointments: CalendarAppointmentRow[];
  doctorId: number | null;
  /** The configured slot times ('HH:MM', ascending). */
  configuredTimes: string[];
  /** Configured times hidden by the early/late setting (shown anyway if booked). */
  hiddenTimes: ReadonlySet<string>;
  maxAppointmentsPerSlot: number;
  holidayMap: Map<string, Holiday>;
  now?: Date;
}

/**
 * The week/day grid for `/range`: a column for every working day in the span and
 * a row for every visible configured time PLUS every time that has an appointment
 * (owner decision on FE-F10-2). So nothing can drop out of the grid: a past day,
 * a walk-in at 15:07, an appointment in a hidden early/late row, or one at a time
 * since deleted from Calendar Times all render. A slot is `full` against the
 * CLINIC-wide count (the `MaxAppointmentsPerSlot` rule is per clinic slot), even
 * when the grid is filtered to one doctor. Stats cover the configured rows of the
 * non-holiday days and follow the doctor filter.
 */
export function buildGridDays(input: GridBuildInput): {
  days: DayData[];
  timeSlots: string[];
  stats: CalendarStatsRow;
} {
  const now = input.now ?? new Date();
  const workingDays = eachWorkingDay(input.start, input.end);
  const { shown, clinicCount } = indexAppointments(input.appointments, input.doctorId);

  const visibleConfigured = input.configuredTimes.filter((t) => !input.hiddenTimes.has(t));
  const rows = new Set(visibleConfigured);
  for (const d of workingDays) {
    for (const time of shown.get(formatLocalDate(d))?.keys() ?? []) rows.add(time);
  }
  const timeSlots = [...rows].sort();
  const capacityRows = new Set(visibleConfigured);

  let totalSlots = 0;
  let bookedSlots = 0;
  let pastSlots = 0;
  let availableSlots = 0;

  const days: DayData[] = workingDays.map((d) => {
    const date = formatLocalDate(d);
    const holiday = input.holidayMap.get(date);
    const dayShown = shown.get(date);
    const appointments: Record<string, SlotInfo> = {};

    for (const time of timeSlots) {
      const inSlot = dayShown?.get(time) ?? [];
      const clinicWide = clinicCount.get(`${date} ${time}`) ?? 0;
      const isPast = new Date(`${date}T${time}:00`) < now;
      const slotStatus = isPast
        ? 'past'
        : clinicWide >= input.maxAppointmentsPerSlot
          ? 'full'
          : inSlot.length > 0
            ? 'booked'
            : 'available';
      appointments[time] = {
        appointments: inSlot.map((a) => ({ ...toAppointmentInfo(a, time), slotStatus })),
        appointmentCount: inSlot.length,
        slotStatus,
      };

      if (!holiday && capacityRows.has(time)) {
        totalSlots++;
        if (inSlot.length > 0) bookedSlots++;
        else if (isPast) pastSlots++;
        else availableSlots++;
      }
    }

    return {
      date,
      dayName: DAY_NAMES[d.getDay()],
      dayOfWeek: d.getDay() + 1,
      appointments,
      ...holidayFields(holiday),
    };
  });

  return {
    days,
    timeSlots,
    stats: {
      weekStart: input.start,
      weekEnd: input.end,
      totalSlots,
      availableSlots,
      bookedSlots,
      pastSlots,
      utilizationPercent: totalSlots > 0 ? Math.round((bookedSlots / totalSlots) * 10000) / 100 : 0,
    },
  };
}

export interface MonthBuildInput {
  gridStart: string;
  gridEnd: string;
  appointments: CalendarAppointmentRow[];
  doctorId: number | null;
  configuredTimes: string[];
  maxAppointmentsPerSlot: number;
  holidayMap: Map<string, Holiday>;
  now?: Date;
}

/**
 * The month view: a cell per working day of the Sat–Thu grid with that day's
 * appointments (every one, whatever its time) and the slot tallies. Capacity is
 * the configured times; a slot is available while its clinic-wide count is under
 * `MaxAppointmentsPerSlot` and it is still ahead of `now`.
 */
export function buildMonthDays(input: MonthBuildInput): { days: MonthlyDayData[] } {
  const now = input.now ?? new Date();
  const { shown, clinicCount } = indexAppointments(input.appointments, input.doctorId);

  const days = eachWorkingDay(input.gridStart, input.gridEnd).map((d): MonthlyDayData => {
    const date = formatLocalDate(d);
    const holiday = input.holidayMap.get(date);
    const dayShown = shown.get(date);
    const appointments: AppointmentInfo[] = [];
    for (const [time, list] of [...(dayShown ?? new Map<string, CalendarAppointmentRow[]>())].sort(([a], [b]) => a.localeCompare(b))) {
      for (const a of list) appointments.push(toAppointmentInfo(a, time));
    }

    let totalSlots = 0;
    let bookedSlots = 0;
    let availableSlots = 0;
    if (!holiday) {
      for (const time of input.configuredTimes) {
        totalSlots++;
        if ((dayShown?.get(time)?.length ?? 0) > 0) bookedSlots++;
        const clinicWide = clinicCount.get(`${date} ${time}`) ?? 0;
        if (new Date(`${date}T${time}:00`) >= now && clinicWide < input.maxAppointmentsPerSlot) {
          availableSlots++;
        }
      }
    }

    return {
      date,
      dayName: DAY_NAMES[d.getDay()],
      dayOfWeek: d.getDay() + 1,
      appointments,
      appointmentCount: appointments.length,
      totalSlots,
      availableSlots,
      bookedSlots,
      utilizationPercent: totalSlots > 0 ? Math.round((bookedSlots / totalSlots) * 100) : 0,
      ...holidayFields(holiday),
    };
  });

  return { days };
}
