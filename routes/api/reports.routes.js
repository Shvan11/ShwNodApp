/**
 * Reports & Statistics Routes
 * Handles financial statistics and daily invoice reports
 */
import express from 'express';
import * as database from '../../services/database/index.js';

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
            return res.status(400).json({
                success: false,
                error: "Missing required parameters: month and year are required"
            });
        }

        const monthNum = parseInt(month);
        const yearNum = parseInt(year);
        const exRate = exchangeRate ? parseInt(exchangeRate) : 1450; // Default exchange rate

        // Validate month and year ranges
        if (monthNum < 1 || monthNum > 12) {
            return res.status(400).json({
                success: false,
                error: "Invalid month: must be between 1 and 12"
            });
        }

        if (yearNum < 2000 || yearNum > 2100) {
            return res.status(400).json({
                success: false,
                error: "Invalid year: must be between 2000 and 2100"
            });
        }

        // Execute the stored procedure
        const result = await database.executeStoredProcedure(
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

        // Calculate monthly totals
        let totalIQD = 0;
        let totalUSD = 0;
        let totalExpensesIQD = 0;
        let totalExpensesUSD = 0;
        let finalQasaIQD = 0;
        let finalQasaUSD = 0;

        result.forEach(day => {
            totalIQD += day.SumIQD || 0;
            totalUSD += day.SumUSD || 0;
            totalExpensesIQD += Math.abs(day.ExpensesIQD || 0);
            totalExpensesUSD += Math.abs(day.ExpensesUSD || 0);
            // Use the last day's Qasa values as the final balance
            finalQasaIQD = day.QasaIQD || 0;
            finalQasaUSD = day.QasaUSD || 0;
        });

        const netIQD = totalIQD - totalExpensesIQD;
        const netUSD = totalUSD - totalExpensesUSD;
        const grandTotalUSD = (netIQD / exRate) + netUSD;
        const grandTotalIQD = netIQD + (netUSD * exRate);

        res.json({
            success: true,
            month: monthNum,
            year: yearNum,
            exchangeRate: exRate,
            dailyData: result,
            summary: {
                totalRevenue: {
                    IQD: totalIQD,
                    USD: totalUSD
                },
                totalExpenses: {
                    IQD: totalExpensesIQD,
                    USD: totalExpensesUSD
                },
                netProfit: {
                    IQD: netIQD,
                    USD: netUSD
                },
                grandTotal: {
                    USD: Math.round(grandTotalUSD * 100) / 100,
                    IQD: Math.round(grandTotalIQD)
                },
                cashBox: {
                    IQD: finalQasaIQD,
                    USD: finalQasaUSD
                }
            }
        });

    } catch (error) {
        console.error("Error fetching statistics:", error);
        res.status(500).json({
            success: false,
            error: "Failed to fetch statistics",
            message: error.message
        });
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
            return res.status(400).json({
                success: false,
                error: "Missing required parameter: date"
            });
        }

        // Validate date format
        const dateObj = new Date(date);
        if (isNaN(dateObj.getTime())) {
            return res.status(400).json({
                success: false,
                error: "Invalid date format"
            });
        }

        // Execute the stored procedure
        const result = await database.executeStoredProcedure(
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

        // Get IQDReceived and USDReceived for each invoice
        const enrichedInvoices = await Promise.all(result.map(async (invoice) => {
            const invoiceDetails = await database.executeQuery(
                'SELECT IQDReceived, USDReceived FROM tblInvoice WHERE invoiceID = @invoiceID',
                [['invoiceID', database.TYPES.Int, invoice.invoiceID]],
                (columns) => {
                    const row = {};
                    columns.forEach(column => {
                        row[column.metadata.colName] = column.value;
                    });
                    return row;
                }
            );

            return {
                ...invoice,
                IQDReceived: invoiceDetails[0]?.IQDReceived || 0,
                USDReceived: invoiceDetails[0]?.USDReceived || 0
            };
        }));

        res.json({
            success: true,
            date: date,
            count: enrichedInvoices.length,
            invoices: enrichedInvoices
        });

    } catch (error) {
        console.error("Error fetching daily invoices:", error);
        res.status(500).json({
            success: false,
            error: "Failed to fetch daily invoices",
            message: error.message
        });
    }
});

export default router;
