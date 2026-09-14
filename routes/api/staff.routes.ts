/**
 * Staff Routes
 * Handles doctor and operator data retrieval
 */
import { Router, type Request, type Response } from 'express';
import {
  listActiveDoctors,
  listActiveOperators,
} from '../../services/database/queries/employee-queries.js';
import { ErrorResponses, sendData } from '../../utils/error-response.js';
import * as staff from '../../shared/contracts/staff.contract.js';
import { log } from '../../utils/logger.js';

const router = Router();

/**
 * GET /doctors
 * Get all ACTIVE doctors (employees with position = Doctor; quit employees
 * are hidden — they only appear on the Settings page).
 */
router.get('/doctors', async (_req: Request, res: Response): Promise<void> => {
  try {
    const doctors = await listActiveDoctors();
    sendData(res, staff.doctors.response, doctors);
  } catch (error) {
    log.error('Error fetching doctors:', error);
    ErrorResponses.internalError(res, 'Failed to fetch doctors', error as Error);
  }
});

/**
 * GET /operators
 * Get all ACTIVE operators (every current employee; quit employees are hidden).
 */
router.get('/operators', async (_req: Request, res: Response): Promise<void> => {
  try {
    const operators = await listActiveOperators();
    sendData(res, staff.operators.response, operators);
  } catch (error) {
    log.error('Error fetching operators:', error);
    ErrorResponses.internalError(res, 'Failed to fetch operators', error as Error);
  }
});

export default router;
