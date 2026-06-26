/**
 * Expense Routes
 *
 * This module handles all expense-related API endpoints including:
 * - Fetching expenses with filters (date range, category, subcategory, currency)
 * - Managing expense categories and subcategories
 * - Creating, reading, updating, and deleting individual expenses
 * - Generating expense summaries and totals by currency
 *
 * Protected routes (PUT, DELETE) include role-based and time-based authorization:
 * - Admin: Full access to all operations
 * - Secretary: Can only edit/delete expenses created today
 */

import { Router, type Request, type Response } from 'express';
import {
  getAllExpenses,
  getExpenseById,
  getExpenseCategories,
  getExpenseSubcategories,
  addExpense,
  updateExpense,
  deleteExpense,
  getExpenseSummary,
  getExpenseTotalsByCurrency
} from '../../services/database/queries/expense-queries.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { FINANCE_ROLES } from '../../shared/auth/roles.js';
import {
  requireRecordAge,
  getExpenseCreationDate
} from '../../middleware/time-based-auth.js';
import { ErrorResponses, sendData } from '../../utils/error-response.js';
import { validate } from '../../middleware/validate.js';
import * as expense from '../../shared/contracts/expense.contract.js';
import { log } from '../../utils/logger.js';
import { enqueueApproval, recordNotice } from '../../services/approvals/approval-service.js';

const router = Router();

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

type ExpenseQueryParams = {
  startDate?: string;
  endDate?: string;
  categoryId?: string;
  subcategoryId?: string;
  currency?: string;
  isMonthly?: string;
  limit?: string;
  offset?: string;
};

// Internal parsed-filter shape (NOT a request body) + the raw req.query view. The
// validated query boundary is `expense.expenseList.query` (wired on the list route).
type ExpenseFilters = {
  startDate?: string;
  endDate?: string;
  categoryId?: number | null;
  subcategoryId?: number | null;
  currency?: string;
  isMonthly?: boolean;
  limit?: number | null;
  offset?: number | null;
};

interface ExpenseData {
  expense_date: string;
  amount: number;
  currency: string;
  note?: string;
  categoryId?: number;
  subcategoryId?: number;
  isMonthly?: boolean;
}

// ============================================================================
// EXPENSE ROUTES
// ============================================================================

/**
 * Get all expenses with optional filters
 * Query params: startDate, endDate, categoryId, subcategoryId, currency
 */
router.get(
  '/expenses',
  validate({ query: expense.expenseList.query }),
  async (
    req: Request<unknown, unknown, unknown, ExpenseQueryParams>,
    res: Response
  ): Promise<void> => {
    try {
      const filters: ExpenseFilters = {
        startDate: req.query.startDate,
        endDate: req.query.endDate,
        categoryId: req.query.categoryId
          ? parseInt(req.query.categoryId)
          : null,
        subcategoryId: req.query.subcategoryId
          ? parseInt(req.query.subcategoryId)
          : null,
        currency: req.query.currency,
        isMonthly: req.query.isMonthly === 'true'
          ? true
          : req.query.isMonthly === 'false'
            ? false
            : undefined,
        limit: req.query.limit ? parseInt(req.query.limit) : null,
        offset: req.query.offset ? parseInt(req.query.offset) : null,
      };

      // Remove null/undefined filters
      const cleanFilters: Record<string, unknown> = {};
      Object.keys(filters).forEach((key) => {
        const value = filters[key as keyof ExpenseFilters];
        if (value !== null && value !== undefined) {
          cleanFilters[key] = value;
        }
      });

      const expenses = await getAllExpenses(cleanFilters);
      sendData(res, expense.expenseList.response, expenses);
    } catch (error) {
      log.error('Error fetching expenses:', error);
      ErrorResponses.internalError(
        res,
        'Failed to fetch expenses',
        error as Error
      );
    }
  }
);

/**
 * Get all expense categories
 */
router.get(
  '/expenses/categories',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const categories = await getExpenseCategories();
      sendData(res, expense.expenseCategories.response, categories);
    } catch (error) {
      log.error('Error fetching expense categories:', error);
      ErrorResponses.internalError(
        res,
        'Failed to fetch expense categories',
        error as Error
      );
    }
  }
);

