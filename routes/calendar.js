/**
 * Calendar API Routes for Shwan Orthodontics
 * 
 * Provides optimized calendar endpoints that work with existing tblcalender system
 * Uses ProcWeeklyCalendarOptimized and ProcCalendarStatsOptimized procedures
 */

import express from 'express';
import { executeStoredProcedure, executeQuery, TYPES } from '../services/database/index.js';
import { logger } from '../services/core/Logger.js';

const router = express.Router();

/**
 * GET /api/calendar/week
 * Returns complete weekly calendar data with time slots
 * Uses existing tblcalender system for optimal performance
 */
router.get('/week', async (req, res) => {
    try {
        const { date, doctorId } = req.query;

        if (!date) {
            return res.status(400).json({
                success: false,
                error: 'Date parameter is required'
            });
        }

        const weekStart = getWeekStart(new Date(date));
        const weekEnd = getWeekEnd(weekStart);

        const filterMsg = doctorId ? ` (filtered by doctor ID: ${doctorId})` : '';
        logger.info(`📅 Fetching calendar data for week: ${weekStart} to ${weekEnd}${filterMsg}`);

        // Fetch max appointments per slot setting
        const maxAppointmentsSetting = await executeQuery(
            'SELECT OptionValue FROM tbloptions WHERE OptionName = @OptionName',
            [['OptionName', TYPES.NVarChar, 'MaxAppointmentsPerSlot']],
            (columns) => columns[0].value
        );
        const maxAppointmentsPerSlot = maxAppointmentsSetting.length > 0
            ? parseInt(maxAppointmentsSetting[0], 10)
            : 3; // Default to 3 if not set

        logger.info(`⚙️ Max appointments per slot: ${maxAppointmentsPerSlot}`);

        // Ensure calendar has enough future dates
        await executeStoredProcedure('ProcEnsureCalendarRange', [
            ['DaysAhead', TYPES.Int, 60]
        ]);

        // Build stored procedure parameters
        const params = [
            ['StartDate', TYPES.Date, weekStart],
            ['EndDate', TYPES.Date, weekEnd]
        ];

        // Add optional doctor filter parameter
        if (doctorId) {
            params.push(['DoctorID', TYPES.Int, parseInt(doctorId, 10)]);
        }

        // Fetch calendar data using optimized procedure with optional filter
        const calendarData = await executeStoredProcedure(
            'ProcWeeklyCalendarOptimized',
            params,
            null,
            (columns) => ({
                slotDateTime: columns[0].value,        // SlotDateTime
                calendarDate: columns[1].value,        // CalendarDate
                dayName: columns[2].value,             // DayName
                dayOfWeek: columns[3].value,           // DayOfWeek
                appointmentID: columns[4].value,       // appointmentID
                appDetail: columns[5].value,           // AppDetail
                drID: columns[6].value,                // DrID
                patientName: columns[7].value,         // PatientName
                personID: columns[8].value,            // PersonID
                slotStatus: columns[9].value,          // SlotStatus
                appointmentCount: columns[10].value    // AppointmentCount (new)
            })
        );

        // Transform flat data into structured calendar format
        const structuredData = transformToCalendarStructure(calendarData, maxAppointmentsPerSlot);

        logger.info(`✅ Calendar data retrieved: ${calendarData.length} slots, ${structuredData.days.length} days`);

        res.json({
            success: true,
            weekStart,
            weekEnd,
            totalSlots: calendarData.length,
            doctorId: doctorId || null,
            maxAppointmentsPerSlot,
            ...structuredData
        });

    } catch (error) {
        logger.error('❌ Calendar week API error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch calendar data',
            details: error.message
        });
    }
});

/**
 * GET /api/calendar/month
 * Returns complete monthly calendar data with daily summaries
 * Uses existing tblcalender system for optimal performance
 */
