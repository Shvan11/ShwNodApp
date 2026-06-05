/**
 * Calendar API Routes for Shwan Orthodontics
 *
 * Provides optimized calendar endpoints that work with existing tblcalender system
 * Uses ProcWeeklyCalendarOptimized and ProcCalendarStatsOptimized procedures
 */

import { Router, type Request, type Response } from 'express';
import { sql } from 'kysely';
import { getKysely } from '../services/database/kysely.js';
import { log } from '../utils/logger.js';
import { validate } from '../middleware/validate.js';
import { sendData, ErrorResponses } from '../utils/error-response.js';
import { getHolidaysInRange } from '../services/database/queries/holiday-queries.js';
import {
  getWeeklyCalendarSlots,
  getCalendarStats,
  ensureCalendarRange,
  fillCalendar,
} from '../services/database/queries/calendar-queries.js';
import * as calendar from '../shared/contracts/calendar.contract.js';

const router = Router();

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

type CalendarQueryParams = calendar.CalendarQueryParams;

interface CalendarSlotData {
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

interface Holiday {
  id: number;
  holiday_date: Date | string;
  holiday_name: string;
  description: string;
}

interface SlotInfo {
  appointments: AppointmentInfo[];
  appointmentCount: number;
  slotStatus: string;
}

interface AppointmentInfo {
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

interface DayData {
  date: string;
  dayName: string;
  dayOfWeek: number;
  appointments: Record<string, SlotInfo>;
  isHoliday: boolean;
  holidayId: number | null;
  holidayName: string | null;
  holidayDescription: string | null;
}

interface MonthlyDayData {
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

/**
 * GET /api/calendar/week
 * Returns complete weekly calendar data with time slots
 * Uses existing tblcalender system for optimal performance
 */
router.get(
  '/week',
  validate({ query: calendar.week.query }),
  async (
    req: Request<unknown, unknown, unknown, CalendarQueryParams>,
    res: Response
  ): Promise<void> => {
    try {
      const { date, doctorId } = req.query;

      const weekStart = getWeekStart(new Date(date as string));
      const weekEnd = getWeekEnd(weekStart);

      const filterMsg = doctorId
        ? ` (filtered by doctor id: ${doctorId})`
        : '';
      log.info(
        `📅 Fetching calendar data for week: ${weekStart} to ${weekEnd}${filterMsg}`
      );

      // Fetch max appointments per slot setting
      const db = getKysely();
      const { rows: maxAppointmentsSetting } = await sql<{ option_value: string | null }>`
        SELECT "option_value" FROM "options" WHERE "option_name" = ${'MaxAppointmentsPerSlot'}
      `.execute(db);
      const maxAppointmentsPerSlot =
        maxAppointmentsSetting.length > 0 && maxAppointmentsSetting[0].option_value != null
          ? parseInt(maxAppointmentsSetting[0].option_value, 10)
          : 3; // Default to 3 if not set

      log.info(`⚙️ Max appointments per slot: ${maxAppointmentsPerSlot}`);

      // Ensure calendar has enough future dates
      await ensureCalendarRange(60);

      // Fetch calendar data using optimized query with optional doctor filter
      const calendarData = await getWeeklyCalendarSlots(
        weekStart,
        weekEnd,
        doctorId ? parseInt(doctorId, 10) : null
      );

      // Fetch holidays for the week
      const holidays = await getHolidaysInRange(weekStart, weekEnd);
      const holidayMap = new Map<string, Holiday>(
        holidays.map((h) => {
          // holiday_date arrives as a 'YYYY-MM-DD' string from the pg date parser.
          const dateStr = String(h.holiday_date).split('T')[0];
          return [dateStr, h] as [string, Holiday];
        })
      );

      // Transform flat data into structured calendar format
      const structuredData = transformToCalendarStructure(
        calendarData,
        maxAppointmentsPerSlot,
        holidayMap
      );

      log.info(
        `✅ Calendar data retrieved: ${calendarData.length} slots, ${structuredData.days.length} days, ${holidays.length} holidays`
      );

      sendData(res, calendar.week.response, {
        weekStart,
        weekEnd,
        totalSlots: calendarData.length,
        doctorId: doctorId || null,
        maxAppointmentsPerSlot,
        holidays: holidays.length,
        ...structuredData
      });
    } catch (error) {
      log.error('❌ Calendar week API error:', error);
      ErrorResponses.internalError(res, 'Failed to fetch calendar data', error as Error);
    }
  }
);

/**
 * GET /api/calendar/month
 * Returns complete monthly calendar data with daily summaries
 * Uses existing tblcalender system for optimal performance
 */
router.get(
  '/month',
  validate({ query: calendar.month.query }),
  async (
    req: Request<unknown, unknown, unknown, CalendarQueryParams>,
    res: Response
  ): Promise<void> => {
    try {
      const { date, doctorId } = req.query;
      const dateStr = date as string;

      const gridStart = getCalendarGridStart(new Date(dateStr));
      const gridEnd = getCalendarGridEnd(new Date(dateStr));
      const monthStart = getMonthStart(new Date(dateStr));
      const monthEnd = getMonthEnd(new Date(dateStr));

      const filterMsg = doctorId
        ? ` (filtered by doctor id: ${doctorId})`
        : '';
      log.info(
        `📅 Fetching monthly calendar data: ${gridStart} to ${gridEnd}${filterMsg}`
      );

      // Fetch max appointments per slot setting
      const db = getKysely();
      const { rows: maxAppointmentsSetting } = await sql<{ option_value: string | null }>`
        SELECT "option_value" FROM "options" WHERE "option_name" = ${'MaxAppointmentsPerSlot'}
      `.execute(db);
      const maxAppointmentsPerSlot =
        maxAppointmentsSetting.length > 0 && maxAppointmentsSetting[0].option_value != null
          ? parseInt(maxAppointmentsSetting[0].option_value, 10)
          : 3;

      log.info(`⚙️ Max appointments per slot: ${maxAppointmentsPerSlot}`);

      // Ensure calendar has enough future dates
      await ensureCalendarRange(90);

      // Fetch calendar data using optimized query with optional doctor filter
      const calendarData = await getWeeklyCalendarSlots(
        gridStart,
        gridEnd,
        doctorId ? parseInt(doctorId, 10) : null
      );

      // Fetch holidays for the grid range
      const holidays = await getHolidaysInRange(gridStart, gridEnd);
      const holidayMap = new Map<string, Holiday>(
        holidays.map((h) => {
          // holiday_date arrives as a 'YYYY-MM-DD' string from the pg date parser.
          const dateStr = String(h.holiday_date).split('T')[0];
          return [dateStr, h] as [string, Holiday];
        })
      );

      // Transform to monthly structure
      const monthlyData = transformToMonthlyStructure(
        calendarData,
        gridStart,
        gridEnd,
        maxAppointmentsPerSlot,
        holidayMap
      );

      log.info(
        `✅ Monthly calendar data retrieved: ${monthlyData.days.length} days, ${holidays.length} holidays`
      );

      sendData(res, calendar.month.response, {
        monthStart,
        monthEnd,
        gridStart,
        gridEnd,
        doctorId: doctorId || null,
        maxAppointmentsPerSlot,
        holidays: holidays.length,
        ...monthlyData
      });
    } catch (error) {
      log.error('❌ Calendar month API error:', error);
      ErrorResponses.internalError(res, 'Failed to fetch monthly calendar data', error as Error);
    }
  }
);

/**
 * GET /api/calendar/stats
 * Returns calendar utilization statistics for the specified week
 */
router.get(
  '/stats',
  validate({ query: calendar.stats.query }),
  async (
    req: Request<unknown, unknown, unknown, CalendarQueryParams>,
    res: Response
  ): Promise<void> => {
    try {
      const { date } = req.query;

      const weekStart = getWeekStart(new Date(date as string));
      const weekEnd = getWeekEnd(weekStart);

      log.info(
        `📊 Fetching calendar stats for week: ${weekStart} to ${weekEnd}`
      );

      const stats = await getCalendarStats(weekStart, weekEnd);

      log.info(
        `✅ Calendar stats retrieved: ${stats?.utilizationPercent}% utilization`
      );

      sendData(res, calendar.stats.response, {
        stats: stats || {
          weekStart,
          weekEnd,
          totalSlots: 0,
          availableSlots: 0,
          bookedSlots: 0,
          pastSlots: 0,
          utilizationPercent: 0
        }
      });
    } catch (error) {
      log.error('❌ Calendar stats API error:', error);
      ErrorResponses.internalError(res, 'Failed to fetch calendar statistics', error as Error);
    }
  }
);

/**
 * POST /api/calendar/regenerate
 * Regenerates calendar entries by running FillCalender stored procedure
 * This adds any missing time slot combinations to tblcalender
 */
router.post(
  '/regenerate',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      log.info('🔄 Regenerating calendar entries...');

      const result = await fillCalendar();

      const daysAdded = result.DaysAdded || 0;
      log.info(`✅ Calendar regeneration complete: ${daysAdded} entries added`);

      sendData(res, calendar.regenerate.response, {
        entriesAdded: daysAdded,
        message: daysAdded > 0
          ? `Added ${daysAdded} missing calendar entries`
          : 'Calendar is already up to date'
      });
    } catch (error) {
      log.error('❌ Calendar regeneration error:', error);
      ErrorResponses.internalError(res, 'Failed to regenerate calendar', error as Error);
    }
  }
);

/**
 * GET /api/calendar/available-slots
 * Returns ALL time slots with full appointment details for a specific date
 */
router.get(
  '/available-slots',
  validate({ query: calendar.availableSlots.query }),
  async (
    req: Request<unknown, unknown, unknown, CalendarQueryParams>,
    res: Response
  ): Promise<void> => {
    try {
      const { date } = req.query;

      log.info(`🕐 Fetching all slots with details for: ${date}`);

      // Fetch max appointments per slot setting
      const db = getKysely();
      const { rows: maxAppointmentsSetting } = await sql<{ option_value: string | null }>`
        SELECT "option_value" FROM "options" WHERE "option_name" = ${'MaxAppointmentsPerSlot'}
      `.execute(db);
      const maxAppointmentsPerSlot =
        maxAppointmentsSetting.length > 0 && maxAppointmentsSetting[0].option_value != null
          ? parseInt(maxAppointmentsSetting[0].option_value, 10)
          : 3;

      // Ensure calendar has enough future dates
      await ensureCalendarRange(60);

      // Fetch calendar data for the single day
      const calendarData = await getWeeklyCalendarSlots(date as string, date as string, null);

      // Transform data to get all slots with full details
      const structuredData = transformToCalendarStructure(
        calendarData,
        maxAppointmentsPerSlot
      );

      const allSlots: Array<{
        date: string;
        time: string;
        dateTime: string;
        slotStatus: string;
        appointmentCount: number;
        appointments: AppointmentInfo[];
      }> = [];
      let availableCount = 0;

      if (structuredData.days.length > 0) {
        const dayData = structuredData.days[0];
        structuredData.timeSlots.forEach((timeSlot) => {
          const slotInfo = dayData.appointments[timeSlot];
          if (slotInfo) {
            const slotDateTime = new Date(`${dayData.date}T${timeSlot}:00`);

            const slotData = {
              date: dayData.date,
              time: timeSlot,
              dateTime: slotDateTime.toISOString(),
              slotStatus: slotInfo.slotStatus,
              appointmentCount: slotInfo.appointmentCount,
              appointments: slotInfo.appointments || []
            };

            allSlots.push(slotData);

            if (slotInfo.slotStatus === 'available') {
              availableCount++;
            }
          }
        });
      }

      log.info(
        `✅ Found ${allSlots.length} total slots, ${availableCount} available for ${date}`
      );

      sendData(res, calendar.availableSlots.response, {
        date,
        slots: allSlots,
        totalSlots: allSlots.length,
        availableCount,
        maxAppointmentsPerSlot
      });
    } catch (error) {
      log.error('❌ Available slots API error:', error);
      ErrorResponses.internalError(res, 'Failed to fetch available slots', error as Error);
    }
  }
);

/**
 * GET /api/calendar/month-availability
 * Returns availability summary for each day in a date range (optimized for month view)
 */
router.get(
  '/month-availability',
  validate({ query: calendar.monthAvailability.query }),
  async (
    req: Request<unknown, unknown, unknown, CalendarQueryParams>,
    res: Response
  ): Promise<void> => {
    try {
      const { startDate, endDate } = req.query as { startDate: string; endDate: string };

      log.info(
        `📅 Fetching month availability: ${startDate} to ${endDate}`
      );

      // Fetch max appointments per slot setting
      const db = getKysely();
      const { rows: maxAppointmentsSetting } = await sql<{ option_value: string | null }>`
        SELECT "option_value" FROM "options" WHERE "option_name" = ${'MaxAppointmentsPerSlot'}
      `.execute(db);
      const maxAppointmentsPerSlot =
        maxAppointmentsSetting.length > 0 && maxAppointmentsSetting[0].option_value != null
          ? parseInt(maxAppointmentsSetting[0].option_value, 10)
          : 3;

      // Ensure calendar has enough future dates
      await ensureCalendarRange(60);

      // Fetch calendar data for the date range
      const calendarData = await getWeeklyCalendarSlots(startDate, endDate, null);

      // Fetch holidays for the date range
      const holidays = await getHolidaysInRange(startDate, endDate);
      const holidayMap: Record<
        string,
        { id: number; name: string; description: string | null }
      > = {};
      holidays.forEach((h) => {
        // holiday_date arrives as a 'YYYY-MM-DD' string from the pg date parser.
        const dateStr = String(h.holiday_date).split('T')[0];
        holidayMap[dateStr] = {
          id: h.id,
          name: h.holiday_name,
          description: h.description
        };
      });

      // Transform data
      const structuredData = transformToCalendarStructure(
        calendarData,
        maxAppointmentsPerSlot
      );

      // Calculate availability for each day
      const availability: Record<
        string,
        {
          availableCount: number;
          totalCount: number;
          appointmentCount: number;
          hasAvailability: boolean;
          isHoliday: boolean;
          holidayName: string | null;
          holidayDescription: string | null;
        }
      > = {};
      const now = new Date();

      structuredData.days.forEach((day) => {
        let availableCount = 0;
        let totalCount = 0;
        let appointmentCount = 0;

        structuredData.timeSlots.forEach((timeSlot) => {
          const slotInfo = day.appointments[timeSlot];
          if (slotInfo) {
            totalCount++;
            const slotDateTime = new Date(`${day.date}T${timeSlot}:00`);

            // Count appointments in this slot
            if (slotInfo.appointments && slotInfo.appointments.length > 0) {
              appointmentCount += slotInfo.appointments.length;
            }

            // Count available slots (including booked slots that can take more appointments)
            if (
              (slotInfo.slotStatus === 'available' ||
                slotInfo.slotStatus === 'booked') &&
              slotDateTime > now
            ) {
              availableCount++;
            }
          }
        });

        // Check if this day is a holiday
        const holiday = holidayMap[day.date];

        availability[day.date] = {
          availableCount,
          totalCount,
          appointmentCount,
          hasAvailability: availableCount > 0,
          isHoliday: !!holiday,
          holidayName: holiday ? holiday.name : null,
          holidayDescription: holiday ? holiday.description : null
        };
      });

      log.info(
        `✅ Month availability calculated for ${Object.keys(availability).length} days, ${holidays.length} holidays`
      );

      sendData(res, calendar.monthAvailability.response, {
        startDate,
        endDate,
        availability,
        holidays: holidayMap,
        maxAppointmentsPerSlot
      });
    } catch (error) {
      log.error('❌ Month availability API error:', error);
      ErrorResponses.internalError(res, 'Failed to fetch month availability', error as Error);
    }
  }
);

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Format a Date object to YYYY-MM-DD using local timezone
 * Avoids UTC conversion that can shift dates by a day
 */
function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Week starts on Saturday (day 6)
function getWeekStart(date: Date): string {
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

function getWeekEnd(weekStart: string): string {
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
function getMonthStart(date: Date): string {
  const d = new Date(date);
  d.setDate(1);
  // Format in local timezone to avoid UTC conversion
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Get month end (last day of month)
function getMonthEnd(date: Date): string {
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
function getCalendarGridStart(date: Date): string {
  const monthStart = new Date(getMonthStart(date));
  return getWeekStart(monthStart);
}

// Get calendar grid end (Thursday after or at month end, excluding Friday)
function getCalendarGridEnd(date: Date): string {
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

function transformToCalendarStructure(
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

function transformToMonthlyStructure(
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

export default router;
