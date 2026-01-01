/**
 * Calendar API Routes for Shwan Orthodontics
 *
 * Provides optimized calendar endpoints that work with existing tblcalender system
 * Uses ProcWeeklyCalendarOptimized and ProcCalendarStatsOptimized procedures
 */

import { Router, type Request, type Response } from 'express';
import {
  executeStoredProcedure,
  executeQuery,
  TYPES,
  type SqlParam
} from '../services/database/index.js';
import { logger } from '../services/core/Logger.js';
import { getHolidaysInRange } from '../services/database/queries/holiday-queries.js';

const router = Router();

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface CalendarQueryParams {
  date?: string;
  doctorId?: string;
  startDate?: string;
  endDate?: string;
}

interface DateParams {
  date: string;
}

interface EnsureRangeBody {
  daysAhead?: number;
}

interface CalendarSlotData {
  slotDateTime: string;
  calendarDate: string;
  dayName: string;
  dayOfWeek: number;
  appointmentID: number | null;
  appDetail: string | null;
  drID: number | null;
  patientName: string | null;
  personID: number | null;
  slotStatus: string;
  appointmentCount: number;
}

interface DayAppointment {
  appointmentID: number;
  appDetail: string;
  drID: number;
  patientName: string;
  appDate: Date;
  appTime: string;
}

interface CalendarStats {
  weekStart: string;
  weekEnd: string;
  totalSlots: number;
  availableSlots: number;
  bookedSlots: number;
  pastSlots: number;
  utilizationPercent: number;
}

interface TimeSlot {
  timeID: number;
  timeSlot: string;
  formattedTime: string;
}

interface Holiday {
  ID: number;
  Holidaydate: Date | string;
  HolidayName: string;
  Description: string;
}

interface SlotInfo {
  appointments: AppointmentInfo[];
  appointmentCount: number;
  slotStatus: string;
}