router.get('/month', async (req, res) => {
    try {
        const { date, doctorId } = req.query;

        if (!date) {
            return res.status(400).json({
                success: false,
                error: 'Date parameter is required'
            });
        }

        const gridStart = getCalendarGridStart(new Date(date));
        const gridEnd = getCalendarGridEnd(new Date(date));
        const monthStart = getMonthStart(new Date(date));
        const monthEnd = getMonthEnd(new Date(date));

        const filterMsg = doctorId ? ` (filtered by doctor ID: ${doctorId})` : '';
        logger.info(`📅 Fetching monthly calendar data: ${gridStart} to ${gridEnd}${filterMsg}`);

        // Fetch max appointments per slot setting
        const maxAppointmentsSetting = await executeQuery(
            'SELECT OptionValue FROM tbloptions WHERE OptionName = @OptionName',
            [['OptionName', TYPES.NVarChar, 'MaxAppointmentsPerSlot']],
            (columns) => columns[0].value
        );
        const maxAppointmentsPerSlot = maxAppointmentsSetting.length > 0
            ? parseInt(maxAppointmentsSetting[0], 10)
            : 3;

        logger.info(`⚙️ Max appointments per slot: ${maxAppointmentsPerSlot}`);

        // Ensure calendar has enough future dates
        await executeStoredProcedure('ProcEnsureCalendarRange', [
            ['DaysAhead', TYPES.Int, 90]
        ]);

        // Build stored procedure parameters
        const params = [
            ['StartDate', TYPES.Date, gridStart],
            ['EndDate', TYPES.Date, gridEnd]
        ];

        // Add optional doctor filter parameter
        if (doctorId) {
            params.push(['DoctorID', TYPES.Int, parseInt(doctorId, 10)]);
        }

        // Fetch calendar data using optimized procedure
        const calendarData = await executeStoredProcedure(
            'ProcWeeklyCalendarOptimized',
            params,
            null,
            (columns) => ({
                slotDateTime: columns[0].value,
                calendarDate: columns[1].value,
                dayName: columns[2].value,
                dayOfWeek: columns[3].value,
                appointmentID: columns[4].value,
                appDetail: columns[5].value,
                drID: columns[6].value,
                patientName: columns[7].value,
                personID: columns[8].value,
                slotStatus: columns[9].value,
                appointmentCount: columns[10].value
            })
        );

        // Transform to monthly structure
        const monthlyData = transformToMonthlyStructure(
            calendarData,
            gridStart,
            gridEnd,
            maxAppointmentsPerSlot
        );

        logger.info(`✅ Monthly calendar data retrieved: ${monthlyData.days.length} days`);

        res.json({
            success: true,
            monthStart,
            monthEnd,
            gridStart,
            gridEnd,
            doctorId: doctorId || null,
            maxAppointmentsPerSlot,
            ...monthlyData
        });

    } catch (error) {
        logger.error('❌ Calendar month API error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch monthly calendar data',
            details: error.message
        });
    }
});

/**
 * GET /api/calendar/stats
 * Returns calendar utilization statistics for the specified week
 */
router.get('/stats', async (req, res) => {
    try {
        const { date } = req.query;
        
        if (!date) {
            return res.status(400).json({
                success: false,
                error: 'Date parameter is required'
            });
        }

        const weekStart = getWeekStart(new Date(date));
        const weekEnd = getWeekEnd(weekStart);
        
        logger.info(`📊 Fetching calendar stats for week: ${weekStart} to ${weekEnd}`);
        
        const stats = await executeStoredProcedure(
            'ProcCalendarStatsOptimized',
            [
                ['StartDate', TYPES.Date, weekStart],
                ['EndDate', TYPES.Date, weekEnd]
            ],
            null,
            (columns) => ({
                weekStart: columns[0].value,
                weekEnd: columns[1].value,
                totalSlots: columns[2].value,
                availableSlots: columns[3].value,
                bookedSlots: columns[4].value,
                pastSlots: columns[5].value,
                utilizationPercent: columns[6].value
            })
        );
        
        logger.info(`✅ Calendar stats retrieved: ${stats[0]?.utilizationPercent}% utilization`);
        
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
        logger.error('❌ Calendar stats API error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch calendar statistics',
            details: error.message
        });
    }
});

/**
 * GET /api/calendar/time-slots
 * Returns available time slots from existing tbltimes table
 */
router.get('/time-slots', async (req, res) => {
    try {
        logger.info('🕐 Fetching time slots from tbltimes');
        
        const timeSlots = await executeQuery(
            'SELECT TimeID, MyTime FROM tbltimes ORDER BY TimeID',
            [],
            (columns) => ({
                timeID: columns[0].value,
                timeSlot: columns[1].value,
                formattedTime: formatTimeForDisplay(columns[1].value)
            })
        );
        
        logger.info(`✅ Retrieved ${timeSlots.length} time slots`);
        
        res.json({
            success: true,
            timeSlots,
            totalSlots: timeSlots.length
        });
        
    } catch (error) {
        logger.error('❌ Time slots API error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch time slots',
            details: error.message
        });
    }
});

/**
 * GET /api/calendar/day/:date
 * Returns appointments for a specific day (compatible with existing ProcDay)
 */
