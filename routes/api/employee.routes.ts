/**
 * Employee Management Routes
 *
 * Handles all employee-related API endpoints including:
 * - Fetching employees and positions
 * - Managing email recipients
 * - CRUD operations for employee records
 */

import { Router, type Request, type Response } from 'express';
import {
  createEmployee,
  updateEmployee,
  deleteEmployee,
  employeeEmailExists,
  listEmployees,
  listPositions,
} from '../../services/database/queries/employee-queries.js';
import { ErrorResponses, sendSuccess, sendData } from '../../utils/error-response.js';
import { validate } from '../../middleware/validate.js';
import { authorize } from '../../middleware/auth.js';
import { ADMIN_ROLES } from '../../shared/auth/roles.js';
import * as employee from '../../shared/contracts/employee.contract.js';
import { log } from '../../utils/logger.js';

const router = Router();

/**
 * Query parameters for filtering employees
 */
type EmployeeQuery = employee.EmployeeQuery;

/**
 * Route params for employee by id
 */
type EmployeeParams = employee.EmployeeParams;

/**
 * GET /employees
 * Get all employees with flexible filtering
 *
 * Query Parameters (all optional):
 * - get_appointments: 'true' to filter only employees who can receive appointments
 * - receive_email: 'true' to filter only employees who receive email notifications
 * - percentage: 'true' to filter only employees with percentage-based compensation
 * - position: position id or name to filter by specific position
 * - includeInactive: 'true' to ALSO return quit (is_active=false) employees.
 *   By default they are hidden — only the Settings page opts in. Everywhere else
 *   (dropdowns, recipient lists) sees active staff only.
 */
router.get('/employees', validate({ query: employee.employees.query }), async (req: Request<object, object, object, EmployeeQuery>, res: Response): Promise<void> => {
  try {
    const { getAppointments, receiveEmail, percentage, position, includeInactive } = req.query;

    const employees = await listEmployees({
      getAppointments: getAppointments === 'true',
      receiveEmail: receiveEmail === 'true',
      percentage: percentage === 'true',
      position,
      includeInactive: includeInactive === 'true',
    });

    sendData(res, employee.employees.response, { employees });

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
    const positions = await listPositions();

    sendData(res, employee.positions.response, { positions });

  } catch (error) {
    log.error('Error fetching positions:', error);
    ErrorResponses.internalError(res, 'Failed to fetch positions', error as Error);
  }
});

/**
 * POST /employees
 * Add new employee
 */
router.post('/employees', authorize(ADMIN_ROLES), validate({ body: employee.createEmployee.body }), async (req: Request<object, object, employee.EmployeeBody>, res: Response): Promise<void> => {
  try {
    const { employee_name, position, email, phone, percentage, commissionPercentage, receiveEmail, getAppointments, is_active, sort_order, appointment_color } = req.body;

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
      // Rate is stored only when the flag is on; off → null (belt-and-suspenders
      // with the contract refine that requires a rate when the flag is on).
      commission_percentage: percentage ? (commissionPercentage ?? null) : null,
      receive_email: !!receiveEmail,
      get_appointments: !!getAppointments,
      // Omitted → active by default (new hires); explicit false marks a quit employee.
      is_active: is_active === undefined ? true : !!is_active,
      sort_order: sort_order !== undefined ? sort_order : 999,
      appointment_color: appointment_color && appointment_color.trim() !== '' ? appointment_color.trim() : null,
    });

    sendData(res, employee.createEmployee.response, { employeeID: newID }, 'Employee added successfully');

  } catch (error) {
    log.error('Error adding employee:', error);
    ErrorResponses.internalError(res, 'Failed to add employee', error as Error);
  }
});

/**
 * PUT /employees/:id
 * Update employee
 */
router.put('/employees/:id', authorize(ADMIN_ROLES), validate({ params: employee.updateEmployee.params, body: employee.updateEmployee.body }), async (req: Request<EmployeeParams, object, employee.EmployeeBody>, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { employee_name, position, email, phone, percentage, commissionPercentage, receiveEmail, getAppointments, is_active, sort_order, appointment_color } = req.body;

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
      if (await employeeEmailExists(email.trim(), parseInt(id, 10))) {
        ErrorResponses.badRequest(res, 'Another employee with this email already exists');
        return;
      }
    }

    await updateEmployee(parseInt(id, 10), {
      employee_name: employee_name.trim(),
      position,
      email: email && email.trim() !== '' ? email.trim() : null,
      phone: phone && phone.trim() !== '' ? phone.trim() : null,
      percentage: !!percentage,
      // Rate is stored only when the flag is on; off → null (belt-and-suspenders
      // with the contract refine that requires a rate when the flag is on).
      commission_percentage: percentage ? (commissionPercentage ?? null) : null,
      receive_email: !!receiveEmail,
      get_appointments: !!getAppointments,
      is_active: is_active === undefined ? true : !!is_active,
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
router.delete('/employees/:id', authorize(ADMIN_ROLES), validate({ params: employee.deleteEmployee.params }), async (req: Request<EmployeeParams>, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    await deleteEmployee(parseInt(id, 10));

    sendSuccess(res, null, 'Employee deleted successfully');

  } catch (error) {
    log.error('Error deleting employee:', error);
    ErrorResponses.internalError(res, 'Failed to delete employee', error as Error);
  }
});

export default router;
