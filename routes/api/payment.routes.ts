/**
 * Payment & Invoice Routes
 *
 * Handles all payment-related operations including:
 * - Payment retrieval and history
 * - Invoice creation and deletion
 * - Exchange rate management
 * - currency conversion and validation
 * - Receipt generation
 *
 * This module includes comprehensive validation for:
 * - Cross-currency payments with change tracking
 * - Same-currency payments (no change tracking)
 * - Exchange rate validation and constraints
 */

import { Router, type Request, type Response } from 'express';
import { log } from '../../utils/logger.js';
import { sql } from 'kysely';
import { getKysely } from '../../services/database/kysely.js';
import {
  getActiveWorkForInvoice,
  getCurrentExchangeRate,
  getPaymentHistoryByWorkId,
  getExchangeRateForDate,
  updateExchangeRateForDate,
  listExchangeRates
} from '../../services/database/queries/payment-queries.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import {
  requireRecordAge,
  getInvoiceCreationDate
} from '../../middleware/time-based-auth.js';
import { ErrorResponses, sendData } from '../../utils/error-response.js';
import { validate } from '../../middleware/validate.js';
import {
  paymentHistory,
  workForReceipt,
  activeWorkForInvoice,
  currentExchangeRate,
  exchangeRateForDate,
  exchangeRates,
  updateExchangeRate,
  addInvoice,
  deleteInvoice,
  type UpdateExchangeRateBody,
  type AddInvoiceBody,
} from '../../shared/contracts/payment.contract.js';
import {
  validateAndCreateInvoice,
  PaymentValidationError
} from '../../services/business/PaymentService.js';

const router = Router();

// Request/response shapes (incl. the money rules' trust boundary) now live in
// shared/contracts/payment.contract.ts — imported above, shared with the client.
// The handlers/PaymentService still own the money rules (cross-currency change,
// ≥1 currency > 0, non-negative amounts, overpayment block).

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface PaymentQueryParams {
  code?: string;
  workId?: string;
  date?: string;
  PID?: string;
}

// `type` (not `interface`) so it carries an implicit string index signature and
// is assignable to the `z.looseObject` workForReceipt response contract that
// `sendData` validates against (see shared-contract-progress.md, Phase 1 finding).
type WorkForReceiptResult = {
  person_id: number;
  patient_name: string;
  phone: string | null;
  TotalPaid: number;
  app_date: Date;
  work_id: number;
  total_required: number;
  currency: string;
  discount: number | null;
  discount_date: Date | null;
};

// ============================================================================
// PAYMENT RETRIEVAL ROUTES
// ============================================================================

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
      sendData(res, paymentHistory.response, payments);
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

      // V_Report (and its sub-views VTotPaid / VLastApp) inlined for a single work:
      //  - TotalPaid: SUM(tblInvoice.amount_paid) for the work (NULL when no payments, as VTotPaid yielded)
      //  - app_date:   the patient's latest FUTURE appointment (VLastApp: per-person MAX(app_date) > now)
      const { rows: result } = await sql<WorkForReceiptResult>`
        SELECT
          w."person_id",
          p."patient_name",
          p."phone",
          tp."TotalPaid",
          la."app_date",
          w."work_id",
          w."total_required",
          w."currency",
          w."discount",
          w."discount_date"
        FROM "works" w
        JOIN "patients" p ON p."person_id" = w."person_id"
        LEFT JOIN (
          SELECT "work_id", SUM("amount_paid") AS "TotalPaid"
          FROM "invoices" GROUP BY "work_id"
        ) tp ON tp."work_id" = w."work_id"
        LEFT JOIN (
          SELECT "person_id", MAX("app_date") AS "app_date"
          FROM "appointments" WHERE "app_date" > LOCALTIMESTAMP GROUP BY "person_id"
        ) la ON la."person_id" = w."person_id"
        WHERE w."work_id" = ${parseInt(workId)}
      `.execute(getKysely());

      if (!result || result.length === 0) {
        ErrorResponses.notFound(res, 'Work');
        return;
      }

      sendData(res, workForReceipt.response, result[0]);
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
      sendData(res, activeWorkForInvoice.response, workData);
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

      sendData(res, currentExchangeRate.response, { exchangeRate });
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

      sendData(res, exchangeRateForDate.response, { exchangeRate, date });
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
 * List exchange rates within a date range (newest first)
 * GET /api/exchange-rates?from=YYYY-MM-DD&to=YYYY-MM-DD
 */
router.get(
  '/exchange-rates',
  async (
    req: Request<unknown, unknown, unknown, { from?: string; to?: string }>,
    res: Response
  ): Promise<void> => {
    try {
      const { from, to } = req.query;

      if (!from || !to) {
        ErrorResponses.missingParameter(res, 'from/to');
        return;
      }

      const rates = await listExchangeRates(from, to);
      sendData(res, exchangeRates.response, { rates });
    } catch (error) {
      log.error('Error listing exchange rates:', error);
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
  validate({ body: updateExchangeRate.body }),
  async (
    req: Request<unknown, unknown, UpdateExchangeRateBody>,
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
      sendData(res, updateExchangeRate.response, { result, date, exchangeRate });
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
 * 2. currency amounts cannot be negative
 * 3. For same-currency payments: change is set to NULL (not tracked)
 * 4. For cross-currency payments: change is validated and saved
 * 5. change cannot exceed IQD received (simple case)
 * 6. For USD payments: change validated against total IQD value at exchange rate
 */
router.post(
  '/addInvoice',
  validate({ body: addInvoice.body }),
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

      sendData(res, addInvoice.response, result);
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
  validate({ params: deleteInvoice.params }),
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

      const result = await sql`
        DELETE FROM "invoices" WHERE "invoice_id" = ${parseInt(invoiceId)}
      `.execute(getKysely());
      const rowsAffected = Number(result.numAffectedRows ?? 0n);

      if (rowsAffected === 0) {
        ErrorResponses.notFound(res, 'Invoice');
        return;
      }

      sendData(res, deleteInvoice.response, { rowsAffected }, 'Invoice deleted successfully');
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
