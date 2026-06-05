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
import { ErrorResponses, sendData } from '../../utils/error-response.js';
import {
  getAppointmentsOnDate
} from '../../services/database/queries/holiday-queries.js';
import * as holiday from '../../shared/contracts/holiday.contract.js';

const router = Router();

/**
 * Query params for single date
 */
type DateQuery = holiday.DateQuery;

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
    sendData(res, holiday.appointmentsOnDate.response, {
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
