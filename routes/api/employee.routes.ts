/**
 * Employee Management Routes
 *
 * Handles all employee-related API endpoints including:
 * - Fetching employees and positions
 * - Managing email recipients
 * - CRUD operations for employee records
 */

import { Router, type Request, type Response } from 'express';
import * as database from '../../services/database/index.js';
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

    // Build WHERE clause conditions
    const conditions: string[] = [];

    if (getAppointments === 'true') {
      conditions.push('e.getAppointments = 1');
    }

    if (receiveEmail === 'true') {
      conditions.push('e.receiveEmail = 1');
      conditions.push('e.Email IS NOT NULL');
      conditions.push("e.Email != ''");
    }

    if (percentage === 'true') {
      conditions.push('e.Percentage = 1');
    }

    if (position) {
      // Support filtering by position name or ID
      if (isNaN(Number(position))) {
        conditions.push(`p.PositionName = '${position.replace(/'/g, "''")}'`);
      } else {
        conditions.push(`e.Position = ${parseInt(position)}`);
      }
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const query = `
      SELECT e.ID, e.employeeName, e.Position, p.PositionName, e.Email, e.Phone, e.Percentage, e.receiveEmail, e.getAppointments, e.SortOrder
      FROM tblEmployees e
      LEFT JOIN tblPositions p ON e.Position = p.ID
      ${whereClause}
      ORDER BY e.SortOrder, e.employeeName
    `;

    const employees = await database.executeQuery<Employee>(
      query,
      [],
      (columns) => ({
        ID: columns[0].value as number,
        employeeName: columns[1].value as string,
        Position: columns[2].value as number,
        PositionName: columns[3].value as string | null,
        Email: columns[4].value as string | null,
        Phone: columns[5].value as string | null,
        Percentage: columns[6].value as boolean,
        receiveEmail: columns[7].value as boolean,
        getAppointments: columns[8].value as boolean,
        SortOrder: columns[9].value as number
      })
    );

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
    const query = `
      SELECT ID, PositionName
      FROM tblPositions
      ORDER BY PositionName
    `;

    const positions = await database.executeQuery<Position>(
      query,
      [],
      (columns) => ({
        ID: columns[0].value as number,
        PositionName: columns[1].value as string
      })
    );

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
    const { employeeName, Position, Email, Phone, Percentage, receiveEmail, getAppointments, SortOrder } = req.body;

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
      const emailCheck = await database.executeQuery<number>(
        'SELECT ID FROM tblEmployees WHERE Email = @email',
        [['email', database.TYPES.NVarChar, Email.trim()]],
        (columns) => columns[0].value as number
      );

      if (emailCheck && emailCheck.length > 0) {
        ErrorResponses.badRequest(res, 'An employee with this email already exists');
        return;
      }
    }

    const insertQuery = `
      DECLARE @OutputTable TABLE (ID INT);

      INSERT INTO tblEmployees (employeeName, Position, Email, Phone, Percentage, receiveEmail, getAppointments, SortOrder)
      OUTPUT INSERTED.ID INTO @OutputTable
      VALUES (@name, @position, @email, @phone, @percentage, @receiveEmail, @getAppointments, @sortOrder);

      SELECT ID FROM @OutputTable;
    `;

    const result = await database.executeQuery<number>(
      insertQuery,
      [
        ['name', database.TYPES.NVarChar, employeeName.trim()],
        ['position', database.TYPES.Int, Position],
        ['email', database.TYPES.NVarChar, Email && Email.trim() !== '' ? Email.trim() : null],
        ['phone', database.TYPES.NVarChar, Phone && Phone.trim() !== '' ? Phone.trim() : null],
        ['percentage', database.TYPES.Bit, Percentage ? 1 : 0],
        ['receiveEmail', database.TYPES.Bit, receiveEmail ? 1 : 0],
        ['getAppointments', database.TYPES.Bit, getAppointments ? 1 : 0],
        ['sortOrder', database.TYPES.Int, SortOrder !== undefined ? SortOrder : 999]
      ],
      (columns) => columns[0].value as number
    );

    const newID = result && result.length > 0 ? result[0] : null;

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
    const { employeeName, Position, Email, Phone, Percentage, receiveEmail, getAppointments, SortOrder } = req.body;

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
      const emailCheck = await database.executeQuery<number>(
        'SELECT ID FROM tblEmployees WHERE Email = @email AND ID != @id',
        [
          ['email', database.TYPES.NVarChar, Email.trim()],
          ['id', database.TYPES.Int, parseInt(id)]
        ],
        (columns) => columns[0].value as number
      );

      if (emailCheck && emailCheck.length > 0) {
        ErrorResponses.badRequest(res, 'Another employee with this email already exists');
        return;
      }
    }

    const updateQuery = `
      UPDATE tblEmployees
      SET employeeName = @name,
          Position = @position,
          Email = @email,
          Phone = @phone,
          Percentage = @percentage,
          receiveEmail = @receiveEmail,
          getAppointments = @getAppointments,
          SortOrder = @sortOrder
      WHERE ID = @id
    `;

    await database.executeQuery(
      updateQuery,
      [
        ['name', database.TYPES.NVarChar, employeeName.trim()],
        ['position', database.TYPES.Int, Position],
        ['email', database.TYPES.NVarChar, Email && Email.trim() !== '' ? Email.trim() : null],
        ['phone', database.TYPES.NVarChar, Phone && Phone.trim() !== '' ? Phone.trim() : null],
        ['percentage', database.TYPES.Bit, Percentage ? 1 : 0],
        ['receiveEmail', database.TYPES.Bit, receiveEmail ? 1 : 0],
        ['getAppointments', database.TYPES.Bit, getAppointments ? 1 : 0],
        ['sortOrder', database.TYPES.Int, SortOrder !== undefined ? SortOrder : 999],
        ['id', database.TYPES.Int, parseInt(id)]
      ]
    );

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

    const deleteQuery = 'DELETE FROM tblEmployees WHERE ID = @id';

    await database.executeQuery(
      deleteQuery,
      [['id', database.TYPES.Int, parseInt(id)]]
    );

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
