/**
 * Calendar API Routes for Shwan Orthodontics
 *
 * Week / month / range / day-slot / month-availability reads over the
 * pre-generated `calendar` slot table, plus the admin `regenerate` write.
 *
 * This file is the HTTP layer only: validate, call the query module, hand the
 * rows to `CalendarViewService` and send. The grid math and the view-model
 * transforms live there (C2), because the Sat→Thu week and the skipped Friday
 * column are clinic rules, not routing.
 */

import { Router, type Request, type Response } from 'express';
import { log } from '../../utils/logger.js';
import { validate } from '../../middleware/validate.js';
import { authorize } from '../../middleware/auth.js';
import { FINANCE_ROLES } from '../../shared/auth/roles.js';
import { sendData, ErrorResponses } from '../../utils/error-response.js';
import { getHolidaysInRange } from '../../services/database/queries/holiday-queries.js';
import { getOptions } from '../../services/database/queries/options-queries.js';
import {
  getWeeklyCalendarSlots,
  getCalendarStats,
  getConfiguredTimeSlots,
  fillCalendar,
} from '../../services/database/queries/calendar-queries.js';
// The view-model types, the Sat→Thu grid math and the two transforms live in the
// service — see services/business/CalendarViewService.ts (C2).
import {
  DEFAULT_MAX_APPOINTMENTS_PER_SLOT,
  getMaxAppointmentsPerSlot,
  noteCalendarRange,
  getWeekStart,
  getWeekEnd,
  getMonthStart,
  getMonthEnd,
  getCalendarGridStart,
  getCalendarGridEnd,
  transformToCalendarStructure,
  transformToMonthlyStructure,
  type Holiday,
  type AppointmentInfo,
} from '../../services/business/CalendarViewService.js';
import * as calendar from '../../shared/contracts/calendar.contract.js';

const router = Router();


/**
 * GET /api/calendar/week
 * Returns complete weekly calendar data with time slots
 * Uses existing tblcalender system for optimal performance
 */