router.get('/day/:date', async (req, res) => {
    try {
        const { date } = req.params;
        
        if (!date) {
            return res.status(400).json({
                success: false,
                error: 'Date parameter is required'
            });
        }

        const targetDate = new Date(date);
        logger.info(`📅 Fetching day appointments for: ${targetDate.toISOString().split('T')[0]}`);
        
        // Use existing ProcDay for single day compatibility
        const dayAppointments = await executeStoredProcedure(
            'ProcDay',
            [
                ['AppDate', TYPES.Date, targetDate.toISOString().split('T')[0]]
            ],
            null,
            (columns) => ({
                appointmentID: columns[0].value,
                appDetail: columns[1].value,
                drID: columns[2].value,
                patientName: columns[3].value,
                appDate: columns[4].value,
                appTime: columns[5].value
            })
        );
        
        logger.info(`✅ Retrieved ${dayAppointments.length} appointments for ${date}`);
        
        res.json({
            success: true,
            date: targetDate.toISOString().split('T')[0],
            appointments: dayAppointments,
            totalAppointments: dayAppointments.length
        });
        
    } catch (error) {
        logger.error('❌ Day appointments API error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch day appointments',
            details: error.message
        });
    }
});

/**
 * POST /api/calendar/ensure-range
 * Ensures calendar has enough future dates for the web interface
 */
router.post('/ensure-range', async (req, res) => {
    try {
        const { daysAhead = 60 } = req.body;
        
        logger.info(`🔄 Ensuring calendar range: ${daysAhead} days ahead`);
        
        const result = await executeStoredProcedure(
            'ProcEnsureCalendarRange',
            [
                ['DaysAhead', TYPES.Int, daysAhead]
            ],
            null,
            (columns) => ({
                status: columns[0].value,
                previousMaxDate: columns[1].value,
                newMaxDate: columns[2].value
            })
        );
        
        logger.info(`✅ Calendar range check completed: ${result[0]?.status}`);
        
        res.json({
            success: true,
            result: result[0] || { status: 'No update needed' }
        });
        
    } catch (error) {
        logger.error('❌ Calendar range API error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to ensure calendar range',
            details: error.message
        });
    }
});

// Helper functions
// Week starts on Saturday (day 6)
function getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay();
    // Calculate days to subtract to get to Saturday
    // Saturday = 6, Sunday = 0, Monday = 1, etc.
    const diff = day === 6 ? 0 : (day + 1);
    const weekStart = new Date(d);
    weekStart.setDate(weekStart.getDate() - diff);
    return weekStart.toISOString().split('T')[0];
}

function getWeekEnd(weekStart) {
    const d = new Date(weekStart);
    // Week: Sat, Sun, Mon, Tue, Wed, Thu (6 days, excluding Friday)
    d.setDate(d.getDate() + 5); // Thursday end (5 days after Saturday)
    return d.toISOString().split('T')[0];
}

// Get month start (first day of month)
function getMonthStart(date) {
    const d = new Date(date);
    d.setDate(1);
    return d.toISOString().split('T')[0];
}

// Get month end (last day of month)
function getMonthEnd(date) {
    const d = new Date(date);
    d.setMonth(d.getMonth() + 1);
    d.setDate(0);
    return d.toISOString().split('T')[0];
}

// Get calendar grid start (Saturday before or at month start)
function getCalendarGridStart(date) {
    const monthStart = new Date(getMonthStart(date));
    return getWeekStart(monthStart);
}

// Get calendar grid end (Thursday after or at month end, excluding Friday)
function getCalendarGridEnd(date) {
    const monthEnd = new Date(getMonthEnd(date));
    const gridEnd = new Date(monthEnd);
    const day = gridEnd.getDay();
    // Add days to get to Thursday (day 4), skip Friday
    let daysToAdd;
    if (day === 4) {
        daysToAdd = 0; // Already Thursday
    } else if (day === 5) {
        daysToAdd = 6; // Friday -> next Thursday (skip Friday)
    } else if (day === 6) {
        daysToAdd = 5; // Saturday -> Thursday
    } else if (day === 0) {
        daysToAdd = 4; // Sunday -> Thursday
    } else {
        daysToAdd = 4 - day; // Mon-Wed -> Thursday
    }
    gridEnd.setDate(gridEnd.getDate() + daysToAdd);
    return gridEnd.toISOString().split('T')[0];
}

