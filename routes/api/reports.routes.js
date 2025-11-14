/**
 * Reports & Statistics Routes
 * Handles financial statistics and daily invoice reports
 */
import express from 'express';
import { log } from '../../utils/logger.js';
import * as database from '../../services/database/index.js';
import { sendError, ErrorResponses } from '../../utils/error-response.js';
import {
    calculateMonthlyStatistics,
    enrichInvoicesWithDetails,
    validateMonthYear,
    validateDate
} from '../../services/business/FinancialReportService.js';

const router = express.Router();

/**
 * GET /statistics
 * Get monthly financial statistics
 * Query params: month, year, exchangeRate (optional)
 */
router.get('/statistics', async (req, res) => {
    try {
        const { month, year, exchangeRate } = req.query;

        // Validate required parameters
        if (!month || !year) {
            return ErrorResponses.badRequest(res, 'Missing required parameters: month and year are required');
        }

        // Delegate validation to service layer
        const { month: monthNum, year: yearNum } = validateMonthYear(month, year);
        const exRate = exchangeRate ? parseInt(exchangeRate) : 1450; // Default exchange rate

        // Execute the stored procedure
        const dailyData = await database.executeStoredProcedure(
            'ProcGrandTotal',
            [
                ['month', database.TYPES.Int, monthNum],
                ['year', database.TYPES.Int, yearNum],
                ['Ex', database.TYPES.Int, exRate]
            ],
            null, // beforeExec callback
            (columns) => {
                // Row mapper - convert columns to object
                const row = {};
                columns.forEach(column => {
                    row[column.metadata.colName] = column.value;
                });
                return row;
            }
        );

        // Delegate calculation to service layer
        const summary = calculateMonthlyStatistics(dailyData, exRate);

        res.json({
            success: true,
            month: monthNum,
            year: yearNum,
            exchangeRate: exRate,
            dailyData: dailyData,
            summary: summary
        });

    } catch (error) {
        log.error("Error fetching statistics:", error);

        // Handle validation errors from service layer
        if (error.message.includes('Month') || error.message.includes('Year')) {
            return ErrorResponses.badRequest(res, error.message);
        }

        ErrorResponses.internalError(res, 'Failed to fetch statistics', error);
    }
});

/**
 * GET /daily-invoices
 * Get daily invoices for a specific date
 * Query params: date (YYYY-MM-DD format)
 */
router.get('/daily-invoices', async (req, res) => {
    try {
        const { date } = req.query;

        // Validate required parameter
        if (!date) {
            return ErrorResponses.missingParameter(res, 'date');
        }

        // Delegate validation to service layer
        const dateObj = validateDate(date);

        // Execute the stored procedure
        const baseInvoices = await database.executeStoredProcedure(
            'ProDailyInvoices',
            [['iDate', database.TYPES.Date, dateObj]],
            null,
            (columns) => {
                const row = {};
                columns.forEach(column => {
                    row[column.metadata.colName] = column.value;
                });
                return row;
            }
        );

        // Delegate enrichment to service layer
        const enrichedInvoices = await enrichInvoicesWithDetails(baseInvoices);

        res.json({
            success: true,
            date: date,
            count: enrichedInvoices.length,
            invoices: enrichedInvoices
        });

    } catch (error) {
        log.error("Error fetching daily invoices:", error);

        // Handle validation errors from service layer
        if (error.message === 'Invalid date format') {
            return ErrorResponses.invalidParameter(res, 'date', error.message);
        }

        ErrorResponses.internalError(res, 'Failed to fetch daily invoices', error);
    }
});

export default router;