router.get(
  '/week',
  validate({ query: calendar.week.query }),
  async (
    req: Request<unknown, unknown, unknown, calendar.CalendarWeekQuery>,
    res: Response
  ): Promise<void> => {
    try {
      const { date, doctorId } = req.query;

      const weekStart = getWeekStart(new Date(date));
      const weekEnd = getWeekEnd(weekStart);

      const filterMsg = doctorId
        ? ` (filtered by doctor id: ${doctorId})`
        : '';
      log.info(
        `📅 Fetching calendar data for week: ${weekStart} to ${weekEnd}${filterMsg}`
      );

      const maxAppointmentsPerSlot = await getMaxAppointmentsPerSlot();

      log.info(`⚙️ Max appointments per slot: ${maxAppointmentsPerSlot}`);

      noteCalendarRange(60);

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
    req: Request<unknown, unknown, unknown, calendar.CalendarMonthQuery>,
    res: Response
  ): Promise<void> => {
    try {
      const { date, doctorId } = req.query;
      const dateStr = date;

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

      const maxAppointmentsPerSlot = await getMaxAppointmentsPerSlot();

      log.info(`⚙️ Max appointments per slot: ${maxAppointmentsPerSlot}`);

      noteCalendarRange(90);

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
 * GET /api/calendar/range
 * Returns week-shaped calendar data for an ARBITRARY span of working days
 * (start..end inclusive; Fridays excluded by getWeeklyCalendarSlots), plus the
 * utilisation stats for that span. Powers the density-zoom Week grid, where the
 * client picks N day-columns and pages the anchor forward. Mirrors /week but with
 * an explicit range and stats folded in (one round-trip).
 */
router.get(
  '/range',
  validate({ query: calendar.range.query }),
  async (
    req: Request<unknown, unknown, unknown, calendar.CalendarRangeQuery>,
    res: Response
  ): Promise<void> => {
    try {
      const { start, end, doctorId } = req.query as {
        start: string;
        end: string;
        doctorId?: string;
      };

      const filterMsg = doctorId ? ` (filtered by doctor id: ${doctorId})` : '';
      log.info(`📅 Fetching calendar range: ${start} to ${end}${filterMsg}`);

      // Read the slot settings in one shot: max-per-slot + the early/late
      // categories and the "show extended" toggle that decide which rows render.
      const optionMap = await getOptions([
        'MaxAppointmentsPerSlot',
        'CALENDAR_EARLY_SLOTS',
        'CALENDAR_LATE_SLOTS',
        'CALENDAR_SHOW_EXTENDED_SLOTS_DEFAULT',
      ]);
      const rawMax = optionMap.get('MaxAppointmentsPerSlot');
      const parsedMax = rawMax != null ? parseInt(rawMax, 10) : NaN;
      const maxAppointmentsPerSlot = Number.isNaN(parsedMax)
        ? DEFAULT_MAX_APPOINTMENTS_PER_SLOT
        : parsedMax;
      const parseList = (v: string | null | undefined): string[] =>
        v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
      const earlySlots = parseList(optionMap.get('CALENDAR_EARLY_SLOTS'));
      const lateSlots = parseList(optionMap.get('CALENDAR_LATE_SLOTS'));
      const showExtended = optionMap.get('CALENDAR_SHOW_EXTENDED_SLOTS_DEFAULT') === 'true';

      noteCalendarRange(90);

      const calendarData = await getWeeklyCalendarSlots(
        start,
        end,
        doctorId ? parseInt(doctorId, 10) : null
      );

      const holidays = await getHolidaysInRange(start, end);
      const holidayMap = new Map<string, Holiday>(
        holidays.map((h) => {
          const dateStr = String(h.holiday_date).split('T')[0];
          return [dateStr, h] as [string, Holiday];
        })
      );

      const structuredData = transformToCalendarStructure(
        calendarData,
        maxAppointmentsPerSlot,
        holidayMap
      );

      // The time rows come from the CONFIGURED times (tbltimes) — the live source
      // of truth — not the materialised calendar data, so deletes/adds reflect
      // immediately. Early/late rows are hidden unless "show extended" is on.
      const configuredTimes = await getConfiguredTimeSlots();
      const hidden = showExtended ? new Set<string>() : new Set([...earlySlots, ...lateSlots]);
      const timeSlots = configuredTimes.filter((t) => !hidden.has(t));

      const stats = await getCalendarStats(start, end);

      log.info(
        `✅ Calendar range retrieved: ${structuredData.days.length} days, ${timeSlots.length} time rows, ${holidays.length} holidays`
      );

      sendData(res, calendar.range.response, {
        start,
        end,
        doctorId: doctorId || null,
        maxAppointmentsPerSlot,
        holidays: holidays.length,
        stats,
        days: structuredData.days,
        timeSlots,
      });
    } catch (error) {
      log.error('❌ Calendar range API error:', error);
      ErrorResponses.internalError(res, 'Failed to fetch calendar range', error as Error);
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
    req: Request<unknown, unknown, unknown, calendar.CalendarStatsQuery>,
    res: Response
  ): Promise<void> => {
    try {
      const { date } = req.query;

      const weekStart = getWeekStart(new Date(date));
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
  // Rebuilds the whole slot grid — a clinic-configuration operation, not a
  // booking one, so it sits at the front-desk/admin tier rather than being open
  // to every authenticated session as it was.
  authorize(FINANCE_ROLES),
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
    req: Request<unknown, unknown, unknown, calendar.AvailableSlotsQuery>,
    res: Response
  ): Promise<void> => {
    try {
      const { date } = req.query;

      log.info(`🕐 Fetching all slots with details for: ${date}`);

      const maxAppointmentsPerSlot = await getMaxAppointmentsPerSlot();

      noteCalendarRange(60);

      // Fetch calendar data for the single day
      const calendarData = await getWeeklyCalendarSlots(date, date, null);

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
    req: Request<unknown, unknown, unknown, calendar.MonthAvailabilityQuery>,
    res: Response
  ): Promise<void> => {
    try {
      const { startDate, endDate } = req.query as { startDate: string; endDate: string };

      log.info(
        `📅 Fetching month availability: ${startDate} to ${endDate}`
      );

      const maxAppointmentsPerSlot = await getMaxAppointmentsPerSlot();

      noteCalendarRange(60);

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

export default router;
