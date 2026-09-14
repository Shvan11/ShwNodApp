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
 *  - the two **transforms** that fold the flat slot rows into that grid;
 *  - the `MaxAppointmentsPerSlot` option read and the throttled calendar-horizon
 *    check, which are shared by every one of those reads.
 *
 * All of it is pure except `getMaxAppointmentsPerSlot` (one option read) and
 * `noteCalendarRange` (fire-and-forget logging).
 */

import { log } from '../../utils/logger.js';
import { getOption } from '../database/queries/options-queries.js';
import { ensureCalendarRange } from '../database/queries/calendar-queries.js';

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
 * Note whether the calendar still extends `daysAhead` into the future.
 *
 * `ensureCalendarRange()` is REPORT-ONLY despite its name — a `MAX(app_date)`
 * aggregate over the whole `calendar` table. It extends nothing; `POST
 * /api/calendar/regenerate` → `fillCalendar()` is the only thing that writes
 * slots. All five reads in this file used to `await` it and then discard the
 * result, so every calendar render — week, month, range, day slots, month
 * availability — paid for an aggregate whose answer nobody looked at, and the
 * "Ensure calendar has enough future dates" comment above each call was simply
 * untrue.
 *
 * Now the check is what it can actually be: throttled to once an hour per
 * process, run OFF the request path (never awaited), and it LOGS when the
 * calendar really has run short — which is the one thing the result was ever
 * good for, and the prompt to run the regenerate endpoint.
 */
export function noteCalendarRange(daysAhead: number): void {
  const now = Date.now();
  if (now - lastCalendarRangeCheck < CALENDAR_RANGE_CHECK_INTERVAL_MS) return;
  lastCalendarRangeCheck = now;

  void ensureCalendarRange(daysAhead)
    .then((result) => {
      if (result?.status === 'Calendar needs updating') {
        log.warn(
          'Calendar does not extend far enough ahead — run POST /api/calendar/regenerate',
          {
            daysAhead,
            previousMaxDate: result.previousMaxDate,
            neededThrough: result.newMaxDate,
          }
        );
      }
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
  app_date?: string;
  person_id?: number | null;
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
  const d = new Date(weekStart);
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
  const d = new Date(date);
  d.setDate(1);
  // Format in local timezone to avoid UTC conversion
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Get month end (last day of month)
export function getMonthEnd(date: Date): string {
  const d = new Date(date);
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  // Format in local timezone to avoid UTC conversion
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Get calendar grid start (Saturday before or at month start)
export function getCalendarGridStart(date: Date): string {
  const monthStart = new Date(getMonthStart(date));
  return getWeekStart(monthStart);
}

// Get calendar grid end (Thursday after or at month end, excluding Friday)
export function getCalendarGridEnd(date: Date): string {
  const monthEnd = new Date(getMonthEnd(date));
  const gridEnd = new Date(monthEnd);
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
        app_date: item.slotDateTime, // Add app_date for compatibility with EditAppointmentForm
        person_id: item.personID // Add person_id (capitalized) for compatibility
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

export function transformToMonthlyStructure(
  flatData: CalendarSlotData[],
  gridStart: string,
  gridEnd: string,
  maxAppointmentsPerSlot: number = 3,
  holidayMap: Map<string, Holiday> = new Map()
): { days: MonthlyDayData[] } {
  const dayMap: Record<string, MonthlyDayData> = {};
  const now = new Date();

  // Group data by date
  flatData.forEach((item) => {
    // CalendarDate is already a string in format 'YYYY-MM-DD' - use directly (avoids UTC issues)
    const dateKey = item.calendarDate;

    if (!dayMap[dateKey]) {
      const holiday = holidayMap.get(dateKey);
      dayMap[dateKey] = {
        date: dateKey,
        dayName: item.dayName,
        dayOfWeek: item.dayOfWeek,
        appointments: [],
        appointmentCount: 0,
        totalSlots: 0,
        availableSlots: 0,
        bookedSlots: 0,
        isHoliday: !!holiday,
        holidayId: holiday ? holiday.id : null,
        holidayName: holiday ? holiday.holiday_name : null,
        holidayDescription: holiday ? holiday.description : null
      };
    }

    dayMap[dateKey].totalSlots++;

    // Only count valid appointments
    if (item.appointment_id && item.appointment_id > 0) {
      const appointment: AppointmentInfo = {
        appointment_id: item.appointment_id,
        appDetail: item.appDetail,
        drID: item.drID,
        patientName: item.patientName,
        personID: item.personID,
        time: item.slotDateTime.split(' ')[1].substring(0, 5) // Extract time from 'YYYY-MM-DD HH:MM:SS'
      };

      dayMap[dateKey].appointments.push(appointment);
      dayMap[dateKey].appointmentCount++;
    }

    // Count slot status
    // Parse slotDateTime string properly without timezone conversion
    const slotDateTime = new Date(item.slotDateTime.replace(' ', 'T'));
    if (slotDateTime >= now) {
      if (
        item.slotStatus === 'available' ||
        (item.slotStatus === 'booked' &&
          item.appointmentCount < maxAppointmentsPerSlot)
      ) {
        dayMap[dateKey].availableSlots++;
      }
      if (item.slotStatus === 'booked' || item.slotStatus === 'full') {
        dayMap[dateKey].bookedSlots++;
      }
    }
  });

  // Fill in missing days in the grid range
  const start = new Date(gridStart);
  const end = new Date(gridEnd);
  const allDays: MonthlyDayData[] = [];

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    // Friday (getDay() === 5) is a non-working day with no column in the 6-day
    // Sat–Thu month grid. Skip it so each run of 6 cells maps to one Sat–Thu week
    // and weekday columns stay aligned (otherwise every Friday shifts the rest).
    if (d.getDay() === 5) continue;

    // Use local date format to avoid timezone shifts
    const dateKey = formatLocalDate(d);

    if (dayMap[dateKey]) {
      // Calculate utilization
      const utilization =
        dayMap[dateKey].totalSlots > 0
          ? Math.round(
              (dayMap[dateKey].bookedSlots / dayMap[dateKey].totalSlots) * 100
            )
          : 0;

      dayMap[dateKey].utilizationPercent = utilization;
      allDays.push(dayMap[dateKey]);
    } else {
      // Empty day - check if it's a holiday
      const holiday = holidayMap.get(dateKey);
      allDays.push({
        date: dateKey,
        dayName: d.toLocaleDateString('en-US', { weekday: 'short' }),
        dayOfWeek: d.getDay() + 1,
        appointments: [],
        appointmentCount: 0,
        totalSlots: 0,
        availableSlots: 0,
        bookedSlots: 0,
        utilizationPercent: 0,
        isHoliday: !!holiday,
        holidayId: holiday ? holiday.id : null,
        holidayName: holiday ? holiday.holiday_name : null,
        holidayDescription: holiday ? holiday.description : null
      });
    }
  }

  return {
    days: allDays
  };
}
