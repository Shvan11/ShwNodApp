/**
 * Holiday API Routes
 *
 * Handles holiday-related operations including:
 * - Fetching holidays for calendar display
 * - Checking if a date is a holiday
 * - Getting appointments on a date (for warning when adding holiday)
 */

import { Router, type Request, type Response } from 'express';
import { log } from '../../utils/logger.js';
import { ErrorResponses } from '../../utils/error-response.js';
import {
  isDateHoliday,
  getHolidaysInRange,
  getAppointmentsOnDate
} from '../../services/database/queries/holiday-queries.js';

const router = Router();

/**
 * Query params for date range
 */
interface DateRangeQuery {
  startDate?: string;
  endDate?: string;
}

/**
 * Query params for single date
 */
interface DateQuery {
  date?: string;
}

/**
 * GET /range
 * Get holidays within a date range (for calendar display)
 */
router.get('/range', async (req: Request<object, object, object, DateRangeQuery>, res: Response): Promise<void> => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      ErrorResponses.badRequest(res, 'startDate and endDate are required');
      return;
    }

    const holidays = await getHolidaysInRange(startDate, endDate);
    res.json({ success: true, holidays });
  } catch (error) {
    const err = error as Error;
    log.error('Error fetching holidays:', { error: err.message });
    ErrorResponses.internalError(res, 'Failed to fetch holidays', err);
  }
});

/**
 * GET /check-date
 * Check if a specific date is a holiday (for form validation)
 */
router.get('/check-date', async (req: Request<object, object, object, DateQuery>, res: Response): Promise<void> => {
  try {
    const { date } = req.query;

    if (!date) {
      ErrorResponses.badRequest(res, 'date parameter is required');
      return;
    }

    const holiday = await isDateHoliday(date);
    res.json({
      success: true,
      isHoliday: !!holiday,
      holiday: holiday || null
    });
  } catch (error) {
    const err = error as Error;
    log.error('Error checking holiday:', { error: err.message });
    ErrorResponses.internalError(res, 'Failed to check holiday', err);
  }
});

/**
 * GET /appointments-on-date
 * Get existing appointments on a date (for warning when adding holiday)
 */
router.get('/appointments-on-date', async (req: Request<object, object, object, DateQuery>, res: Response): Promise<void> => {
  try {
    const { date } = req.query;

    if (!date) {
      ErrorResponses.badRequest(res, 'date parameter is required');
      return;
    }

    const appointments = await getAppointmentsOnDate(date);
    res.json({
      success: true,
      appointments,
      count: appointments.length
    });
  } catch (error) {
    const err = error as Error;
    log.error('Error fetching appointments for date:', { error: err.message });
    ErrorResponses.internalError(res, 'Failed to fetch appointments', err);
  }
});

export default router;
