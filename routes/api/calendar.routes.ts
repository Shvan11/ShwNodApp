/**
 * Calendar API Routes for Shwan Orthodontics
 *
 * The week/day grid (`/range`) and the month view (`/month`) are built from the
 * appointments themselves; the booking picker's two reads (`/available-slots`,
 * `/month-availability`) use the pre-generated `calendar` slot table, which the
 * admin `regenerate` write fills.
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
import {
  getWeeklyCalendarSlots,
  getAppointmentsInRange,
  getConfiguredTimeSlots,
  fillCalendar,
} from '../../services/database/queries/calendar-queries.js';
import { parseLocalDate } from '../../utils/date.js';
// The view-model types, the Sat→Thu grid math and the two transforms live in the
// service — see services/business/CalendarViewService.ts (C2).
import {
  getMaxAppointmentsPerSlot,
  getSlotSettings,
  noteCalendarRange,
  getMonthStart,
  getMonthEnd,
  getCalendarGridStart,
  getCalendarGridEnd,
  transformToCalendarStructure,
  buildGridDays,
  buildMonthDays,
  type Holiday,
  type AppointmentInfo,
} from '../../services/business/CalendarViewService.js';
import * as calendar from '../../shared/contracts/calendar.contract.js';

const router = Router();


/**
 * GET /api/calendar/month
 * The month view: every working day of the Sat–Thu grid around `date`, with its
 * appointments and slot tallies, built from the appointments (audit FE-F10-2).
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
      // Local midnight, not `new Date('YYYY-MM-DD')` (UTC) — the validator already
      // proved it is a calendar date (FE-F10-16).
      const day = parseLocalDate(date) ?? new Date();

      const gridStart = getCalendarGridStart(day);
      const gridEnd = getCalendarGridEnd(day);
      const monthStart = getMonthStart(day);
      const monthEnd = getMonthEnd(day);

      const { maxAppointmentsPerSlot, hiddenTimes } = await getSlotSettings();
      noteCalendarRange(90);

      const [appointments, holidays, configuredTimes] = await Promise.all([
        getAppointmentsInRange(gridStart, gridEnd),
        getHolidaysInRange(gridStart, gridEnd),
        getConfiguredTimeSlots(),
      ]);
      const holidayMap = new Map<string, Holiday>(
        // holiday_date arrives as a 'YYYY-MM-DD' string from the pg date parser.
        holidays.map((h) => [String(h.holiday_date).split('T')[0], h] as [string, Holiday])
      );

      // `stats` is the month's own utilisation, following the doctor filter
      // (audit FE-F10-6: the strip used to show one week's numbers).
      const monthlyData = buildMonthDays({
        gridStart,
        gridEnd,
        monthStart,
        monthEnd,
        appointments,
        doctorId: doctorId ? parseInt(doctorId, 10) : null,
        configuredTimes,
        hiddenTimes,
        maxAppointmentsPerSlot,
        holidayMap,
      });

      log.info(
        `✅ Monthly calendar: ${gridStart}..${gridEnd}, ${appointments.length} appointments, ${holidays.length} holidays`
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
 * The week/day grid for an ARBITRARY span of working days (start..end inclusive;
 * Fridays have no column), plus the utilisation stats for that span. Powers the
 * density-zoom Week grid, where the client picks N day-columns and pages the
 * anchor forward. One round-trip.
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

      // Max-per-slot + the early/late categories and the "show extended"
      // toggle that decide which rows render, in one read.
      const { maxAppointmentsPerSlot, hiddenTimes } = await getSlotSettings();

      noteCalendarRange(90);

      const [appointments, holidays, configuredTimes] = await Promise.all([
        getAppointmentsInRange(start, end),
        getHolidaysInRange(start, end),
        getConfiguredTimeSlots(),
      ]);
      const holidayMap = new Map<string, Holiday>(
        holidays.map((h) => [String(h.holiday_date).split('T')[0], h] as [string, Holiday])
      );

      // Built from the appointments (owner decision, audit FE-F10-2): every working
      // day of the span is a column, and the rows are the visible configured times
      // plus every time that has an appointment — so a past day, a walk-in, an
      // appointment in a hidden early/late row or at a deleted time all render.
      const { days, timeSlots, stats } = buildGridDays({
        start,
        end,
        appointments,
        doctorId: doctorId ? parseInt(doctorId, 10) : null,
        configuredTimes,
        hiddenTimes,
        maxAppointmentsPerSlot,
        holidayMap,
      });

      log.info(
        `✅ Calendar range ${start}..${end}: ${days.length} days, ${timeSlots.length} rows, ${appointments.length} appointments`
      );

      sendData(res, calendar.range.response, {
        start,
        end,
        doctorId: doctorId || null,
        maxAppointmentsPerSlot,
        holidays: holidays.length,
        stats,
        days,
        timeSlots,
      });
    } catch (error) {
      log.error('❌ Calendar range API error:', error);
      ErrorResponses.internalError(res, 'Failed to fetch calendar range', error as Error);
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
