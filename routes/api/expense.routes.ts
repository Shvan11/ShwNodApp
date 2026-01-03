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
import {
  requireRecordAge,
  getExpenseCreationDate
} from '../../middleware/time-based-auth.js';
import { ErrorResponses } from '../../utils/error-response.js';
import { log } from '../../utils/logger.js';

const router = Router();

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface ExpenseQueryParams {
  startDate?: string;
  endDate?: string;
  categoryId?: string;
  subcategoryId?: string;
  currency?: string;
}

interface ExpenseFilters {
  startDate?: string;
  endDate?: string;
  categoryId?: number | null;
  subcategoryId?: number | null;
  currency?: string;
}

interface CreateExpenseBody {
  expenseDate: string;
  amount: number | string;
  currency?: string;
  note?: string;
  categoryId?: number | string;
  subcategoryId?: number | string;
}

interface ExpenseData {
  expenseDate: string;
  amount: number;
  currency: string;
  note?: string;
  categoryId?: number;
  subcategoryId?: number;
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
        currency: req.query.currency
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
      res.json(expenses);
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
      res.json(categories);
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
 * Get expense subcategories by category ID
 */
router.get(
  '/expenses/subcategories/:categoryId',
  async (
    req: Request<{ categoryId: string }>,
    res: Response
  ): Promise<void> => {
    try {
      const categoryId = parseInt(req.params.categoryId);
      const subcategories = await getExpenseSubcategories(categoryId);
      res.json(subcategories);
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
  async (
    req: Request<unknown, unknown, CreateExpenseBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { expenseDate, amount, currency, note, categoryId, subcategoryId } =
        req.body;

      // Validation
      if (!expenseDate || !amount) {
        log.warn('Expense creation validation failed', {
          expenseDate: expenseDate ?? 'missing',
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
        expenseDate,
        amount: parseInt(String(amount)),
        currency: currency || 'IQD',
        note,
        categoryId: categoryId ? parseInt(String(categoryId)) : undefined,
        subcategoryId: subcategoryId ? parseInt(String(subcategoryId)) : undefined
      };

      const result = await addExpense(expenseData);
      res.status(201).json({
        success: true,
        message: 'Expense created successfully',
        data: result
      });
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

      res.json({
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
 * Get a single expense by ID
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
        ErrorResponses.badRequest(res, 'Invalid expense ID. Must be a number.');
        return;
      }

      const expense = await getExpenseById(expenseId);

      if (!expense) {
        ErrorResponses.notFound(res, 'Expense');
        return;
      }

      res.json(expense);
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
  authorize(['admin', 'secretary']),
  requireRecordAge({
    resourceType: 'expense',
    operation: 'update',
    getRecordDate: getExpenseCreationDate
  }),
  async (
    req: Request<{ id: string }, unknown, CreateExpenseBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { id } = req.params;
      const { expenseDate, amount, currency, note, categoryId, subcategoryId } =
        req.body;

      // Validate that id is a valid number
      const expenseId = parseInt(id);
      if (isNaN(expenseId)) {
        ErrorResponses.badRequest(res, 'Invalid expense ID. Must be a number.');
        return;
      }

      // Validation
      if (!expenseDate || !amount) {
        log.warn('Expense update validation failed', {
          expenseId,
          expenseDate: expenseDate ?? 'missing',
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
        expenseDate,
        amount: parseInt(String(amount)),
        currency: currency || 'IQD',
        note,
        categoryId: categoryId ? parseInt(String(categoryId)) : undefined,
        subcategoryId: subcategoryId ? parseInt(String(subcategoryId)) : undefined
      };

      const result = await updateExpense(expenseId, expenseData);
      res.json({
        success: true,
        message: 'Expense updated successfully',
        data: result
      });
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
  authorize(['admin', 'secretary']),
  requireRecordAge({
    resourceType: 'expense',
    operation: 'delete',
    getRecordDate: getExpenseCreationDate
  }),
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      // Validate that id is a valid number
      const expenseId = parseInt(id);
      if (isNaN(expenseId)) {
        ErrorResponses.badRequest(res, 'Invalid expense ID. Must be a number.');
        return;
      }

      const result = await deleteExpense(expenseId);
      res.json({
        success: true,
        message: 'Expense deleted successfully',
        data: result
      });
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
