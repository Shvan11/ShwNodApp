/**
 * Employee Management Routes
 *
 * Handles all employee-related API endpoints including:
 * - Fetching employees and positions
 * - Managing email recipients
 * - CRUD operations for employee records
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { sql } from 'kysely';
import { getKysely } from '../../services/database/kysely.js';
import {
  createEmployee,
  updateEmployee,
  deleteEmployee,
  employeeEmailExists,
} from '../../services/database/queries/employee-queries.js';
import { ErrorResponses, sendSuccess } from '../../utils/error-response.js';
import { validate } from '../../middleware/validate.js';
import { idParams } from '../../middleware/validation-schemas.js';
import { log } from '../../utils/logger.js';

const router = Router();

// Boundary guard for create/update. Deliberately LOOSE: createEmployee/updateEmployee
// are called with an EXPLICIT object literal (no `...req.body` spread), so extra body
// keys can never reach the DB — over-posting is already closed. We only need to enforce
// the two required scalars (name present, position a positive int) and NaN-proof position;
// the soft fields (email/phone/flags/color) keep their existing handler-side coercion.
const employeeBodySchema = z.looseObject({
  employee_name: z.string().min(1, 'Employee name is required'),
  position: z.coerce.number().int().positive(),
});

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
  id: number;
  employee_name: string;
  position: number;
  position_name: string | null;
  email: string | null;
  phone: string | null;
  percentage: boolean;
  receive_email: boolean;
  get_appointments: boolean;
  sort_order: number;
  appointment_color: string | null;
}

/**
 * position record from database
 */
interface position {
  id: number;
  position_name: string;
}

/**
 * Request body for creating/updating employee
 */
interface EmployeeBody {
  employee_name: string;
  position: number;
  email?: string;
  phone?: string;
  percentage?: boolean;
  receiveEmail?: boolean;
  getAppointments?: boolean;
  sort_order?: number;
  appointment_color?: string | null;
}

/**
 * Route params for employee by id
 */
interface EmployeeParams {
  id: string;
}

/**
 * GET /employees
 * Get all employees with flexible filtering
 *
 * Query Parameters (all optional):
 * - get_appointments: 'true' to filter only employees who can receive appointments
 * - receive_email: 'true' to filter only employees who receive email notifications
 * - percentage: 'true' to filter only employees with percentage-based compensation
 * - position: position id or name to filter by specific position
 */
router.get('/employees', async (req: Request<object, object, object, EmployeeQuery>, res: Response): Promise<void> => {
  try {
    const { getAppointments, receiveEmail, percentage, position } = req.query;
    const db = getKysely();

    // Build WHERE clause conditions as composable SQL fragments
    const conditions = [];

    if (getAppointments === 'true') {
      conditions.push(sql`e."get_appointments" = true`);
    }

    if (receiveEmail === 'true') {
      conditions.push(sql`e."receive_email" = true`);
      conditions.push(sql`e."email" IS NOT NULL`);
      conditions.push(sql`e."email" != ''`);
    }

    if (percentage === 'true') {
      conditions.push(sql`e."percentage" = true`);
    }

    if (position) {
      // Support filtering by position name or id
      if (isNaN(Number(position))) {
        conditions.push(sql`p."position_name" = ${position}`);
      } else {
        conditions.push(sql`e."position" = ${parseInt(position)}`);
      }
    }

    const whereClause = conditions.length > 0
      ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
      : sql``;

    const { rows: employees } = await sql<Employee>`
      SELECT e."id", e."employee_name", e."position", p."position_name", e."email", e."phone", e."percentage", e."receive_email", e."get_appointments", e."sort_order", e."appointment_color"
      FROM "employees" e
      LEFT JOIN "positions" p ON e."position" = p."id"
      ${whereClause}
      ORDER BY e."sort_order", e."employee_name"
    `.execute(db);

    sendSuccess(res, {
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
    const { rows: positions } = await sql<position>`
      SELECT "id", "position_name"
      FROM "positions"
      ORDER BY "position_name"
    `.execute(db);

    sendSuccess(res, {
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
router.post('/employees', validate({ body: employeeBodySchema }), async (req: Request<object, object, EmployeeBody>, res: Response): Promise<void> => {
  try {
    const { employee_name, position, email, phone, percentage, receiveEmail, getAppointments, sort_order, appointment_color } = req.body;

    if (!employee_name || employee_name.trim() === '') {
      ErrorResponses.badRequest(res, 'Employee name is required');
      return;
    }

    if (!position) {
      ErrorResponses.badRequest(res, 'position is required');
      return;
    }

    // Check if email already exists (if provided)
    if (email && email.trim() !== '') {
      if (await employeeEmailExists(email.trim())) {
        ErrorResponses.badRequest(res, 'An employee with this email already exists');
        return;
      }
    }

    const newID = await createEmployee({
      employee_name: employee_name.trim(),
      position,
      email: email && email.trim() !== '' ? email.trim() : null,
      phone: phone && phone.trim() !== '' ? phone.trim() : null,
      percentage: !!percentage,
      receive_email: !!receiveEmail,
      get_appointments: !!getAppointments,
      sort_order: sort_order !== undefined ? sort_order : 999,
      appointment_color: appointment_color && appointment_color.trim() !== '' ? appointment_color.trim() : null,
    });

    sendSuccess(res, { employeeID: newID }, 'Employee added successfully');

  } catch (error) {
    log.error('Error adding employee:', error);
    ErrorResponses.internalError(res, 'Failed to add employee', error as Error);
  }
});

/**
 * PUT /employees/:id
 * Update employee
 */
router.put('/employees/:id', validate({ params: idParams('id'), body: employeeBodySchema }), async (req: Request<EmployeeParams, object, EmployeeBody>, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { employee_name, position, email, phone, percentage, receiveEmail, getAppointments, sort_order, appointment_color } = req.body;

    if (!employee_name || employee_name.trim() === '') {
      ErrorResponses.badRequest(res, 'Employee name is required');
      return;
    }

    if (!position) {
      ErrorResponses.badRequest(res, 'position is required');
      return;
    }

    // Check if email already exists for another employee (if provided)
    if (email && email.trim() !== '') {
      if (await employeeEmailExists(email.trim(), parseInt(id))) {
        ErrorResponses.badRequest(res, 'Another employee with this email already exists');
        return;
      }
    }

    await updateEmployee(parseInt(id), {
      employee_name: employee_name.trim(),
      position,
      email: email && email.trim() !== '' ? email.trim() : null,
      phone: phone && phone.trim() !== '' ? phone.trim() : null,
      percentage: !!percentage,
      receive_email: !!receiveEmail,
      get_appointments: !!getAppointments,
      sort_order: sort_order !== undefined ? sort_order : 999,
      appointment_color: appointment_color && appointment_color.trim() !== '' ? appointment_color.trim() : null,
    });

    sendSuccess(res, null, 'Employee updated successfully');

  } catch (error) {
    log.error('Error updating employee:', error);
    ErrorResponses.internalError(res, 'Failed to update employee', error as Error);
  }
});

/**
 * DELETE /employees/:id
 * Delete employee
 */
router.delete('/employees/:id', validate({ params: idParams('id') }), async (req: Request<EmployeeParams>, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    await deleteEmployee(parseInt(id));

    sendSuccess(res, null, 'Employee deleted successfully');

  } catch (error) {
    log.error('Error deleting employee:', error);
    ErrorResponses.internalError(res, 'Failed to delete employee', error as Error);
  }
});

export default router;
