/**
 * Staff Routes
 * Handles doctor and operator data retrieval
 */
import { Router, type Request, type Response } from 'express';
import { sql } from 'kysely';
import { getKysely } from '../../services/database/kysely.js';
import { ErrorResponses, sendData } from '../../utils/error-response.js';
import * as staff from '../../shared/contracts/staff.contract.js';
import { log } from '../../utils/logger.js';

const router = Router();

/**
 * Staff member response type.
 * `type` (not `interface`) so a StaffMember[] feeds the contract's
 * `z.looseObject` sendData arg — the index-signature rule
 * (docs/shared-contract-progress.md).
 */
type StaffMember = {
  id: number;
  employee_name: string;
};

/**
 * GET /doctors
 * Get all ACTIVE doctors (employees with position = Doctor; quit employees
 * are hidden — they only appear on the Settings page).
 */
router.get('/doctors', async (_req: Request, res: Response): Promise<void> => {
  try {
    const db = getKysely();
    const { rows: doctors } = await sql<StaffMember>`
      SELECT e."id", e."employee_name"
      FROM "employees" e
      INNER JOIN "positions" p ON e."position" = p."id"
      WHERE p."position_name" = 'Doctor'
        AND e."is_active" = true
      ORDER BY e."employee_name"
    `.execute(db);
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
    const db = getKysely();
    const { rows: operators } = await sql<StaffMember>`
      SELECT e."id", e."employee_name"
      FROM "employees" e
      WHERE e."is_active" = true
      ORDER BY e."employee_name"
    `.execute(db);
    sendData(res, staff.operators.response, operators);
  } catch (error) {
    log.error('Error fetching operators:', error);
    ErrorResponses.internalError(res, 'Failed to fetch operators', error as Error);
  }
});

export default router;
