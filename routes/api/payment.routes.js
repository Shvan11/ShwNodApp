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
import { sendError, ErrorResponses } from '../../utils/error-response.js';

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
            return ErrorResponses.missingParameter(res, 'workId');
        }
        const payments = await getPaymentHistoryByWorkId(parseInt(workId));
        res.json(payments);
    } catch (error) {
        console.error('Error fetching payment history:', error);
        return ErrorResponses.internalError(res, 'Failed to fetch payment history', error);
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
            return ErrorResponses.missingParameter(res, 'workId');
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
            return ErrorResponses.notFound(res, 'Work');
        }

        res.json(result[0]);
    } catch (error) {
        console.error("Error fetching work for receipt:", error);
        return ErrorResponses.internalError(res, 'Failed to fetch work data', error);
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
            return ErrorResponses.missingParameter(res, 'PID');
        }

        const workData = await getActiveWorkForInvoice(PID);
        res.json({ status: 'success', data: workData });
    } catch (error) {
        console.error("Error getting active work for invoice:", error);
        return ErrorResponses.internalError(res, error.message, error);
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
            return ErrorResponses.notFound(res, 'Exchange rate for today', 'Please set today\'s exchange rate first.');
        }

        res.json({ status: 'success', exchangeRate });
    } catch (error) {
        console.error("Error getting exchange rate:", error);
        return ErrorResponses.internalError(res, error.message, error);
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
            return ErrorResponses.missingParameter(res, 'date');
        }

        const exchangeRate = await getExchangeRateForDate(date);

        if (exchangeRate === null || exchangeRate === undefined) {
            return ErrorResponses.notFound(res, `Exchange rate for ${date}`, { date: date });
        }

        res.json({ status: 'success', exchangeRate, date });
    } catch (error) {
        console.error("Error getting exchange rate for date:", error);
        return ErrorResponses.internalError(res, error.message, error);
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
            return ErrorResponses.badRequest(res, 'Valid exchange rate is required');
        }

        const result = await updateExchangeRate(exchangeRate);
        res.json({ status: 'success', data: result });
    } catch (error) {
        console.error("Error updating exchange rate:", error);
        return ErrorResponses.internalError(res, error.message, error);
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
            return ErrorResponses.badRequest(res, 'Valid date and exchange rate are required');
        }

        const result = await updateExchangeRateForDate(date, exchangeRate);
        res.json({ status: 'success', data: result, date, exchangeRate });
    } catch (error) {
        console.error("Error updating exchange rate for date:", error);
        return ErrorResponses.internalError(res, error.message, error);
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
            return ErrorResponses.badRequest(res, 'Missing required parameters: workid, amountPaid, paymentDate');
        }

        // Parse and validate amounts
        const usd = parseInt(usdReceived) || 0;
        const iqd = parseInt(iqdReceived) || 0;

        // Validation 1: Must receive cash in at least one currency
        if (usd === 0 && iqd === 0) {
            return ErrorResponses.badRequest(res, 'At least one currency amount (USD or IQD) must be greater than zero', { code: 'NO_CASH_RECEIVED' });
        }

        // Validation 2: Non-negative amounts
        if (usd < 0 || iqd < 0) {
            return ErrorResponses.badRequest(res, 'Currency amounts cannot be negative', { code: 'NEGATIVE_AMOUNT' });
        }

        // Get work details to determine account currency
        const workDetails = await getWorkDetails(workid);
        if (!workDetails) {
            return ErrorResponses.badRequest(res, 'Work record not found', { code: 'WORK_NOT_FOUND' });
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
                return ErrorResponses.badRequest(res, 'Change amount cannot be negative', { code: 'NEGATIVE_CHANGE' });
            }

            if (changeAmount > 0) {
                // Get exchange rate for validation
                const exchangeRate = await getExchangeRateForDate(paymentDate);

                // Validation 3: Change cannot exceed IQD received (simple case)
                if (usd === 0 && changeAmount > iqd) {
                    return ErrorResponses.badRequest(res, `Change (${changeAmount} IQD) cannot exceed IQD received (${iqd} IQD)`, { code: 'CHANGE_EXCEEDS_IQD_RECEIVED' });
                }

                // Validation 4: For USD payments, validate against total IQD value
                if (usd > 0 && exchangeRate) {
                    const totalIQDValue = iqd + Math.floor(usd * exchangeRate);

                    if (changeAmount > totalIQDValue) {
                        return ErrorResponses.badRequest(res, `Change (${changeAmount} IQD) cannot exceed total IQD value in transaction (${totalIQDValue} IQD at rate ${exchangeRate})`, {
                            code: 'CHANGE_EXCEEDS_TOTAL_VALUE',
                            usdReceived: usd,
                            iqdReceived: iqd,
                            exchangeRate: exchangeRate,
                            totalIQDValue: totalIQDValue,
                            changeRequested: changeAmount
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
            return ErrorResponses.badRequest(res, 'Payment validation failed: ' + error.message, { code: 'DB_CONSTRAINT_VIOLATION' });
        }

        return ErrorResponses.internalError(res, error.message, error);
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
            return ErrorResponses.missingParameter(res, 'invoiceId');
        }

        const result = await database.executeQuery(
            'DELETE FROM dbo.tblInvoice WHERE InvoiceID = @InvoiceID',
            [['InvoiceID', database.TYPES.Int, parseInt(invoiceId)]]
        );

        if (result.rowCount === 0) {
            return ErrorResponses.notFound(res, 'Invoice');
        }

        res.json({
            status: 'success',
            message: 'Invoice deleted successfully',
            rowsAffected: result.rowCount
        });
        } catch (error) {
            console.error("Error deleting invoice:", error);
            return ErrorResponses.internalError(res, error.message, error);
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
            return ErrorResponses.badRequest(res, 'workid, Amountpaid, and Dateofpayment are required');
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
        return ErrorResponses.internalError(res, 'Failed to add payment', error);
    }
});

export default router;
