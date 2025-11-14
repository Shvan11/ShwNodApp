/**
 * Payment & Invoice Routes
 *
 * Handles all payment-related operations including:
 * - Payment retrieval and history
 * - Invoice creation and deletion
 * - Exchange rate management
 * - Currency conversion and validation
 * - Receipt generation
 *
 * This module includes comprehensive validation for:
 * - Cross-currency payments with change tracking
 * - Same-currency payments (no change tracking)
 * - Exchange rate validation and constraints
 */

import express from 'express';
import * as database from '../../services/database/index.js';
import {
    getPayments,
    getActiveWorkForInvoice,
    getCurrentExchangeRate,
    addInvoice,
    updateExchangeRate,
    getPaymentHistoryByWorkId,
    getExchangeRateForDate,
    updateExchangeRateForDate
} from '../../services/database/queries/payment-queries.js';
import { getWorkDetails } from '../../services/database/queries/work-queries.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import {
    requireRecordAge,
    getInvoiceCreationDate
} from '../../middleware/time-based-auth.js';

const router = express.Router();

// ============================================================================
// PAYMENT RETRIEVAL ROUTES
// ============================================================================

/**
 * Get all payments for a patient
 * GET /api/getpayments?code={patientId}
 */
router.get("/getpayments", async (req, res) => {
    const { code: pid } = req.query;
    const payments = await getPayments(pid);
    res.json(payments);
});

/**
 * Get payment history for a specific work
 * GET /api/getpaymenthistory?workId={workId}
 */
router.get("/getpaymenthistory", async (req, res) => {
    try {
        const { workId } = req.query;
        if (!workId) {
            return res.status(400).json({ error: 'workId is required' });
        }
        const payments = await getPaymentHistoryByWorkId(parseInt(workId));
        res.json(payments);
    } catch (error) {
        console.error('Error fetching payment history:', error);
        res.status(500).json({ error: 'Failed to fetch payment history' });
    }
});

/**
 * Get work data for receipt generation
 * GET /api/getworkforreceipt/:workId
 */
router.get('/getworkforreceipt/:workId', async (req, res) => {
    try {
        const { workId } = req.params;
        if (!workId) {
            return res.status(400).json({ error: "Missing required parameter: workId" });
        }

        const result = await database.executeQuery(
            'SELECT PersonID, PatientName, Phone, TotalPaid, AppDate, workid, TotalRequired, Currency FROM dbo.V_Report WHERE workid = @WorkID',
            [['WorkID', database.TYPES.Int, parseInt(workId)]],
            (columns) => {
                const row = {};
                columns.forEach(column => {
                    row[column.metadata.colName] = column.value;
                });
                return row;
            }
        );

        if (!result || result.length === 0) {
            return res.status(404).json({ error: "Work not found" });
        }

        res.json(result[0]);
    } catch (error) {
        console.error("Error fetching work for receipt:", error);
        res.status(500).json({ error: "Failed to fetch work data" });
    }
});

/**
 * Get active work items for invoice creation
 * GET /api/getActiveWorkForInvoice?PID={patientId}
 */
