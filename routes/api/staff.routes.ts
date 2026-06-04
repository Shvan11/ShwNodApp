/**
 * Staff Routes
 * Handles doctor and operator data retrieval
 */
import { Router, type Request, type Response } from 'express';
import { sql } from 'kysely';
import { getKysely } from '../../services/database/kysely.js';
import { ErrorResponses, sendSuccess } from '../../utils/error-response.js';
import { log } from '../../utils/logger.js';

const router = Router();

/**
 * Staff member response type
 */
interface StaffMember {
  id: number;
  employee_name: string;
}

/**
 * GET /doctors
 * Get all doctors (employees with position = Doctor)
 */
router.get('/doctors', async (_req: Request, res: Response): Promise<void> => {
  try {
    const db = getKysely();
    const { rows: doctors } = await sql<StaffMember>`
      SELECT e."id", e."employee_name"
      FROM "employees" e
      INNER JOIN "positions" p ON e."position" = p."id"
      WHERE p."position_name" = 'Doctor'
      ORDER BY e."employee_name"
    `.execute(db);
    sendSuccess(res, doctors);
  } catch (error) {
    log.error('Error fetching doctors:', error);
    ErrorResponses.internalError(res, 'Failed to fetch doctors', error as Error);
  }
});

/**
 * GET /operators
 * Get all operators (all employees)
 */
router.get('/operators', async (_req: Request, res: Response): Promise<void> => {
  try {
    const db = getKysely();
    const { rows: operators } = await sql<StaffMember>`
      SELECT e."id", e."employee_name"
      FROM "employees" e
      ORDER BY e."employee_name"
    `.execute(db);
    sendSuccess(res, operators);
  } catch (error) {
    log.error('Error fetching operators:', error);
    ErrorResponses.internalError(res, 'Failed to fetch operators', error as Error);
  }
});

export default router;
