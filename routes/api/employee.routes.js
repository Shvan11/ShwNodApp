/**
 * Employee Management Routes
 *
 * Handles all employee-related API endpoints including:
 * - Fetching employees and positions
 * - Managing email recipients
 * - CRUD operations for employee records
 */

import express from 'express';
import * as database from '../../services/database/index.js';
import { sendError, ErrorResponses } from '../../utils/error-response.js';
import { log } from '../../utils/logger.js';

const router = express.Router();

/**
 * Get all employees with flexible filtering
 * GET /employees
 *
 * Query Parameters (all optional):
 * - getAppointments: 'true' to filter only employees who can receive appointments
 * - receiveEmail: 'true' to filter only employees who receive email notifications
 * - percentage: 'true' to filter only employees with percentage-based compensation
 * - position: position ID or name to filter by specific position
 *
 * Examples:
 * - GET /api/employees                           -> All employees
 * - GET /api/employees?getAppointments=true      -> Only employees who can take appointments (doctors, hygienists, etc.)
 * - GET /api/employees?receiveEmail=true         -> Only employees who receive emails
 * - GET /api/employees?position=Doctor           -> Only doctors
 * - GET /api/employees?getAppointments=true&position=Hygienist -> Only hygienists who can take appointments
 */
router.get('/employees', async (req, res) => {
    try {
        const { getAppointments, receiveEmail, percentage, position } = req.query;

        // Build WHERE clause conditions
        const conditions = [];

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
            if (isNaN(position)) {
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

        const employees = await database.executeQuery(
            query,
            [],
            (columns) => ({
                ID: columns[0].value,
                employeeName: columns[1].value,
                Position: columns[2].value,
                PositionName: columns[3].value,
                Email: columns[4].value,
                Phone: columns[5].value,
                Percentage: columns[6].value,
                receiveEmail: columns[7].value,
                getAppointments: columns[8].value,
                SortOrder: columns[9].value
            })
        );

        res.json({
            success: true,
            employees: employees || []
        });

    } catch (error) {
        log.error('Error fetching employees:', error);
        return ErrorResponses.internalError(res, 'Failed to fetch employees', error);
    }
});

/**
 * Get all positions
 * GET /positions
 */
router.get('/positions', async (req, res) => {
    try {
        const query = `
            SELECT ID, PositionName
            FROM tblPositions
            ORDER BY PositionName
        `;

        const positions = await database.executeQuery(
            query,
            [],
            (columns) => ({
                ID: columns[0].value,
                PositionName: columns[1].value
            })
        );

        res.json({
            success: true,
            positions: positions || []
        });

    } catch (error) {
        log.error('Error fetching positions:', error);
        return ErrorResponses.internalError(res, 'Failed to fetch positions', error);
    }
});


/**
 * Add new employee
 * POST /employees
 *
 * Request body:
 * {
 *   employeeName: string (required),
 *   Position: number (required),
 *   Email?: string,
 *   Phone?: string,
 *   Percentage?: boolean,
 *   receiveEmail?: boolean,
 *   getAppointments?: boolean
 * }
 */
router.post('/employees', async (req, res) => {
    try {
        const { employeeName, Position, Email, Phone, Percentage, receiveEmail, getAppointments, SortOrder } = req.body;

        if (!employeeName || employeeName.trim() === '') {
            return ErrorResponses.badRequest(res, 'Employee name is required');
        }

        if (!Position) {
            return ErrorResponses.badRequest(res, 'Position is required');
        }

        // Check if email already exists (if provided)
        if (Email && Email.trim() !== '') {
            const emailCheck = await database.executeQuery(
                'SELECT ID FROM tblEmployees WHERE Email = @email',
                [['email', database.TYPES.NVarChar, Email.trim()]],
                (columns) => columns[0].value
            );

            if (emailCheck && emailCheck.length > 0) {
                return ErrorResponses.badRequest(res, 'An employee with this email already exists');
            }
        }

        const insertQuery = `
            DECLARE @OutputTable TABLE (ID INT);

            INSERT INTO tblEmployees (employeeName, Position, Email, Phone, Percentage, receiveEmail, getAppointments, SortOrder)
            OUTPUT INSERTED.ID INTO @OutputTable
            VALUES (@name, @position, @email, @phone, @percentage, @receiveEmail, @getAppointments, @sortOrder);

            SELECT ID FROM @OutputTable;
        `;

        const result = await database.executeQuery(
            insertQuery,
            [
                ['name', database.TYPES.NVarChar, employeeName.trim()],
                ['position', database.TYPES.Int, parseInt(Position)],
                ['email', database.TYPES.NVarChar, Email && Email.trim() !== '' ? Email.trim() : null],
                ['phone', database.TYPES.NVarChar, Phone && Phone.trim() !== '' ? Phone.trim() : null],
                ['percentage', database.TYPES.Bit, Percentage ? 1 : 0],
                ['receiveEmail', database.TYPES.Bit, receiveEmail ? 1 : 0],
                ['getAppointments', database.TYPES.Bit, getAppointments ? 1 : 0],
                ['sortOrder', database.TYPES.Int, SortOrder !== undefined ? parseInt(SortOrder) : 999]
            ],
            (columns) => columns[0].value
        );

        const newID = result && result.length > 0 ? result[0] : null;

        res.json({
            success: true,
            message: 'Employee added successfully',
            employeeID: newID
        });

    } catch (error) {
        log.error('Error adding employee:', error);
        return ErrorResponses.internalError(res, 'Failed to add employee', error);
    }
});

/**
 * Update employee
 * PUT /employees/:id
 *
 * URL params:
 * - id: employee ID
 *
 * Request body:
 * {
 *   employeeName: string (required),
 *   Position: number (required),
 *   Email?: string,
 *   Phone?: string,
 *   Percentage?: boolean,
 *   receiveEmail?: boolean,
 *   getAppointments?: boolean
 * }
 */
router.put('/employees/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { employeeName, Position, Email, Phone, Percentage, receiveEmail, getAppointments, SortOrder } = req.body;

        if (!employeeName || employeeName.trim() === '') {
            return ErrorResponses.badRequest(res, 'Employee name is required');
        }

        if (!Position) {
            return ErrorResponses.badRequest(res, 'Position is required');
        }

        // Check if email already exists for another employee (if provided)
        if (Email && Email.trim() !== '') {
            const emailCheck = await database.executeQuery(
                'SELECT ID FROM tblEmployees WHERE Email = @email AND ID != @id',
                [
                    ['email', database.TYPES.NVarChar, Email.trim()],
                    ['id', database.TYPES.Int, parseInt(id)]
                ],
                (columns) => columns[0].value
            );

            if (emailCheck && emailCheck.length > 0) {
                return ErrorResponses.badRequest(res, 'Another employee with this email already exists');
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
                ['position', database.TYPES.Int, parseInt(Position)],
                ['email', database.TYPES.NVarChar, Email && Email.trim() !== '' ? Email.trim() : null],
                ['phone', database.TYPES.NVarChar, Phone && Phone.trim() !== '' ? Phone.trim() : null],
                ['percentage', database.TYPES.Bit, Percentage ? 1 : 0],
                ['receiveEmail', database.TYPES.Bit, receiveEmail ? 1 : 0],
                ['getAppointments', database.TYPES.Bit, getAppointments ? 1 : 0],
                ['sortOrder', database.TYPES.Int, SortOrder !== undefined ? parseInt(SortOrder) : 999],
                ['id', database.TYPES.Int, parseInt(id)]
            ]
        );

        res.json({
            success: true,
            message: 'Employee updated successfully'
        });

    } catch (error) {
        log.error('Error updating employee:', error);
        return ErrorResponses.internalError(res, 'Failed to update employee', error);
    }
});

/**
 * Delete employee
 * DELETE /employees/:id
 *
 * URL params:
 * - id: employee ID
 */
router.delete('/employees/:id', async (req, res) => {
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
        return ErrorResponses.internalError(res, 'Failed to delete employee', error);
    }
});

export default router;