/**
 * Get expense subcategories by category id
 */
router.get(
  '/expenses/subcategories/:categoryId',
  async (
    req: Request<{ categoryId: string }>,
    res: Response
  ): Promise<void> => {
    try {
      const categoryId = parseInt(req.params.categoryId, 10);
      if (!Number.isInteger(categoryId) || categoryId <= 0) {
        ErrorResponses.badRequest(res, 'Invalid category ID');
        return;
      }
      const subcategories = await getExpenseSubcategories(categoryId);
      sendData(res, expense.expenseSubcategories.response, subcategories);
    } catch (error) {
      log.error('Error fetching expense subcategories:', error);
      ErrorResponses.internalError(
        res,
        'Failed to fetch expense subcategories',
        error as Error
      );
    }
  }
);

/**
 * Create a new expense
 */
router.post(
  '/expenses',
  authenticate,
  authorize(FINANCE_ROLES),
  validate({ body: expense.createExpense.body }),
  async (
    req: Request<unknown, unknown, expense.CreateExpenseBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { expense_date, amount, currency, note, categoryId, subcategoryId, isMonthly } =
        req.body;

      // Validation
      if (!expense_date || !amount) {
        log.warn('Expense creation validation failed', {
          expense_date: expense_date ?? 'missing',
          amount: amount ?? 'missing',
          receivedFields: Object.keys(req.body)
        });
        ErrorResponses.badRequest(
          res,
          'Missing required fields: expenseDate, amount'
        );
        return;
      }

      const expenseData: ExpenseData = {
        expense_date,
        amount: parseInt(String(amount)),
        currency: currency || 'IQD',
        note,
        categoryId: categoryId ? parseInt(String(categoryId)) : undefined,
        subcategoryId: subcategoryId ? parseInt(String(subcategoryId)) : undefined,
        isMonthly: isMonthly ?? false,
      };

      const result = await addExpense(expenseData);
      sendData(res, expense.createExpense.response, result, 'Expense created successfully', 201);
    } catch (error) {
      log.error('Error creating expense:', error);
      ErrorResponses.internalError(
        res,
        'Failed to create expense',
        error as Error
      );
    }
  }
);

/**
 * Get expense summary by category and currency
 * Query params: startDate, endDate (required)
 */
router.get(
  '/expenses/summary',
  async (
    req: Request<unknown, unknown, unknown, ExpenseQueryParams>,
    res: Response
  ): Promise<void> => {
    try {
      const { startDate, endDate } = req.query;

      if (!startDate || !endDate) {
        ErrorResponses.badRequest(
          res,
          'Missing required parameters: startDate, endDate'
        );
        return;
      }

      const summary = await getExpenseSummary(startDate, endDate);
      const totals = await getExpenseTotalsByCurrency(startDate, endDate);

      sendData(res, expense.expenseSummary.response, {
        summary,
        totals
      });
    } catch (error) {
      log.error('Error fetching expense summary:', error);
      ErrorResponses.internalError(
        res,
        'Failed to fetch expense summary',
        error as Error
      );
    }
  }
);

/**
 * Get a single expense by id
 * NOTE: This route MUST come after all specific /expenses/* routes
 * to avoid matching paths like /expenses/categories or /expenses/summary
 */
router.get(
  '/expenses/:id',
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      // Validate that id is a valid number
      const expenseId = parseInt(id);
      if (isNaN(expenseId)) {
        ErrorResponses.badRequest(res, 'Invalid expense id. Must be a number.');
        return;
      }

      // `expenseRow` (not `expense`) to avoid shadowing the contract import.
      const expenseRow = await getExpenseById(expenseId);

      if (!expenseRow) {
        ErrorResponses.notFound(res, 'Expense');
        return;
      }

      sendData(res, expense.expenseById.response, expenseRow);
    } catch (error) {
      log.error('Error fetching expense:', error);
      ErrorResponses.internalError(
        res,
        'Failed to fetch expense',
        error as Error
      );
    }
  }
);

