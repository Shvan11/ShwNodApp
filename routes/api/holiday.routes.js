/**
 * Holiday API Routes
 *
 * Handles holiday-related operations including:
 * - Fetching holidays for calendar display
 * - Checking if a date is a holiday
 * - Getting appointments on a date (for warning when adding holiday)
 */

import express from 'express';
import { log } from '../../utils/logger.js';
import { ErrorResponses } from '../../utils/error-response.js';
import {
    isDateHoliday,
    getHolidaysInRange,
    getAppointmentsOnDate
} from '../../services/database/queries/holiday-queries.js';

const router = express.Router();

/**
 * Get holidays within a date range (for calendar display)
 * GET /api/holidays/range?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 */
router.get('/range', async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        if (!startDate || !endDate) {
            return ErrorResponses.badRequest(res, 'startDate and endDate are required');
        }

        const holidays = await getHolidaysInRange(startDate, endDate);
        res.json({ success: true, holidays });
    } catch (error) {
        log.error('Error fetching holidays:', { error: error.message });
        return ErrorResponses.internalError(res, 'Failed to fetch holidays', error);
    }
});

/**
 * Check if a specific date is a holiday (for form validation)
 * GET /api/holidays/check-date?date=YYYY-MM-DD
 */
router.get('/check-date', async (req, res) => {
    try {
        const { date } = req.query;

        if (!date) {
            return ErrorResponses.badRequest(res, 'date parameter is required');
        }

        const holiday = await isDateHoliday(date);
        res.json({
            success: true,
            isHoliday: !!holiday,
            holiday: holiday || null
        });
    } catch (error) {
        log.error('Error checking holiday:', { error: error.message });
        return ErrorResponses.internalError(res, 'Failed to check holiday', error);
    }
});

/**
 * Get existing appointments on a date (for warning when adding holiday)
 * GET /api/holidays/appointments-on-date?date=YYYY-MM-DD
 */
router.get('/appointments-on-date', async (req, res) => {
    try {
        const { date } = req.query;

        if (!date) {
            return ErrorResponses.badRequest(res, 'date parameter is required');
        }

        const appointments = await getAppointmentsOnDate(date);
        res.json({
            success: true,
            appointments,
            count: appointments.length
        });
    } catch (error) {
        log.error('Error fetching appointments for date:', { error: error.message });
        return ErrorResponses.internalError(res, 'Failed to fetch appointments', error);
    }
});

export default router;
