/**
 * Employee Management Routes
 *
 * Handles all employee-related API endpoints including:
 * - Fetching employees and positions
 * - Managing email recipients
 * - CRUD operations for employee records
 */

import { Router, type Request, type Response } from 'express';
import { sql } from 'kysely';
import { getKysely } from '../../services/database/kysely.js';
import {
  createEmployee,
  updateEmployee,
  deleteEmployee,
  employeeEmailExists,
} from '../../services/database/queries/employee-queries.js';
import { ErrorResponses } from '../../utils/error-response.js';
import { log } from '../../utils/logger.js';

const router = Router();

/**
 * Query parameters for filtering employees
 */
interface EmployeeQuery {
  getAppointments?: string;
  receiveEmail?: string;
  percentage?: string;
  position?: string;
}

/**
 * Employee record from database
 */
interface Employee {
  ID: number;
  employeeName: string;
  Position: number;
  PositionName: string | null;
  Email: string | null;
  Phone: string | null;
  Percentage: boolean;
  receiveEmail: boolean;
  getAppointments: boolean;
  SortOrder: number;
  AppointmentColor: string | null;
}

/**
 * Position record from database
 */
interface Position {
  ID: number;
  PositionName: string;
}

/**
 * Request body for creating/updating employee
 */
interface EmployeeBody {
  employeeName: string;
  Position: number;
  Email?: string;
  Phone?: string;
  Percentage?: boolean;
  receiveEmail?: boolean;
  getAppointments?: boolean;
  SortOrder?: number;
  AppointmentColor?: string | null;
}

/**
 * Route params for employee by ID
 */
interface EmployeeParams {
  id: string;
}

/**
 * GET /employees
 * Get all employees with flexible filtering
 *
 * Query Parameters (all optional):
 * - getAppointments: 'true' to filter only employees who can receive appointments
 * - receiveEmail: 'true' to filter only employees who receive email notifications
 * - percentage: 'true' to filter only employees with percentage-based compensation
 * - position: position ID or name to filter by specific position
 */
router.get('/employees', async (req: Request<object, object, object, EmployeeQuery>, res: Response): Promise<void> => {
  try {
    const { getAppointments, receiveEmail, percentage, position } = req.query;
    const db = getKysely();

    // Build WHERE clause conditions as composable SQL fragments
    const conditions = [];

    if (getAppointments === 'true') {
      conditions.push(sql`e."getAppointments" = true`);
    }

    if (receiveEmail === 'true') {
      conditions.push(sql`e."receiveEmail" = true`);
      conditions.push(sql`e."Email" IS NOT NULL`);
      conditions.push(sql`e."Email" != ''`);
    }

    if (percentage === 'true') {
      conditions.push(sql`e."Percentage" = true`);
    }

    if (position) {
      // Support filtering by position name or ID
      if (isNaN(Number(position))) {
        conditions.push(sql`p."PositionName" = ${position}`);
      } else {
        conditions.push(sql`e."Position" = ${parseInt(position)}`);
      }
    }

    const whereClause = conditions.length > 0
      ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
      : sql``;

    const { rows: employees } = await sql<Employee>`
      SELECT e."ID", e."employeeName", e."Position", p."PositionName", e."Email", e."Phone", e."Percentage", e."receiveEmail", e."getAppointments", e."SortOrder", e."AppointmentColor"
      FROM "tblEmployees" e
      LEFT JOIN "tblPositions" p ON e."Position" = p."ID"
      ${whereClause}
      ORDER BY e."SortOrder", e."employeeName"
    `.execute(db);

    res.json({
      success: true,
      employees: employees || []
    });

  } catch (error) {
    log.error('Error fetching employees:', error);
    ErrorResponses.internalError(res, 'Failed to fetch employees', error as Error);
  }
});

/**
 * GET /positions
 * Get all positions
 */