interface AppointmentInfo {
  appointmentID: number;
  appDetail: string | null;
  drID: number | null;
  patientName: string | null;
  personID: number | null;
  slotStatus?: string;
  slotDateTime?: string;
  AppDate?: string;
  PersonID?: number | null;
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
  async (
    req: Request<unknown, unknown, unknown, CalendarQueryParams>,
    res: Response
  ): Promise<void> => {
    try {
      const { date, doctorId } = req.query;

      if (!date) {
        res.status(400).json({
          success: false,
          error: 'Date parameter is required'
        });
        return;
      }

      const weekStart = getWeekStart(new Date(date));
      const weekEnd = getWeekEnd(weekStart);

      const filterMsg = doctorId
        ? ` (filtered by doctor ID: ${doctorId})`
        : '';
      logger.info(
        'SYS',
        `📅 Fetching calendar data for week: ${weekStart} to ${weekEnd}${filterMsg}`
      );

      // Fetch max appointments per slot setting
      const maxAppointmentsSetting = await executeQuery<string>(
        'SELECT OptionValue FROM tbloptions WHERE OptionName = @OptionName',
        [['OptionName', TYPES.NVarChar, 'MaxAppointmentsPerSlot']],
        (columns) => columns[0].value as string
      );
      const maxAppointmentsPerSlot =
        maxAppointmentsSetting.length > 0
          ? parseInt(maxAppointmentsSetting[0], 10)
          : 3; // Default to 3 if not set

      logger.info('SYS', `⚙️ Max appointments per slot: ${maxAppointmentsPerSlot}`);

      // Ensure calendar has enough future dates
      await executeStoredProcedure('ProcEnsureCalendarRange', [
        ['DaysAhead', TYPES.Int, 60]
      ]);

      // Build stored procedure parameters
      const params: SqlParam[] = [
        ['StartDate', TYPES.Date, weekStart],
        ['EndDate', TYPES.Date, weekEnd]
      ];

      // Add optional doctor filter parameter
      if (doctorId) {
        params.push(['DoctorID', TYPES.Int, parseInt(doctorId, 10)]);
      }

      // Fetch calendar data using optimized procedure with optional filter
      const calendarData = await executeStoredProcedure<CalendarSlotData>(
        'ProcWeeklyCalendarOptimized',
        params,
        undefined,
        (columns) => ({
          slotDateTime: columns[0].value as string,
          calendarDate: columns[1].value as string,
          dayName: columns[2].value as string,
          dayOfWeek: columns[3].value as number,
          appointmentID: columns[4].value as number | null,
          appDetail: columns[5].value as string | null,
          drID: columns[6].value as number | null,
          patientName: columns[7].value as string | null,
          personID: columns[8].value as number | null,
          slotStatus: columns[9].value as string,
          appointmentCount: columns[10].value as number
        })
      );

      // Fetch holidays for the week
      const holidays = await getHolidaysInRange(weekStart, weekEnd);
      const holidayMap = new Map<string, Holiday>(
        holidays.map((h) => {
          const dateStr =
            h.Holidaydate instanceof Date
              ? formatLocalDate(h.Holidaydate)
              : String(h.Holidaydate).split('T')[0];
          return [dateStr, h] as [string, Holiday];
        })
      );

      // Transform flat data into structured calendar format
      const structuredData = transformToCalendarStructure(
        calendarData,
        maxAppointmentsPerSlot,
        holidayMap
      );

      logger.system.info(
        `✅ Calendar data retrieved: ${calendarData.length} slots, ${structuredData.days.length} days, ${holidays.length} holidays`
      );

      res.json({
        success: true,
        weekStart,
        weekEnd,
        totalSlots: calendarData.length,
        doctorId: doctorId || null,
        maxAppointmentsPerSlot,
        holidays: holidays.length,
        ...structuredData
      });
    } catch (error) {
      logger.system.error('❌ Calendar week API error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch calendar data',
        details: (error as Error).message
      });
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
  async (
    req: Request<unknown, unknown, unknown, CalendarQueryParams>,
    res: Response
  ): Promise<void> => {
    try {
      const { date, doctorId } = req.query;

      if (!date) {
        res.status(400).json({
          success: false,
          error: 'Date parameter is required'
        });
        return;
      }

      const gridStart = getCalendarGridStart(new Date(date));
      const gridEnd = getCalendarGridEnd(new Date(date));
      const monthStart = getMonthStart(new Date(date));
      const monthEnd = getMonthEnd(new Date(date));

      const filterMsg = doctorId
        ? ` (filtered by doctor ID: ${doctorId})`
        : '';
      logger.system.info(
        `📅 Fetching monthly calendar data: ${gridStart} to ${gridEnd}${filterMsg}`
      );

      // Fetch max appointments per slot setting
      const maxAppointmentsSetting = await executeQuery<string>(
        'SELECT OptionValue FROM tbloptions WHERE OptionName = @OptionName',
        [['OptionName', TYPES.NVarChar, 'MaxAppointmentsPerSlot']],
        (columns) => columns[0].value as string
      );
      const maxAppointmentsPerSlot =
        maxAppointmentsSetting.length > 0
          ? parseInt(maxAppointmentsSetting[0], 10)
          : 3;

      logger.info('SYS', `⚙️ Max appointments per slot: ${maxAppointmentsPerSlot}`);

      // Ensure calendar has enough future dates
      await executeStoredProcedure('ProcEnsureCalendarRange', [
        ['DaysAhead', TYPES.Int, 90]
      ]);

      // Build stored procedure parameters
      const params: SqlParam[] = [
        ['StartDate', TYPES.Date, gridStart],
        ['EndDate', TYPES.Date, gridEnd]
      ];

      // Add optional doctor filter parameter
      if (doctorId) {
        params.push(['DoctorID', TYPES.Int, parseInt(doctorId, 10)]);
      }

      // Fetch calendar data using optimized procedure
      const calendarData = await executeStoredProcedure<CalendarSlotData>(
        'ProcWeeklyCalendarOptimized',
        params,
        undefined,
        (columns) => ({
          slotDateTime: columns[0].value as string,
          calendarDate: columns[1].value as string,
          dayName: columns[2].value as string,
          dayOfWeek: columns[3].value as number,
          appointmentID: columns[4].value as number | null,
          appDetail: columns[5].value as string | null,
          drID: columns[6].value as number | null,
          patientName: columns[7].value as string | null,
          personID: columns[8].value as number | null,
          slotStatus: columns[9].value as string,
          appointmentCount: columns[10].value as number
        })
      );

      // Fetch holidays for the grid range
      const holidays = await getHolidaysInRange(gridStart, gridEnd);
      const holidayMap = new Map<string, Holiday>(
        holidays.map((h) => {
          const dateStr =
            h.Holidaydate instanceof Date
              ? formatLocalDate(h.Holidaydate)
              : String(h.Holidaydate).split('T')[0];
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

      logger.system.info(
        `✅ Monthly calendar data retrieved: ${monthlyData.days.length} days, ${holidays.length} holidays`
      );

      res.json({
        success: true,
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
      logger.system.error('❌ Calendar month API error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch monthly calendar data',
        details: (error as Error).message
      });
    }
  }
);

/**
 * GET /api/calendar/stats
 * Returns calendar utilization statistics for the specified week
 */
router.get(
  '/stats',
  async (
    req: Request<unknown, unknown, unknown, CalendarQueryParams>,
    res: Response
  ): Promise<void> => {
    try {
      const { date } = req.query;

      if (!date) {
        res.status(400).json({
          success: false,
          error: 'Date parameter is required'
        });
        return;
      }

      const weekStart = getWeekStart(new Date(date));
      const weekEnd = getWeekEnd(weekStart);

      logger.system.info(
        `📊 Fetching calendar stats for week: ${weekStart} to ${weekEnd}`
      );

      const stats = await executeStoredProcedure<CalendarStats>(
        'ProcCalendarStatsOptimized',
        [
          ['StartDate', TYPES.Date, weekStart],
          ['EndDate', TYPES.Date, weekEnd]
        ],
        undefined,
        (columns) => ({
          weekStart: columns[0].value as string,
          weekEnd: columns[1].value as string,
          totalSlots: columns[2].value as number,
          availableSlots: columns[3].value as number,
          bookedSlots: columns[4].value as number,
          pastSlots: columns[5].value as number,
          utilizationPercent: columns[6].value as number
        })
      );

      logger.system.info(
        `✅ Calendar stats retrieved: ${stats[0]?.utilizationPercent}% utilization`
      );

      res.json({
        success: true,
        stats: stats[0] || {
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
      logger.system.error('❌ Calendar stats API error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch calendar statistics',
        details: (error as Error).message
      });
    }
  }
);

/**
 * GET /api/calendar/time-slots
 * Returns available time slots from existing tbltimes table
 */
router.get(
  '/time-slots',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      logger.system.info('🕐 Fetching time slots from tbltimes');

      const timeSlots = await executeQuery<TimeSlot>(
        'SELECT TimeID, MyTime FROM tbltimes ORDER BY TimeID',
        [],
        (columns) => ({
          timeID: columns[0].value as number,
          timeSlot: columns[1].value as string,
          formattedTime: formatTimeForDisplay(columns[1].value)
        })
      );

      logger.system.info(`✅ Retrieved ${timeSlots.length} time slots`);

      res.json({
        success: true,
        timeSlots,
        totalSlots: timeSlots.length
      });
    } catch (error) {
      logger.system.error('❌ Time slots API error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch time slots',
        details: (error as Error).message
      });
    }
  }
);

/**
 * GET /api/calendar/day/:date
 * Returns appointments for a specific day (compatible with existing ProcDay)
 */
router.get(
  '/day/:date',
  async (req: Request<DateParams>, res: Response): Promise<void> => {
    try {
      const { date } = req.params;

      if (!date) {
        res.status(400).json({
          success: false,
          error: 'Date parameter is required'
        });
        return;
      }

      const targetDate = new Date(date);
      logger.system.info(
        `📅 Fetching day appointments for: ${targetDate.toISOString().split('T')[0]}`
      );

      // Use existing ProcDay for single day compatibility
      const dayAppointments = await executeStoredProcedure<DayAppointment>(
        'ProcDay',
        [['AppDate', TYPES.Date, targetDate.toISOString().split('T')[0]]],
        undefined,
        (columns) => ({
          appointmentID: columns[0].value as number,
          appDetail: columns[1].value as string,
          drID: columns[2].value as number,
          patientName: columns[3].value as string,
          appDate: columns[4].value as Date,
          appTime: columns[5].value as string
        })
      );

      logger.system.info(
        `✅ Retrieved ${dayAppointments.length} appointments for ${date}`
      );

      res.json({
        success: true,
        date: targetDate.toISOString().split('T')[0],
        appointments: dayAppointments,
        totalAppointments: dayAppointments.length
      });
    } catch (error) {
      logger.system.error('❌ Day appointments API error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch day appointments',
        details: (error as Error).message
      });
    }
  }
);

/**
 * POST /api/calendar/ensure-range
 * Ensures calendar has enough future dates for the web interface
 */
router.post(
  '/ensure-range',
  async (
    req: Request<unknown, unknown, EnsureRangeBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { daysAhead = 60 } = req.body;

      logger.system.info(`🔄 Ensuring calendar range: ${daysAhead} days ahead`);

      const result = await executeStoredProcedure<{
        status: string;
        previousMaxDate: string;
        newMaxDate: string;
      }>(
        'ProcEnsureCalendarRange',
        [['DaysAhead', TYPES.Int, daysAhead]],
        undefined,
        (columns) => ({
          status: columns[0].value as string,
          previousMaxDate: columns[1].value as string,
          newMaxDate: columns[2].value as string
        })
      );

      logger.system.info(`✅ Calendar range check completed: ${result[0]?.status}`);

      res.json({
        success: true,
        result: result[0] || { status: 'No update needed' }
      });
    } catch (error) {
      logger.system.error('❌ Calendar range API error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to ensure calendar range',
        details: (error as Error).message
      });
    }
  }
);

/**
 * GET /api/calendar/available-slots
 * Returns ALL time slots with full appointment details for a specific date
 */
router.get(
  '/available-slots',
  async (
    req: Request<unknown, unknown, unknown, CalendarQueryParams>,
    res: Response
  ): Promise<void> => {
    try {
      const { date } = req.query;

      if (!date) {
        res.status(400).json({
          success: false,
          error: 'Date parameter is required'
        });
        return;
      }

      logger.system.info(`🕐 Fetching all slots with details for: ${date}`);

      // Fetch max appointments per slot setting
      const maxAppointmentsSetting = await executeQuery<string>(
        'SELECT OptionValue FROM tbloptions WHERE OptionName = @OptionName',
        [['OptionName', TYPES.NVarChar, 'MaxAppointmentsPerSlot']],
        (columns) => columns[0].value as string
      );
      const maxAppointmentsPerSlot =
        maxAppointmentsSetting.length > 0
          ? parseInt(maxAppointmentsSetting[0], 10)
          : 3;

      // Ensure calendar has enough future dates
      await executeStoredProcedure('ProcEnsureCalendarRange', [
        ['DaysAhead', TYPES.Int, 60]
      ]);

      // Fetch calendar data for the single day
      const calendarData = await executeStoredProcedure<CalendarSlotData>(
        'ProcWeeklyCalendarOptimized',
        [
          ['StartDate', TYPES.Date, date],
          ['EndDate', TYPES.Date, date]
        ],
        undefined,
        (columns) => ({
          slotDateTime: columns[0].value as string,
          calendarDate: columns[1].value as string,
          dayName: columns[2].value as string,
          dayOfWeek: columns[3].value as number,
          appointmentID: columns[4].value as number | null,
          appDetail: columns[5].value as string | null,
          drID: columns[6].value as number | null,
          patientName: columns[7].value as string | null,
          personID: columns[8].value as number | null,
          slotStatus: columns[9].value as string,
          appointmentCount: columns[10].value as number
        })
      );

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

      logger.system.info(
        `✅ Found ${allSlots.length} total slots, ${availableCount} available for ${date}`
      );

      res.json({
        success: true,
        date,
        slots: allSlots,
        totalSlots: allSlots.length,
        availableCount,
        maxAppointmentsPerSlot
      });
    } catch (error) {
      logger.system.error('❌ Available slots API error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch available slots',
        details: (error as Error).message
      });
    }
  }
);

