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

const router = express.Router();

/**
 * Get all employees
 * GET /employees
 */
router.get('/employees', async (req, res) => {
    try {
        const query = `
            SELECT ID, employeeName, Position, Email, Phone, Percentage, receiveEmail, getAppointments
            FROM tblEmployees
            ORDER BY employeeName
        `;

        const employees = await database.executeQuery(
            query,
            [],
            (columns) => ({
                ID: columns[0].value,
                employeeName: columns[1].value,
                Position: columns[2].value,
                Email: columns[3].value,
                Phone: columns[4].value,
                Percentage: columns[5].value,
                receiveEmail: columns[6].value,
                getAppointments: columns[7].value
            })
        );

        res.json({
            success: true,
            employees: employees || []
        });

    } catch (error) {
        console.error('Error fetching employees:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch employees',
            message: error.message
        });
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
        console.error('Error fetching positions:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch positions',
            message: error.message
        });
    }
});

/**
 * Get employees eligible for email notifications
 * GET /employees/email-recipients
 */
router.get('/employees/email-recipients', async (req, res) => {
    try {
        const query = `
            SELECT ID, employeeName, Email
            FROM tblEmployees
            WHERE receiveEmail = 1
              AND Email IS NOT NULL
              AND Email != ''
            ORDER BY employeeName
        `;

        const recipients = await database.executeQuery(
            query,
            [],
            (columns) => ({
                ID: columns[0].value,
                employeeName: columns[1].value,
                Email: columns[2].value
            })
        );

        res.json({
            success: true,
            recipients: recipients || [],
            count: recipients ? recipients.length : 0
        });

    } catch (error) {
        console.error('Error fetching email recipients:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch email recipients',
            message: error.message
        });
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
        const { employeeName, Position, Email, Phone, Percentage, receiveEmail, getAppointments } = req.body;

        if (!employeeName || employeeName.trim() === '') {
            return res.status(400).json({
                success: false,
                error: 'Employee name is required'
            });
        }

        if (!Position) {
            return res.status(400).json({
                success: false,
                error: 'Position is required'
            });
        }

        // Check if email already exists (if provided)
        if (Email && Email.trim() !== '') {
            const emailCheck = await database.executeQuery(
                'SELECT ID FROM tblEmployees WHERE Email = @email',
                [['email', database.TYPES.NVarChar, Email.trim()]],
                (columns) => columns[0].value
            );

            if (emailCheck && emailCheck.length > 0) {
                return res.status(400).json({
                    success: false,
                    error: 'An employee with this email already exists'
                });
            }
        }

        const insertQuery = `
            DECLARE @OutputTable TABLE (ID INT);

            INSERT INTO tblEmployees (employeeName, Position, Email, Phone, Percentage, receiveEmail, getAppointments)
            OUTPUT INSERTED.ID INTO @OutputTable
            VALUES (@name, @position, @email, @phone, @percentage, @receiveEmail, @getAppointments);

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
                ['getAppointments', database.TYPES.Bit, getAppointments ? 1 : 0]
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
        console.error('Error adding employee:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to add employee',
            message: error.message
        });
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
        const { employeeName, Position, Email, Phone, Percentage, receiveEmail, getAppointments } = req.body;

        if (!employeeName || employeeName.trim() === '') {
            return res.status(400).json({
                success: false,
                error: 'Employee name is required'
            });
        }

        if (!Position) {
            return res.status(400).json({
                success: false,
                error: 'Position is required'
            });
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
                return res.status(400).json({
                    success: false,
                    error: 'Another employee with this email already exists'
                });
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
                getAppointments = @getAppointments
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
                ['id', database.TYPES.Int, parseInt(id)]
            ]
        );

        res.json({
            success: true,
            message: 'Employee updated successfully'
        });

    } catch (error) {
        console.error('Error updating employee:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update employee',
            message: error.message
        });
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
        console.error('Error deleting employee:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete employee',
            message: error.message
        });
    }
});

export default router;
