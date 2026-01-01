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

import { Router, type Request, type Response } from 'express';
import { log } from '../../utils/logger.js';
import * as database from '../../services/database/index.js';
import {
  getPayments,
  getActiveWorkForInvoice,
  getCurrentExchangeRate,
  updateExchangeRate,
  getPaymentHistoryByWorkId,
  getExchangeRateForDate,
  updateExchangeRateForDate
} from '../../services/database/queries/payment-queries.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import {
  requireRecordAge,
  getInvoiceCreationDate
} from '../../middleware/time-based-auth.js';
import { ErrorResponses } from '../../utils/error-response.js';
import {
  validateAndCreateInvoice,
  PaymentValidationError
} from '../../services/business/PaymentService.js';

const router = Router();

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface PaymentQueryParams {
  code?: string;
  workId?: string;
  date?: string;
  PID?: string;
}

interface WorkForReceiptResult {
  PersonID: number;
  PatientName: string;
  Phone: string | null;
  TotalPaid: number;
  AppDate: Date;
  workid: number;
  TotalRequired: number;
  Currency: string;
}

interface ExchangeRateBody {
  exchangeRate: number;
}

interface ExchangeRateForDateBody {
  date: string;
  exchangeRate: number;
}

interface AddInvoiceBody {
  workid: number;
  amountPaid: number;
  paymentDate: string;
  usdReceived?: number;
  iqdReceived?: number;
  change?: number;
}

// ============================================================================
// PAYMENT RETRIEVAL ROUTES
// ============================================================================

/**
 * Get all payments for a patient
 * GET /api/getpayments?code={patientId}
 */
router.get(
  '/getpayments',
  async (
    req: Request<unknown, unknown, unknown, PaymentQueryParams>,
    res: Response
  ): Promise<void> => {
    const { code: pid } = req.query;
    const payments = await getPayments(parseInt(pid as string, 10));
    res.json(payments);
  }
);

/**
 * Get payment history for a specific work
 * GET /api/getpaymenthistory?workId={workId}
 */
router.get(
  '/getpaymenthistory',
  async (
    req: Request<unknown, unknown, unknown, PaymentQueryParams>,
    res: Response
  ): Promise<void> => {
    try {
      const { workId } = req.query;
      if (!workId) {
        ErrorResponses.missingParameter(res, 'workId');
        return;
      }
      const payments = await getPaymentHistoryByWorkId(parseInt(workId));
      res.json(payments);
    } catch (error) {
      log.error('Error fetching payment history:', error);
      ErrorResponses.internalError(
        res,
        'Failed to fetch payment history',
        error as Error
      );
    }
  }
);

/**
 * Get work data for receipt generation
 * GET /api/getworkforreceipt/:workId
 */
router.get(
  '/getworkforreceipt/:workId',
  async (
    req: Request<{ workId: string }>,
    res: Response
  ): Promise<void> => {
    try {
      const { workId } = req.params;
      if (!workId) {
        ErrorResponses.missingParameter(res, 'workId');
        return;
      }

      const result = await database.executeQuery<WorkForReceiptResult>(
        'SELECT PersonID, PatientName, Phone, TotalPaid, AppDate, workid, TotalRequired, Currency FROM dbo.V_Report WHERE workid = @WorkID',
        [['WorkID', database.TYPES.Int, parseInt(workId)]],
        (columns) => ({
          PersonID: columns[0].value as number,
          PatientName: columns[1].value as string,
          Phone: columns[2].value as string | null,
          TotalPaid: columns[3].value as number,
          AppDate: columns[4].value as Date,
          workid: columns[5].value as number,
          TotalRequired: columns[6].value as number,
          Currency: columns[7].value as string
        })
      );

      if (!result || result.length === 0) {
        ErrorResponses.notFound(res, 'Work');
        return;
      }

      res.json(result[0]);
    } catch (error) {
      log.error('Error fetching work for receipt:', error);
      ErrorResponses.internalError(
        res,
        'Failed to fetch work data',
        error as Error
      );
    }
  }
);

/**
 * Get active work items for invoice creation
 * GET /api/getActiveWorkForInvoice?PID={patientId}
 */
router.get(
  '/getActiveWorkForInvoice',
  async (
    req: Request<unknown, unknown, unknown, PaymentQueryParams>,
    res: Response
  ): Promise<void> => {
    try {
      const { PID } = req.query;
      if (!PID) {
        ErrorResponses.missingParameter(res, 'PID');
        return;
      }

      const workData = await getActiveWorkForInvoice(parseInt(PID, 10));
      res.json({ status: 'success', data: workData });
    } catch (error) {
      log.error('Error getting active work for invoice:', error);
      ErrorResponses.internalError(
        res,
        (error as Error).message,
        error as Error
      );
    }
  }
);

// ============================================================================
// EXCHANGE RATE ROUTES
// ============================================================================

/**
 * Get current exchange rate for today
 * GET /api/getCurrentExchangeRate
 */
router.get(
  '/getCurrentExchangeRate',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const exchangeRate = await getCurrentExchangeRate();

      if (exchangeRate === null || exchangeRate === undefined) {
        ErrorResponses.notFound(
          res,
          'Exchange rate for today',
          { message: "Please set today's exchange rate first." }
        );
        return;
      }

      res.json({ status: 'success', exchangeRate });
    } catch (error) {
      log.error('Error getting exchange rate:', error);
      ErrorResponses.internalError(
        res,
        (error as Error).message,
        error as Error
      );
    }
  }
);