/**
 * GET /api/calendar/month-availability
 * Returns availability summary for each day in a date range (optimized for month view)
 */
router.get(
  '/month-availability',
  async (
    req: Request<unknown, unknown, unknown, CalendarQueryParams>,
    res: Response
  ): Promise<void> => {
    try {
      const { startDate, endDate } = req.query;

      if (!startDate || !endDate) {
        res.status(400).json({
          success: false,
          error: 'Start date and end date parameters are required'
        });
        return;
      }

      logger.system.info(
        `📅 Fetching month availability: ${startDate} to ${endDate}`
      );

      // Fetch max appointments per slot setting
      const maxAppointmentsSetting = await executeQuery<string>(
        'SELECT OptionValue FROM tbloptions WHERE OptionName = @OptionName',
        [['OptionName', TYPES.NVarChar, 'MaxAppointmentsPerSlot']],
        (columns) => columns[0].value as string
      );
      const maxAppointmentsPerSlot =
        maxAppointmentsSetting.length > 0
          ? parseInt(maxAppointmentsSetting[0], 10)
          : 3;

      // Ensure calendar has enough future dates
      await executeStoredProcedure('ProcEnsureCalendarRange', [
        ['DaysAhead', TYPES.Int, 60]
      ]);

      // Fetch calendar data for the date range
      const calendarData = await executeStoredProcedure<CalendarSlotData>(
        'ProcWeeklyCalendarOptimized',
        [
          ['StartDate', TYPES.Date, startDate],
          ['EndDate', TYPES.Date, endDate]
        ],
        undefined,
        (columns) => ({
          slotDateTime: columns[0].value as string,
          calendarDate: columns[1].value as string,
          dayName: columns[2].value as string,
          dayOfWeek: columns[3].value as number,
          appointmentID: columns[4].value as number | null,
          appDetail: columns[5].value as string | null,
          drID: columns[6].value as number | null,
          patientName: columns[7].value as string | null,
          personID: columns[8].value as number | null,
          slotStatus: columns[9].value as string,
          appointmentCount: columns[10].value as number
        })
      );

      // Fetch holidays for the date range
      const holidays = await getHolidaysInRange(startDate, endDate);
      const holidayMap: Record<
        string,
        { id: number; name: string; description: string | null }
      > = {};
      holidays.forEach((h) => {
        const dateStr =
          h.Holidaydate instanceof Date
            ? formatLocalDate(h.Holidaydate)
            : String(h.Holidaydate).split('T')[0];
        holidayMap[dateStr] = {
          id: h.ID,
          name: h.HolidayName,
          description: h.Description
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

      logger.system.info(
        `✅ Month availability calculated for ${Object.keys(availability).length} days, ${holidays.length} holidays`
      );

      res.json({
        success: true,
        startDate,
        endDate,
        availability,
        holidays: holidayMap,
        maxAppointmentsPerSlot
      });
    } catch (error) {
      logger.system.error('❌ Month availability API error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch month availability',
        details: (error as Error).message
      });
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
        holidayId: holiday ? holiday.ID : null,
        holidayName: holiday ? holiday.HolidayName : null,
        holidayDescription: holiday ? holiday.Description : null
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
    if (item.appointmentID && item.appointmentID > 0) {
      days[dateKey].appointments[timeKey].appointments.push({
        appointmentID: item.appointmentID,
        appDetail: item.appDetail,
        drID: item.drID,
        patientName: item.patientName,
        personID: item.personID,
        slotStatus: item.slotStatus,
        slotDateTime: item.slotDateTime,
        AppDate: item.slotDateTime, // Add AppDate for compatibility with EditAppointmentForm
        PersonID: item.personID // Add PersonID (capitalized) for compatibility
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
        holidayId: holiday ? holiday.ID : null,
        holidayName: holiday ? holiday.HolidayName : null,
        holidayDescription: holiday ? holiday.Description : null
      };
    }

    dayMap[dateKey].totalSlots++;

    // Only count valid appointments
    if (item.appointmentID && item.appointmentID > 0) {
      const appointment: AppointmentInfo = {
        appointmentID: item.appointmentID,
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
        holidayId: holiday ? holiday.ID : null,
        holidayName: holiday ? holiday.HolidayName : null,
        holidayDescription: holiday ? holiday.Description : null
      });
    }
  }

  return {
    days: allDays
  };
}

function formatTimeForDisplay(timeValue: unknown): string {
  if (!timeValue) return '';

  try {
    const date = new Date(timeValue as string);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  } catch {
    return String(timeValue);
  }
}

export default router;
