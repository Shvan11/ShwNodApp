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
 * GET /statistics/yearly
 * Get monthly totals for a 12-month period starting from specified month/year
 * Query params: startMonth, startYear, exchangeRate (optional)
 */
router.get('/statistics/yearly', async (req, res) => {
    try {
        const { startMonth, startYear, exchangeRate } = req.query;

        // Validate required parameters
        if (!startMonth || !startYear) {
            return ErrorResponses.badRequest(res, 'Missing required parameters: startMonth and startYear are required');
        }

        const { month: monthNum, year: yearNum } = validateMonthYear(startMonth, startYear);
        const exRate = exchangeRate ? parseInt(exchangeRate) : 1450;

        // Execute stored procedure for 12-month period
        const monthlyData = await database.executeStoredProcedure(
            'ProcYearlyMonthlyTotals',
            [
                ['startMonth', database.TYPES.Int, monthNum],
                ['startYear', database.TYPES.Int, yearNum],
                ['Ex', database.TYPES.Int, exRate]
            ],
            null,
            (columns) => {
                const row = {};
                columns.forEach(column => {
                    row[column.metadata.colName] = column.value;
                });
                return row;
            }
        );

        // Calculate period summary
        const summary = monthlyData.reduce((acc, month) => ({
            totalRevenue: {
                IQD: acc.totalRevenue.IQD + (month.SumIQD || 0),
                USD: acc.totalRevenue.USD + (month.SumUSD || 0)
            },
            totalExpenses: {
                IQD: acc.totalExpenses.IQD + Math.abs(month.ExpensesIQD || 0),
                USD: acc.totalExpenses.USD + Math.abs(month.ExpensesUSD || 0)
            },
            netProfit: {
                IQD: acc.netProfit.IQD + (month.FinalIQDSum || 0),
                USD: acc.netProfit.USD + (month.FinalUSDSum || 0)
            },
            grandTotal: acc.grandTotal + (month.GrandTotal || 0)
        }), {
            totalRevenue: { IQD: 0, USD: 0 },
            totalExpenses: { IQD: 0, USD: 0 },
            netProfit: { IQD: 0, USD: 0 },
            grandTotal: 0
        });

        res.json({
            success: true,
            startMonth: monthNum,
            startYear: yearNum,
            exchangeRate: exRate,
            monthlyData: monthlyData,
            summary: summary
        });

    } catch (error) {
        log.error("Error fetching yearly statistics:", error);

        if (error.message.includes('Month') || error.message.includes('Year')) {
            return ErrorResponses.badRequest(res, error.message);
        }

        ErrorResponses.internalError(res, 'Failed to fetch yearly statistics', error);
    }
});

/**
 * GET /statistics/multi-year
 * Get yearly totals for a range of years
 * Query params: startYear, endYear, exchangeRate (optional)
 * Returns aggregated totals for each full year in the range
 */
router.get('/statistics/multi-year', async (req, res) => {
    try {
        const { startYear, endYear, exchangeRate } = req.query;

        // Validate required parameters
        if (!startYear || !endYear) {
            return ErrorResponses.badRequest(res, 'Missing required parameters: startYear and endYear are required');
        }

        const startYearNum = parseInt(startYear);
        const endYearNum = parseInt(endYear);
        const exRate = exchangeRate ? parseInt(exchangeRate) : 1450;

        // Validate year range
        if (isNaN(startYearNum) || startYearNum < 2000 || startYearNum > 2100) {
            return ErrorResponses.badRequest(res, 'Invalid startYear: must be between 2000 and 2100');
        }
        if (isNaN(endYearNum) || endYearNum < 2000 || endYearNum > 2100) {
            return ErrorResponses.badRequest(res, 'Invalid endYear: must be between 2000 and 2100');
        }
        if (startYearNum > endYearNum) {
            return ErrorResponses.badRequest(res, 'startYear must be less than or equal to endYear');
        }
        if (endYearNum - startYearNum > 10) {
            return ErrorResponses.badRequest(res, 'Year range cannot exceed 10 years');
        }

        // Fetch data for each year by calling ProcYearlyMonthlyTotals for Jan-Dec
        const yearlyData = [];

        for (let year = startYearNum; year <= endYearNum; year++) {
            // Get 12 months of data starting from January of this year
            const monthlyData = await database.executeStoredProcedure(
                'ProcYearlyMonthlyTotals',
                [
                    ['startMonth', database.TYPES.Int, 1],
                    ['startYear', database.TYPES.Int, year],
                    ['Ex', database.TYPES.Int, exRate]
                ],
                null,
                (columns) => {
                    const row = {};
                    columns.forEach(column => {
                        row[column.metadata.colName] = column.value;
                    });
                    return row;
                }
            );

            // Filter to only include months from this year and aggregate
            const yearMonths = monthlyData.filter(m => m.Year === year);
            const yearTotal = yearMonths.reduce((acc, month) => ({
                Year: year,
                SumIQD: acc.SumIQD + (month.SumIQD || 0),
                SumUSD: acc.SumUSD + (month.SumUSD || 0),
                ExpensesIQD: acc.ExpensesIQD + (month.ExpensesIQD || 0),
                ExpensesUSD: acc.ExpensesUSD + (month.ExpensesUSD || 0),
                FinalIQDSum: acc.FinalIQDSum + (month.FinalIQDSum || 0),
                FinalUSDSum: acc.FinalUSDSum + (month.FinalUSDSum || 0),
                GrandTotal: acc.GrandTotal + (month.GrandTotal || 0)
            }), {
                Year: year,
                SumIQD: 0,
                SumUSD: 0,
                ExpensesIQD: 0,
                ExpensesUSD: 0,
                FinalIQDSum: 0,
                FinalUSDSum: 0,
                GrandTotal: 0
            });

            yearlyData.push(yearTotal);
        }

        // Calculate overall summary
        const summary = yearlyData.reduce((acc, year) => ({
            totalRevenue: {
                IQD: acc.totalRevenue.IQD + year.SumIQD,
                USD: acc.totalRevenue.USD + year.SumUSD
            },
            totalExpenses: {
                IQD: acc.totalExpenses.IQD + Math.abs(year.ExpensesIQD),
                USD: acc.totalExpenses.USD + Math.abs(year.ExpensesUSD)
            },
            netProfit: {
                IQD: acc.netProfit.IQD + year.FinalIQDSum,
                USD: acc.netProfit.USD + year.FinalUSDSum
            },
            grandTotal: acc.grandTotal + year.GrandTotal
        }), {
            totalRevenue: { IQD: 0, USD: 0 },
            totalExpenses: { IQD: 0, USD: 0 },
            netProfit: { IQD: 0, USD: 0 },
            grandTotal: 0
        });

        res.json({
            success: true,
            startYear: startYearNum,
            endYear: endYearNum,
            exchangeRate: exRate,
            yearlyData: yearlyData,
            summary: summary
        });

    } catch (error) {
        log.error("Error fetching multi-year statistics:", error);
        ErrorResponses.internalError(res, 'Failed to fetch multi-year statistics', error);
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