router.get("/getActiveWorkForInvoice", async (req, res) => {
    try {
        const { PID } = req.query;
        if (!PID) {
            return res.status(400).json({ status: 'error', message: 'Missing required parameter: PID' });
        }

        const workData = await getActiveWorkForInvoice(PID);
        res.json({ status: 'success', data: workData });
    } catch (error) {
        console.error("Error getting active work for invoice:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// ============================================================================
// EXCHANGE RATE ROUTES
// ============================================================================

/**
 * Get current exchange rate for today
 * GET /api/getCurrentExchangeRate
 */
router.get("/getCurrentExchangeRate", async (req, res) => {
    try {
        const exchangeRate = await getCurrentExchangeRate();

        if (exchangeRate === null || exchangeRate === undefined) {
            return res.status(404).json({
                status: 'error',
                message: 'No exchange rate set for today. Please set today\'s exchange rate first.'
            });
        }

        res.json({ status: 'success', exchangeRate });
    } catch (error) {
        console.error("Error getting exchange rate:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

/**
 * Get exchange rate for a specific date
 * GET /api/getExchangeRateForDate?date={date}
 */
router.get("/getExchangeRateForDate", async (req, res) => {
    try {
        const { date } = req.query;

        if (!date) {
            return res.status(400).json({
                status: 'error',
                message: 'Date parameter is required'
            });
        }

        const exchangeRate = await getExchangeRateForDate(date);

        if (exchangeRate === null || exchangeRate === undefined) {
            return res.status(404).json({
                status: 'error',
                message: `No exchange rate set for ${date}`,
                date: date
            });
        }

        res.json({ status: 'success', exchangeRate, date });
    } catch (error) {
        console.error("Error getting exchange rate for date:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

/**
 * Update exchange rate for today
 * POST /api/updateExchangeRate
 * Body: { exchangeRate: number }
 */
router.post("/updateExchangeRate", async (req, res) => {
    try {
        const { exchangeRate } = req.body;

        if (!exchangeRate || exchangeRate <= 0) {
            return res.status(400).json({
                status: 'error',
                message: 'Valid exchange rate is required'
            });
        }

        const result = await updateExchangeRate(exchangeRate);
        res.json({ status: 'success', data: result });
    } catch (error) {
        console.error("Error updating exchange rate:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

/**
 * Update exchange rate for a specific date
 * POST /api/updateExchangeRateForDate
 * Body: { date: string, exchangeRate: number }
 */
router.post("/updateExchangeRateForDate", async (req, res) => {
    try {
        const { date, exchangeRate } = req.body;

        if (!date || !exchangeRate || exchangeRate <= 0) {
            return res.status(400).json({
                status: 'error',
                message: 'Valid date and exchange rate are required'
            });
        }

        const result = await updateExchangeRateForDate(date, exchangeRate);
        res.json({ status: 'success', data: result, date, exchangeRate });
    } catch (error) {
        console.error("Error updating exchange rate for date:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// ============================================================================
// INVOICE MANAGEMENT ROUTES
// ============================================================================

/**
 * Add new invoice with comprehensive validation
 * POST /api/addInvoice
 *
 * Body: {
 *   workid: number,
 *   amountPaid: number,
 *   paymentDate: string,
 *   usdReceived: number,
 *   iqdReceived: number,
 *   change: number
 * }
 *
 * Validation Rules:
 * 1. At least one currency amount (USD or IQD) must be > 0
 * 2. Currency amounts cannot be negative
 * 3. For same-currency payments: change is set to NULL (not tracked)
 * 4. For cross-currency payments: change is validated and saved
 * 5. Change cannot exceed IQD received (simple case)
 * 6. For USD payments: change validated against total IQD value at exchange rate
 */
router.post("/addInvoice", async (req, res) => {
    try {
        const { workid, amountPaid, paymentDate, usdReceived, iqdReceived, change } = req.body;

        if (!workid || !amountPaid || !paymentDate) {
            return res.status(400).json({
                status: 'error',
                message: 'Missing required parameters: workid, amountPaid, paymentDate'
            });
        }

        // Parse and validate amounts
        const usd = parseInt(usdReceived) || 0;
        const iqd = parseInt(iqdReceived) || 0;

        // Validation 1: Must receive cash in at least one currency
        if (usd === 0 && iqd === 0) {
            return res.status(400).json({
                status: 'error',
                message: 'At least one currency amount (USD or IQD) must be greater than zero',
                code: 'NO_CASH_RECEIVED'
            });
        }

        // Validation 2: Non-negative amounts
        if (usd < 0 || iqd < 0) {
            return res.status(400).json({
                status: 'error',
                message: 'Currency amounts cannot be negative',
                code: 'NEGATIVE_AMOUNT'
            });
        }

        // Get work details to determine account currency
        const workDetails = await getWorkDetails(workid);
        if (!workDetails) {
            return res.status(400).json({
                status: 'error',
                message: 'Work record not found',
                code: 'WORK_NOT_FOUND'
            });
        }

        const accountCurrency = workDetails.Currency;

        // Determine if this is a same-currency payment
        const isSameCurrencyPayment =
            (accountCurrency === 'USD' && usd > 0 && iqd === 0) ||
            (accountCurrency === 'IQD' && iqd > 0 && usd === 0);

        // For same-currency payments: Force change to NULL (cash handling not tracked)
        // For cross-currency payments: Validate and use provided change value
        let changeToSave = null;

        if (isSameCurrencyPayment) {
            // Same currency - no change tracking needed
            changeToSave = null;
        } else {
            // Cross-currency or mixed payment - validate change
            const changeAmount = parseInt(change) || 0;

            if (changeAmount < 0) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Change amount cannot be negative',
                    code: 'NEGATIVE_CHANGE'
                });
            }

            if (changeAmount > 0) {
                // Get exchange rate for validation
                const exchangeRate = await getExchangeRateForDate(paymentDate);

                // Validation 3: Change cannot exceed IQD received (simple case)
                if (usd === 0 && changeAmount > iqd) {
                    return res.status(400).json({
                        status: 'error',
                        message: `Change (${changeAmount} IQD) cannot exceed IQD received (${iqd} IQD)`,
                        code: 'CHANGE_EXCEEDS_IQD_RECEIVED'
                    });
                }

                // Validation 4: For USD payments, validate against total IQD value
                if (usd > 0 && exchangeRate) {
                    const totalIQDValue = iqd + Math.floor(usd * exchangeRate);

                    if (changeAmount > totalIQDValue) {
                        return res.status(400).json({
                            status: 'error',
                            message: `Change (${changeAmount} IQD) cannot exceed total IQD value in transaction (${totalIQDValue} IQD at rate ${exchangeRate})`,
                            code: 'CHANGE_EXCEEDS_TOTAL_VALUE',
                            details: {
                                usdReceived: usd,
                                iqdReceived: iqd,
                                exchangeRate: exchangeRate,
                                totalIQDValue: totalIQDValue,
                                changeRequested: changeAmount
                            }
                        });
                    }
                }
            }

            changeToSave = changeAmount;
        }

        // Save invoice with validated data
        const result = await addInvoice({
            workid,
            amountPaid,
            paymentDate,
            usdReceived: usd,
            iqdReceived: iqd,
            change: changeToSave  // NULL for same-currency, validated number for cross-currency
        });

        res.json({ status: 'success', data: result });
    } catch (error) {
        console.error("Error adding invoice:", error);

        // Handle database constraint violations gracefully
        if (error.message && error.message.includes('CHK_Invoice')) {
            return res.status(400).json({
                status: 'error',
                message: 'Payment validation failed: ' + error.message,
                code: 'DB_CONSTRAINT_VIOLATION'
            });
        }

        res.status(500).json({ status: 'error', message: error.message });
    }
});

/**
 * Delete invoice
 * DELETE /api/deleteInvoice/:invoiceId
 *
 * Protected: Secretary can only delete invoices created today
 * Admin can delete any invoice
 */
router.delete("/deleteInvoice/:invoiceId",
    authenticate,
    authorize(['admin', 'secretary']),
    requireRecordAge({
        resourceType: 'invoice',
        operation: 'delete',
        getRecordDate: getInvoiceCreationDate
    }),
    async (req, res) => {
        try {
            const { invoiceId } = req.params;

        if (!invoiceId) {
            return res.status(400).json({
                status: 'error',
                message: 'Invoice ID is required'
            });
        }

        const result = await database.executeQuery(
            'DELETE FROM dbo.tblInvoice WHERE InvoiceID = @InvoiceID',
            [['InvoiceID', database.TYPES.Int, parseInt(invoiceId)]]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'Invoice not found'
            });
        }

        res.json({
            status: 'success',
            message: 'Invoice deleted successfully',
            rowsAffected: result.rowCount
        });
        } catch (error) {
            console.error("Error deleting invoice:", error);
            res.status(500).json({ status: 'error', message: error.message });
        }
    }
);

// ============================================================================
// ALIGNER PAYMENT ROUTES
// ============================================================================

/**
 * Add payment for aligner set
 * POST /api/aligner/payments
 *
 * Body: {
 *   workid: number,
 *   AlignerSetID: number (optional),
 *   Amountpaid: number,
 *   Dateofpayment: string,
 *   ActualAmount: number (optional),
 *   ActualCur: string (optional),
 *   Change: number (optional)
 * }
 */
router.post('/aligner/payments', async (req, res) => {
    try {
        const { workid, AlignerSetID, Amountpaid, Dateofpayment, ActualAmount, ActualCur, Change } = req.body;

        if (!workid || !Amountpaid || !Dateofpayment) {
            return res.status(400).json({
                success: false,
                error: 'workid, Amountpaid, and Dateofpayment are required'
            });
        }

        console.log(`Adding payment for work ID: ${workid}, Set ID: ${AlignerSetID || 'general'}, Amount: ${Amountpaid}`);

        // Insert payment into tblInvoice
        const query = `
            INSERT INTO tblInvoice (workid, Amountpaid, Dateofpayment, ActualAmount, ActualCur, Change, AlignerSetID)
            VALUES (@workid, @Amountpaid, @Dateofpayment, @ActualAmount, @ActualCur, @Change, @AlignerSetID);
            SELECT SCOPE_IDENTITY() AS invoiceID;
        `;

        const result = await database.executeQuery(
            query,
            [
                ['workid', database.TYPES.Int, parseInt(workid)],
                ['Amountpaid', database.TYPES.Decimal, parseFloat(Amountpaid)],
                ['Dateofpayment', database.TYPES.Date, new Date(Dateofpayment)],
                ['ActualAmount', database.TYPES.Decimal, ActualAmount ? parseFloat(ActualAmount) : null],
                ['ActualCur', database.TYPES.NVarChar, ActualCur || null],
                ['Change', database.TYPES.Decimal, Change ? parseFloat(Change) : null],
                ['AlignerSetID', database.TYPES.Int, AlignerSetID || null]
            ],
            (columns) => ({
                invoiceID: columns[0].value
            })
        );

        const invoiceID = result && result.length > 0 ? result[0].invoiceID : null;

        res.json({
            success: true,
            invoiceID: invoiceID,
            message: 'Payment added successfully'
        });

    } catch (error) {
        console.error('Error adding payment:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to add payment',
            message: error.message
        });
    }
});

export default router;