/**
 * Update an existing expense - Protected: Secretary can only edit expenses created today
 * NOTE: This route MUST come after all specific /expenses/* routes
 */
router.put(
  '/expenses/:id',
  authenticate,
  authorize(FINANCE_ROLES),
  validate({ params: expense.updateExpense.params, body: expense.updateExpense.body }),
  requireRecordAge({
    resourceType: 'expense',
    operation: 'update',
    getRecordDate: getExpenseCreationDate,
    enqueueIfRestricted: async (req, res) => {
      const id = parseInt((req.params as { id: string }).id);
      const { requestId } = await enqueueApproval(
        'expense.update',
        { id, ...req.body as Record<string, unknown> },
        req
      );
      sendData(res, expense.updateExpense.response, {
        outcome: 'pending',
        requestId,
        message: 'Submitted for admin approval',
      });
    },
  }),
  async (
    req: Request<{ id: string }, unknown, expense.CreateExpenseBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { id } = req.params;
      const { expense_date, amount, currency, note, categoryId, subcategoryId, isMonthly } =
        req.body;

      // Validate that id is a valid number
      const expenseId = parseInt(id);
      if (isNaN(expenseId)) {
        ErrorResponses.badRequest(res, 'Invalid expense id. Must be a number.');
        return;
      }

      // Validation
      if (!expense_date || !amount) {
        log.warn('Expense update validation failed', {
          expenseId,
          expense_date: expense_date ?? 'missing',
          amount: amount ?? 'missing',
          receivedFields: Object.keys(req.body)
        });
        ErrorResponses.badRequest(
          res,
          'Missing required fields: expenseDate, amount'
        );
        return;
      }

      const expenseData: ExpenseData = {
        expense_date,
        amount: parseInt(String(amount)),
        currency: currency || 'IQD',
        note,
        categoryId: categoryId ? parseInt(String(categoryId)) : undefined,
        subcategoryId: subcategoryId ? parseInt(String(subcategoryId)) : undefined,
        isMonthly: isMonthly ?? false,
      };

      const result = await updateExpense(expenseId, expenseData);
      // Notify tier: same-day admin-visible FYI; recordNotice no-ops for admin callers.
      await recordNotice('expense.update', { id: expenseId, ...req.body as Record<string, unknown> }, req);
      sendData(res, expense.updateExpense.response, { outcome: 'applied', ...result }, 'Expense updated successfully');
    } catch (error) {
      log.error('Error updating expense:', error);
      ErrorResponses.internalError(
        res,
        'Failed to update expense',
        error as Error
      );
    }
  }
);

/**
 * Delete an expense - Protected: Secretary can only delete expenses created today
 * NOTE: This route MUST come after all specific /expenses/* routes
 */
router.delete(
  '/expenses/:id',
  authenticate,
  authorize(FINANCE_ROLES),
  validate({ params: expense.deleteExpense.params }),
  requireRecordAge({
    resourceType: 'expense',
    operation: 'delete',
    getRecordDate: getExpenseCreationDate,
    enqueueIfRestricted: async (req, res) => {
      const id = parseInt((req.params as { id: string }).id);
      const { requestId } = await enqueueApproval('expense.delete', { id }, req);
      sendData(res, expense.deleteExpense.response, {
        outcome: 'pending',
        requestId,
        message: 'Submitted for admin approval',
      });
    },
  }),
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      // Validate that id is a valid number
      const expenseId = parseInt(id);
      if (isNaN(expenseId)) {
        ErrorResponses.badRequest(res, 'Invalid expense id. Must be a number.');
        return;
      }

      const result = await deleteExpense(expenseId);
      // Notify tier: same-day admin-visible FYI; recordNotice no-ops for admin callers.
      await recordNotice('expense.delete', { id: expenseId }, req);
      sendData(res, expense.deleteExpense.response, { outcome: 'applied', ...result }, 'Expense deleted successfully');
    } catch (error) {
      log.error('Error deleting expense:', error);
      ErrorResponses.internalError(
        res,
        'Failed to delete expense',
        error as Error
      );
    }
  }
);

export default router;