function transformToCalendarStructure(flatData, maxAppointmentsPerSlot = 3) {
    const days = {};
    const timeSlots = new Set();

    flatData.forEach(item => {
        const dateKey = item.calendarDate.toISOString().split('T')[0];

        if (!days[dateKey]) {
            days[dateKey] = {
                date: dateKey,
                dayName: item.dayName,
                dayOfWeek: item.dayOfWeek,
                appointments: {}
            };
        }

        // Extract time from slotDateTime for time slot key
        const timeKey = item.slotDateTime.toISOString().split('T')[1].substring(0, 5); // HH:MM format
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
                slotDateTime: item.slotDateTime
            });
        }

        // Update appointment count
        days[dateKey].appointments[timeKey].appointmentCount =
            days[dateKey].appointments[timeKey].appointments.length;

        // Determine slot status based on appointment count and time
        const slotDateTime = new Date(item.slotDateTime);
        const now = new Date();
        const appointmentCount = days[dateKey].appointments[timeKey].appointmentCount;

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
        days: Object.values(days).sort((a, b) => new Date(a.date) - new Date(b.date)),
        timeSlots: Array.from(timeSlots).sort((a, b) => {
            // Sort time slots chronologically
            const timeA = new Date(`1970-01-01T${a}:00`);
            const timeB = new Date(`1970-01-01T${b}:00`);
            return timeA - timeB;
        })
    };
}

