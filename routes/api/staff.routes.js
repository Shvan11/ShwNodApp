/**
 * Staff Routes
 * Handles doctor and operator data retrieval
 */
import express from 'express';
import * as database from '../../services/database/index.js';
import { sendError, ErrorResponses } from '../../utils/error-response.js';
import { log } from '../../utils/logger.js';

const router = express.Router();

/**
 * GET /doctors
 * Get all doctors (employees with Position = Doctor)
 */
router.get("/doctors", async (req, res) => {
    try {
        const query = `
            SELECT e.ID, e.employeeName
            FROM tblEmployees e
            INNER JOIN tblPositions p ON e.Position = p.ID
            WHERE p.PositionName = 'Doctor'
            ORDER BY e.employeeName
        `;
        const doctors = await database.executeQuery(
            query,
            [],
            (columns) => ({
                ID: columns[0].value,
                employeeName: columns[1].value
            })
        );
        res.json(doctors);
    } catch (error) {
        log.error('Error fetching doctors:', error);
        ErrorResponses.internalError(res, 'Failed to fetch doctors', error);
    }
});

/**
 * GET /operators
 * Get all operators (all employees)
 */
router.get("/operators", async (req, res) => {
    try {
        const query = `
            SELECT e.ID, e.employeeName
            FROM tblEmployees e
            ORDER BY e.employeeName
        `;
        const operators = await database.executeQuery(
            query,
            [],
            (columns) => ({
                ID: columns[0].value,
                employeeName: columns[1].value
            })
        );
        res.json(operators);
    } catch (error) {
        log.error('Error fetching operators:', error);
        ErrorResponses.internalError(res, 'Failed to fetch operators', error);
    }
});

export default router;
