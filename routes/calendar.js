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
        const { date } = req.query;
        
        if (!date) {
            return res.status(400).json({
                success: false,
                error: 'Date parameter is required'
            });
        }

        const weekStart = getWeekStart(new Date(date));
        const weekEnd = getWeekEnd(weekStart);
        
        logger.info(`📅 Fetching calendar data for week: ${weekStart} to ${weekEnd}`);

        // Ensure calendar has enough future dates
        await executeStoredProcedure('ProcEnsureCalendarRange', [
            ['DaysAhead', TYPES.Int, 60]
        ]);

        // Fetch calendar data using optimized procedure
        const calendarData = await executeStoredProcedure(
            'ProcWeeklyCalendarOptimized',
            [
                ['StartDate', TYPES.Date, weekStart],
                ['EndDate', TYPES.Date, weekEnd]
            ],
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
        const structuredData = transformToCalendarStructure(calendarData);
        
        logger.info(`✅ Calendar data retrieved: ${calendarData.length} slots, ${structuredData.days.length} days`);
        
        res.json({
            success: true,
            weekStart,
            weekEnd,
            totalSlots: calendarData.length,
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
function getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday start
    const weekStart = new Date(d.setDate(diff));
    return weekStart.toISOString().split('T')[0];
}

function getWeekEnd(weekStart) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 6); // Sunday end
    return d.toISOString().split('T')[0];
}

function transformToCalendarStructure(flatData) {
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
            days[dateKey].appointments[timeKey] = [];
        }
        
        // Only add valid appointments (skip empty slots with appointmentID = 0)
        if (item.appointmentID && item.appointmentID > 0) {
            days[dateKey].appointments[timeKey].push({
                appointmentID: item.appointmentID,
                appDetail: item.appDetail,
                drID: item.drID,
                patientName: item.patientName,
                personID: item.personID,
                slotStatus: item.slotStatus,
                slotDateTime: item.slotDateTime
            });
        }
        
        // If no appointments for this slot, ensure it exists as empty array
        if (days[dateKey].appointments[timeKey].length === 0) {
            days[dateKey].appointments[timeKey] = [];
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

export default router;