router.get('/positions', async (_req: Request, res: Response): Promise<void> => {
  try {
    const db = getKysely();
    const { rows: positions } = await sql<Position>`
      SELECT "ID", "PositionName"
      FROM "tblPositions"
      ORDER BY "PositionName"
    `.execute(db);

    res.json({
      success: true,
      positions: positions || []
    });

  } catch (error) {
    log.error('Error fetching positions:', error);
    ErrorResponses.internalError(res, 'Failed to fetch positions', error as Error);
  }
});

/**
 * POST /employees
 * Add new employee
 */
router.post('/employees', async (req: Request<object, object, EmployeeBody>, res: Response): Promise<void> => {
  try {
    const { employeeName, Position, Email, Phone, Percentage, receiveEmail, getAppointments, SortOrder, AppointmentColor } = req.body;

    if (!employeeName || employeeName.trim() === '') {
      ErrorResponses.badRequest(res, 'Employee name is required');
      return;
    }

    if (!Position) {
      ErrorResponses.badRequest(res, 'Position is required');
      return;
    }

    // Check if email already exists (if provided)
    if (Email && Email.trim() !== '') {
      if (await employeeEmailExists(Email.trim())) {
        ErrorResponses.badRequest(res, 'An employee with this email already exists');
        return;
      }
    }

    const newID = await createEmployee({
      employeeName: employeeName.trim(),
      Position,
      Email: Email && Email.trim() !== '' ? Email.trim() : null,
      Phone: Phone && Phone.trim() !== '' ? Phone.trim() : null,
      Percentage: !!Percentage,
      receiveEmail: !!receiveEmail,
      getAppointments: !!getAppointments,
      SortOrder: SortOrder !== undefined ? SortOrder : 999,
      AppointmentColor: AppointmentColor && AppointmentColor.trim() !== '' ? AppointmentColor.trim() : null,
    });

    res.json({
      success: true,
      message: 'Employee added successfully',
      employeeID: newID
    });

  } catch (error) {
    log.error('Error adding employee:', error);
    ErrorResponses.internalError(res, 'Failed to add employee', error as Error);
  }
});

/**
 * PUT /employees/:id
 * Update employee
 */
router.put('/employees/:id', async (req: Request<EmployeeParams, object, EmployeeBody>, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { employeeName, Position, Email, Phone, Percentage, receiveEmail, getAppointments, SortOrder, AppointmentColor } = req.body;

    if (!employeeName || employeeName.trim() === '') {
      ErrorResponses.badRequest(res, 'Employee name is required');
      return;
    }

    if (!Position) {
      ErrorResponses.badRequest(res, 'Position is required');
      return;
    }

    // Check if email already exists for another employee (if provided)
    if (Email && Email.trim() !== '') {
      if (await employeeEmailExists(Email.trim(), parseInt(id))) {
        ErrorResponses.badRequest(res, 'Another employee with this email already exists');
        return;
      }
    }

    await updateEmployee(parseInt(id), {
      employeeName: employeeName.trim(),
      Position,
      Email: Email && Email.trim() !== '' ? Email.trim() : null,
      Phone: Phone && Phone.trim() !== '' ? Phone.trim() : null,
      Percentage: !!Percentage,
      receiveEmail: !!receiveEmail,
      getAppointments: !!getAppointments,
      SortOrder: SortOrder !== undefined ? SortOrder : 999,
      AppointmentColor: AppointmentColor && AppointmentColor.trim() !== '' ? AppointmentColor.trim() : null,
    });

    res.json({
      success: true,
      message: 'Employee updated successfully'
    });

  } catch (error) {
    log.error('Error updating employee:', error);
    ErrorResponses.internalError(res, 'Failed to update employee', error as Error);
  }
});

/**
 * DELETE /employees/:id
 * Delete employee
 */
router.delete('/employees/:id', async (req: Request<EmployeeParams>, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    await deleteEmployee(parseInt(id));

    res.json({
      success: true,
      message: 'Employee deleted successfully'
    });

  } catch (error) {
    log.error('Error deleting employee:', error);
    ErrorResponses.internalError(res, 'Failed to delete employee', error as Error);
  }
});

export default router;
