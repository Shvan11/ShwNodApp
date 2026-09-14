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
import {
  getCurrentExchangeRate,
  getPaymentHistoryByWorkId,
  getExchangeRateAsOf,
  updateExchangeRateForDate,
  listExchangeRates,
  getWorkForReceipt,
  deleteInvoiceById
} from '../../services/database/queries/payment-queries.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { CLINICAL_ROLES, FINANCE_ROLES } from '../../shared/auth/roles.js';
import {
  requireRecordAge,
  getInvoiceCreationDate
} from '../../middleware/time-based-auth.js';
import { ErrorResponses, sendData } from '../../utils/error-response.js';
import { validate } from '../../middleware/validate.js';
import {
  paymentHistory,
  workForReceipt,
  currentExchangeRate,
  exchangeRateForDate,
  exchangeRates,
  updateExchangeRate,
  addInvoice,
  deleteInvoice,
  paymentQuery,
  workIdParams,
  type UpdateExchangeRateBody,
  type AddInvoiceBody,
  type PaymentQueryParams,
  type WorkIdParams,
} from '../../shared/contracts/payment.contract.js';
import {
  validateAndCreateInvoice,
  PaymentValidationError
} from '../../services/business/PaymentService.js';
import { enqueueApproval, recordNotice, resolveApprovalPersonId } from '../../services/approvals/approval-service.js';

const router = Router();

// Request/response shapes (incl. the money rules' trust boundary) now live in
// shared/contracts/payment.contract.ts — imported above, shared with the client.
// The handlers/PaymentService still own the money rules (cross-currency change,
// ≥1 currency > 0, non-negative amounts, overpayment block).

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

// PaymentQueryParams is contracted in shared/contracts/payment.contract.ts, and the
// reads that `parseInt` a `workId` now validate it there rather than trusting the type.

// ============================================================================
// PAYMENT RETRIEVAL ROUTES
// ============================================================================

/**
 * Get payment history for a specific work
 * GET /api/getpaymenthistory?workId={workId}
 */
router.get(
  '/getpaymenthistory',
  // Deliberately CLINICAL_ROLES, not FINANCE_ROLES like the money WRITES below:
  // clinical staff see a work's payments/receipt read-only (WorkComponent hides
  // Add Payment for them but keeps history + printing). Written out so that
  // "every role may read this" is a decision rather than a missing line.
  authorize(CLINICAL_ROLES),
  validate({ query: paymentQuery }),
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
      const payments = await getPaymentHistoryByWorkId(parseInt(workId, 10));
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
  authorize(CLINICAL_ROLES), // read-only receipt view — see /getpaymenthistory above
  validate({ params: workIdParams }),
  async (
    req: Request<WorkIdParams>,
    res: Response
  ): Promise<void> => {
    try {
      const { workId } = req.params;
      if (!workId) {
        ErrorResponses.missingParameter(res, 'workId');
        return;
      }

      const work = await getWorkForReceipt(parseInt(workId, 10));

      if (!work) {
        ErrorResponses.notFound(res, 'Work');
        return;
      }

      sendData(res, workForReceipt.response, work);
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
      ErrorResponses.internalError(res, 'Failed to get the exchange rate', error as Error);
    }
  }
);

/**
 * Get the exchange rate IN FORCE on a specific date
 * GET /api/getExchangeRateForDate?date={date}
 *
 * Carries the last known rate forward when the date itself has none — nobody entering
 * today's rate yet is not a reason to refuse every payment (the rate didn't reset at
 * midnight). `rateDate` names the day the returned rate was recorded and
 * `isCarriedForward` flags the substitution so the UI can offer to set the real one.
 * 404 only when no rate has EVER been recorded.
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

      // Returns the exact-date rate when there is one (it sorts first), else the
      // most recent earlier rate — one round trip covers both.
      const rate = await getExchangeRateAsOf(date);

      if (!rate) {
        ErrorResponses.notFound(res, `Exchange rate for ${date}`, { date });
        return;
      }

      sendData(res, exchangeRateForDate.response, {
        exchangeRate: rate.exchangeRate,
        date,
        rateDate: rate.rateDate,
        isCarriedForward: rate.rateDate !== date,
      });
    } catch (error) {
      log.error('Error getting exchange rate for date:', error);
      ErrorResponses.internalError(res, 'Failed to get the exchange rate', error as Error);
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
      ErrorResponses.internalError(res, 'Failed to list exchange rates', error as Error);
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
  authenticate,
  authorize(FINANCE_ROLES),
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
      ErrorResponses.internalError(res, 'Failed to update the exchange rate', error as Error);
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
 * 3. For same-currency payments with no change: change is set to NULL (not tracked)
 * 4. Any change actually handed back is validated and saved, same- or cross-currency
 * 5. change cannot exceed IQD received (simple case)
 * 6. For USD payments: change validated against total IQD value at exchange rate
 */
router.post(
  '/addInvoice',
  authenticate,
  authorize(FINANCE_ROLES),
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

      ErrorResponses.internalError(res, 'Failed to record the payment', error as Error);
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
  authorize(FINANCE_ROLES),
  validate({ params: deleteInvoice.params }),
  requireRecordAge({
    resourceType: 'invoice',
    operation: 'delete',
    getRecordDate: getInvoiceCreationDate,
    enqueueIfRestricted: async (req, res) => {
      const { invoiceId } = req.params as { invoiceId: string };
      const { requestId } = await enqueueApproval(
        'invoice.delete',
        { invoiceId: parseInt(invoiceId, 10) },
        req
      );
      sendData(res, deleteInvoice.response, {
        outcome: 'pending',
        requestId,
        message: 'Submitted for admin approval',
      });
    },
  }),
  async (req: Request<{ invoiceId: string }>, res: Response): Promise<void> => {
    try {
      const { invoiceId } = req.params;

      if (!invoiceId) {
        ErrorResponses.missingParameter(res, 'invoiceId');
        return;
      }

      const invoiceIdNum = parseInt(invoiceId, 10);
      // Resolve the patient BEFORE deleting — the notice fires post-delete, when
      // the invoice→work→person link is already gone.
      const personId = await resolveApprovalPersonId('invoice.delete', invoiceIdNum);

      const rowsAffected = await deleteInvoiceById(invoiceIdNum);

      if (rowsAffected === 0) {
        ErrorResponses.notFound(res, 'Invoice');
        return;
      }

      // Notify tier: same-day admin-visible FYI; recordNotice no-ops for admin callers.
      await recordNotice('invoice.delete', { invoiceId: invoiceIdNum, person_id: personId }, req);
      sendData(res, deleteInvoice.response, { outcome: 'applied', rowsAffected }, 'Invoice deleted successfully');
    } catch (error) {
      log.error('Error deleting invoice:', error);
      ErrorResponses.internalError(res, 'Failed to delete the invoice', error as Error);
    }
  }
);

export default router;