/**
 * Get exchange rate for a specific date
 * GET /api/getExchangeRateForDate?date={date}
 */
router.get(
  '/getExchangeRateForDate',
  async (
    req: Request<unknown, unknown, unknown, PaymentQueryParams>,
    res: Response
  ): Promise<void> => {
    try {
      const { date } = req.query;

      if (!date) {
        ErrorResponses.missingParameter(res, 'date');
        return;
      }

      const exchangeRate = await getExchangeRateForDate(date);

      if (exchangeRate === null || exchangeRate === undefined) {
        ErrorResponses.notFound(res, `Exchange rate for ${date}`, { date });
        return;
      }

      res.json({ status: 'success', exchangeRate, date });
    } catch (error) {
      log.error('Error getting exchange rate for date:', error);
      ErrorResponses.internalError(
        res,
        (error as Error).message,
        error as Error
      );
    }
  }
);

/**
 * Update exchange rate for today
 * POST /api/updateExchangeRate
 * Body: { exchangeRate: number }
 */
router.post(
  '/updateExchangeRate',
  async (
    req: Request<unknown, unknown, ExchangeRateBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { exchangeRate } = req.body;

      if (!exchangeRate || exchangeRate <= 0) {
        ErrorResponses.badRequest(res, 'Valid exchange rate is required');
        return;
      }

      const result = await updateExchangeRate(exchangeRate);
      res.json({ status: 'success', data: result });
    } catch (error) {
      log.error('Error updating exchange rate:', error);
      ErrorResponses.internalError(
        res,
        (error as Error).message,
        error as Error
      );
    }
  }
);

/**
 * Update exchange rate for a specific date
 * POST /api/updateExchangeRateForDate
 * Body: { date: string, exchangeRate: number }
 */
router.post(
  '/updateExchangeRateForDate',
  async (
    req: Request<unknown, unknown, ExchangeRateForDateBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { date, exchangeRate } = req.body;

      if (!date || !exchangeRate || exchangeRate <= 0) {
        ErrorResponses.badRequest(
          res,
          'Valid date and exchange rate are required'
        );
        return;
      }

      const result = await updateExchangeRateForDate(date, exchangeRate);
      res.json({ status: 'success', data: result, date, exchangeRate });
    } catch (error) {
      log.error('Error updating exchange rate for date:', error);
      ErrorResponses.internalError(
        res,
        (error as Error).message,
        error as Error
      );
    }
  }
);

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
router.post(
  '/addInvoice',
  async (
    req: Request<unknown, unknown, AddInvoiceBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { workid, amountPaid, paymentDate, usdReceived, iqdReceived, change } =
        req.body;

      if (!workid || !amountPaid || !paymentDate) {
        ErrorResponses.badRequest(
          res,
          'Missing required parameters: workid, amountPaid, paymentDate'
        );
        return;
      }

      // Delegate to service layer for validation and creation
      const result = await validateAndCreateInvoice({
        workid,
        amountPaid,
        paymentDate,
        usdReceived: usdReceived ?? 0,
        iqdReceived: iqdReceived ?? 0,
        change: change ?? 0
      });

      res.json({ status: 'success', data: result });
    } catch (error) {
      log.error('Error adding invoice:', error);

      // Handle validation errors from service layer
      if (error instanceof PaymentValidationError) {
        ErrorResponses.badRequest(res, error.message, {
          code: error.code,
          ...error.details
        });
        return;
      }

      // Handle database constraint violations gracefully
      const err = error as Error;
      if (err.message && err.message.includes('CHK_Invoice')) {
        ErrorResponses.badRequest(
          res,
          'Payment validation failed: ' + err.message,
          { code: 'DB_CONSTRAINT_VIOLATION' }
        );
        return;
      }

      ErrorResponses.internalError(res, err.message, error as Error);
    }
  }
);

/**
 * Delete invoice
 * DELETE /api/deleteInvoice/:invoiceId
 *
 * Protected: Secretary can only delete invoices created today
 * Admin can delete any invoice
 */
router.delete(
  '/deleteInvoice/:invoiceId',
  authenticate,
  authorize(['admin', 'secretary']),
  requireRecordAge({
    resourceType: 'invoice',
    operation: 'delete',
    getRecordDate: getInvoiceCreationDate
  }),
  async (req: Request<{ invoiceId: string }>, res: Response): Promise<void> => {
    try {
      const { invoiceId } = req.params;

      if (!invoiceId) {
        ErrorResponses.missingParameter(res, 'invoiceId');
        return;
      }

      const result = await database.executeQuery(
        'DELETE FROM dbo.tblInvoice WHERE InvoiceID = @InvoiceID',
        [['InvoiceID', database.TYPES.Int, parseInt(invoiceId)]]
      );

      if (
        (result as { rowCount?: number }).rowCount === 0
      ) {
        ErrorResponses.notFound(res, 'Invoice');
        return;
      }

      res.json({
        status: 'success',
        message: 'Invoice deleted successfully',
        rowsAffected: (result as { rowCount?: number }).rowCount
      });
    } catch (error) {
      log.error('Error deleting invoice:', error);
      ErrorResponses.internalError(
        res,
        (error as Error).message,
        error as Error
      );
    }
  }
);

export default router;
