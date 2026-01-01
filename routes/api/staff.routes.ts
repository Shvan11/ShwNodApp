/**
 * Staff Routes
 * Handles doctor and operator data retrieval
 */
import { Router, type Request, type Response } from 'express';
import * as database from '../../services/database/index.js';
import { ErrorResponses } from '../../utils/error-response.js';
import { log } from '../../utils/logger.js';

const router = Router();

/**
 * Staff member response type
 */
interface StaffMember {
  ID: number;
  employeeName: string;
}

/**
 * GET /doctors
 * Get all doctors (employees with Position = Doctor)
 */
router.get('/doctors', async (_req: Request, res: Response): Promise<void> => {
  try {
    const query = `
      SELECT e.ID, e.employeeName
      FROM tblEmployees e
      INNER JOIN tblPositions p ON e.Position = p.ID
      WHERE p.PositionName = 'Doctor'
      ORDER BY e.employeeName
    `;
    const doctors = await database.executeQuery<StaffMember>(
      query,
      [],
      (columns) => ({
        ID: columns[0].value as number,
        employeeName: columns[1].value as string
      })
    );
    res.json(doctors);
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
    const query = `
      SELECT e.ID, e.employeeName
      FROM tblEmployees e
      ORDER BY e.employeeName
    `;
    const operators = await database.executeQuery<StaffMember>(
      query,
      [],
      (columns) => ({
        ID: columns[0].value as number,
        employeeName: columns[1].value as string
      })
    );
    res.json(operators);
  } catch (error) {
    log.error('Error fetching operators:', error);
    ErrorResponses.internalError(res, 'Failed to fetch operators', error as Error);
  }
});

export default router;