function transformToMonthlyStructure(flatData, gridStart, gridEnd, maxAppointmentsPerSlot = 3) {
    const dayMap = {};
    const now = new Date();

    // Group data by date
    flatData.forEach(item => {
        const dateKey = item.calendarDate.toISOString().split('T')[0];

        if (!dayMap[dateKey]) {
            dayMap[dateKey] = {
                date: dateKey,
                dayName: item.dayName,
                dayOfWeek: item.dayOfWeek,
                appointments: [],
                appointmentCount: 0,
                totalSlots: 0,
                availableSlots: 0,
                bookedSlots: 0
            };
        }

        dayMap[dateKey].totalSlots++;

        // Only count valid appointments
        if (item.appointmentID && item.appointmentID > 0) {
            const appointment = {
                appointmentID: item.appointmentID,
                appDetail: item.appDetail,
                drID: item.drID,
                patientName: item.patientName,
                personID: item.personID,
                time: item.slotDateTime.toISOString().split('T')[1].substring(0, 5)
            };

            dayMap[dateKey].appointments.push(appointment);
            dayMap[dateKey].appointmentCount++;
        }

        // Count slot status
        const slotDateTime = new Date(item.slotDateTime);
        if (slotDateTime >= now) {
            if (item.slotStatus === 'available' || (item.slotStatus === 'booked' && item.appointmentCount < maxAppointmentsPerSlot)) {
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
    const allDays = [];

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateKey = d.toISOString().split('T')[0];

        if (dayMap[dateKey]) {
            // Calculate utilization
            const utilization = dayMap[dateKey].totalSlots > 0
                ? Math.round((dayMap[dateKey].bookedSlots / dayMap[dateKey].totalSlots) * 100)
                : 0;

            dayMap[dateKey].utilizationPercent = utilization;
            allDays.push(dayMap[dateKey]);
        } else {
            // Empty day
            allDays.push({
                date: dateKey,
                dayName: d.toLocaleDateString('en-US', { weekday: 'short' }),
                dayOfWeek: d.getDay() + 1,
                appointments: [],
                appointmentCount: 0,
                totalSlots: 0,
                availableSlots: 0,
                bookedSlots: 0,
                utilizationPercent: 0
            });
        }
    }

    return {
        days: allDays
    };
}

function formatTimeForDisplay(timeValue) {
    if (!timeValue) return '';

    try {
        const date = new Date(timeValue);
        return date.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    } catch (error) {
        return timeValue.toString();
    }
}

/**
 * GET /api/calendar/available-slots
 * Returns ALL time slots with full appointment details for a specific date
 */
router.get('/available-slots', async (req, res) => {
    try {
        const { date } = req.query;

        if (!date) {
            return res.status(400).json({
                success: false,
                error: 'Date parameter is required'
            });
        }

        logger.info(`🕐 Fetching all slots with details for: ${date}`);

        // Fetch max appointments per slot setting
        const maxAppointmentsSetting = await executeQuery(
            'SELECT OptionValue FROM tbloptions WHERE OptionName = @OptionName',
            [['OptionName', TYPES.NVarChar, 'MaxAppointmentsPerSlot']],
            (columns) => columns[0].value
        );
        const maxAppointmentsPerSlot = maxAppointmentsSetting.length > 0
            ? parseInt(maxAppointmentsSetting[0], 10)
            : 3;

        // Ensure calendar has enough future dates
        await executeStoredProcedure('ProcEnsureCalendarRange', [
            ['DaysAhead', TYPES.Int, 60]
        ]);

        // Fetch calendar data for the single day
        const calendarData = await executeStoredProcedure(
            'ProcWeeklyCalendarOptimized',
            [
                ['StartDate', TYPES.Date, date],
                ['EndDate', TYPES.Date, date]
            ],
            null,
            (columns) => ({
                slotDateTime: columns[0].value,
                calendarDate: columns[1].value,
                dayName: columns[2].value,
                dayOfWeek: columns[3].value,
                appointmentID: columns[4].value,
                appDetail: columns[5].value,
                drID: columns[6].value,
                patientName: columns[7].value,
                personID: columns[8].value,
                slotStatus: columns[9].value,
                appointmentCount: columns[10].value
            })
        );

        // Transform data to get all slots with full details
        const structuredData = transformToCalendarStructure(calendarData, maxAppointmentsPerSlot);

        const allSlots = [];
        let availableCount = 0;

        if (structuredData.days.length > 0) {
            const dayData = structuredData.days[0];
            structuredData.timeSlots.forEach(timeSlot => {
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

        logger.info(`✅ Found ${allSlots.length} total slots, ${availableCount} available for ${date}`);

        res.json({
            success: true,
            date,
            slots: allSlots,
            totalSlots: allSlots.length,
            availableCount,
            maxAppointmentsPerSlot
        });

    } catch (error) {
        logger.error('❌ Available slots API error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch available slots',
            details: error.message
        });
    }
});

/**
 * GET /api/calendar/month-availability
 * Returns availability summary for each day in a date range (optimized for month view)
 */
router.get('/month-availability', async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        if (!startDate || !endDate) {
            return res.status(400).json({
                success: false,
                error: 'Start date and end date parameters are required'
            });
        }

        logger.info(`📅 Fetching month availability: ${startDate} to ${endDate}`);

        // Fetch max appointments per slot setting
        const maxAppointmentsSetting = await executeQuery(
            'SELECT OptionValue FROM tbloptions WHERE OptionName = @OptionName',
            [['OptionName', TYPES.NVarChar, 'MaxAppointmentsPerSlot']],
            (columns) => columns[0].value
        );
        const maxAppointmentsPerSlot = maxAppointmentsSetting.length > 0
            ? parseInt(maxAppointmentsSetting[0], 10)
            : 3;

        // Ensure calendar has enough future dates
        await executeStoredProcedure('ProcEnsureCalendarRange', [
            ['DaysAhead', TYPES.Int, 60]
        ]);

        // Fetch calendar data for the date range
        const calendarData = await executeStoredProcedure(
            'ProcWeeklyCalendarOptimized',
            [
                ['StartDate', TYPES.Date, startDate],
                ['EndDate', TYPES.Date, endDate]
            ],
            null,
            (columns) => ({
                slotDateTime: columns[0].value,
                calendarDate: columns[1].value,
                dayName: columns[2].value,
                dayOfWeek: columns[3].value,
                appointmentID: columns[4].value,
                appDetail: columns[5].value,
                drID: columns[6].value,
                patientName: columns[7].value,
                personID: columns[8].value,
                slotStatus: columns[9].value,
                appointmentCount: columns[10].value
            })
        );

        // Transform data
        const structuredData = transformToCalendarStructure(calendarData, maxAppointmentsPerSlot);

        // Calculate availability for each day
        const availability = {};
        const now = new Date();

        structuredData.days.forEach(day => {
            let availableCount = 0;
            let totalCount = 0;
            let appointmentCount = 0;

            structuredData.timeSlots.forEach(timeSlot => {
                const slotInfo = day.appointments[timeSlot];
                if (slotInfo) {
                    totalCount++;
                    const slotDateTime = new Date(`${day.date}T${timeSlot}:00`);

                    // Count appointments in this slot
                    if (slotInfo.appointments && slotInfo.appointments.length > 0) {
                        appointmentCount += slotInfo.appointments.length;
                    }

                    // Count available slots (including booked slots that can take more appointments)
                    if ((slotInfo.slotStatus === 'available' || slotInfo.slotStatus === 'booked') && slotDateTime > now) {
                        availableCount++;
                    }
                }
            });

            availability[day.date] = {
                availableCount,
                totalCount,
                appointmentCount,
                hasAvailability: availableCount > 0
            };
        });

        logger.info(`✅ Month availability calculated for ${Object.keys(availability).length} days`);

        res.json({
            success: true,
            startDate,
            endDate,
            availability,
            maxAppointmentsPerSlot
        });

    } catch (error) {
        logger.error('❌ Month availability API error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch month availability',
            details: error.message
        });
    }
});

export default router;