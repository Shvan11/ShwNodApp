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

import express from 'express';
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
import { requireRecordAge, getExpenseCreationDate } from '../../middleware/time-based-auth.js';

const router = express.Router();

/**
 * Get all expenses with optional filters
 * Query params: startDate, endDate, categoryId, subcategoryId, currency
 */
router.get('/expenses', async (req, res) => {
    try {
        const filters = {
            startDate: req.query.startDate,
            endDate: req.query.endDate,
            categoryId: req.query.categoryId ? parseInt(req.query.categoryId) : null,
            subcategoryId: req.query.subcategoryId ? parseInt(req.query.subcategoryId) : null,
            currency: req.query.currency
        };

        // Remove null/undefined filters
        Object.keys(filters).forEach(key => {
            if (filters[key] === null || filters[key] === undefined) {
                delete filters[key];
            }
        });

        const expenses = await getAllExpenses(filters);
        res.json(expenses);
    } catch (error) {
        console.error('Error fetching expenses:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch expenses',
            message: error.message
        });
    }
});

/**
 * Get all expense categories
 */
router.get('/expenses/categories', async (req, res) => {
    try {
        const categories = await getExpenseCategories();
        res.json(categories);
    } catch (error) {
        console.error('Error fetching expense categories:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch expense categories',
            message: error.message
        });
    }
});

// Legacy route - kept for backwards compatibility
router.get('/expenses-categories', async (req, res) => {
    try {
        const categories = await getExpenseCategories();
        res.json(categories);
    } catch (error) {
        console.error('Error fetching expense categories:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch expense categories',
            message: error.message
        });
    }
});

/**
 * Get expense subcategories by category ID
 */
router.get('/expenses/subcategories/:categoryId', async (req, res) => {
    try {
        const categoryId = parseInt(req.params.categoryId);
        const subcategories = await getExpenseSubcategories(categoryId);
        res.json(subcategories);
    } catch (error) {
        console.error('Error fetching expense subcategories:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch expense subcategories',
            message: error.message
        });
    }
});

// Legacy route - kept for backwards compatibility
router.get('/expenses-subcategories', async (req, res) => {
    try {
        const categoryId = req.query.categoryId ? parseInt(req.query.categoryId) : null;
        const subcategories = await getExpenseSubcategories(categoryId);
        res.json(subcategories);
    } catch (error) {
        console.error('Error fetching expense subcategories:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch expense subcategories',
            message: error.message
        });
    }
});

/**
 * Create a new expense
 */
router.post('/expenses', async (req, res) => {
    try {
        const { expenseDate, amount, currency, note, categoryId, subcategoryId } = req.body;

        // Validation
        if (!expenseDate || !amount) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: expenseDate, amount'
            });
        }

        const expenseData = {
            expenseDate,
            amount: parseInt(amount),
            currency: currency || 'IQD',
            note,
            categoryId: categoryId ? parseInt(categoryId) : null,
            subcategoryId: subcategoryId ? parseInt(subcategoryId) : null
        };

        const result = await addExpense(expenseData);
        res.status(201).json({
            success: true,
            message: 'Expense created successfully',
            data: result
        });
    } catch (error) {
        console.error('Error creating expense:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create expense',
            message: error.message
        });
    }
});

/**
 * Get expense summary by category and currency
 * Query params: startDate, endDate (required)
 */
router.get('/expenses/summary', async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        if (!startDate || !endDate) {
            return res.status(400).json({
                success: false,
                error: 'Missing required parameters: startDate, endDate'
            });
        }

        const summary = await getExpenseSummary(startDate, endDate);
        const totals = await getExpenseTotalsByCurrency(startDate, endDate);

        res.json({
            summary,
            totals
        });
    } catch (error) {
        console.error('Error fetching expense summary:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch expense summary',
            message: error.message
        });
    }
});

// Legacy route - kept for backwards compatibility
router.get('/expenses-summary', async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        if (!startDate || !endDate) {
            return res.status(400).json({
                success: false,
                error: 'Missing required parameters: startDate, endDate'
            });
        }

        const summary = await getExpenseSummary(startDate, endDate);
        const totals = await getExpenseTotalsByCurrency(startDate, endDate);

        res.json({
            summary,
            totals
        });
    } catch (error) {
        console.error('Error fetching expense summary:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch expense summary',
            message: error.message
        });
    }
});

/**
 * Get a single expense by ID
 * NOTE: This route MUST come after all specific /expenses/* routes
 * to avoid matching paths like /expenses/categories or /expenses/summary
 */
router.get('/expenses/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Validate that id is a valid number
        const expenseId = parseInt(id);
        if (isNaN(expenseId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid expense ID. Must be a number.'
            });
        }

        const expense = await getExpenseById(expenseId);

        if (!expense) {
            return res.status(404).json({
                success: false,
                error: 'Expense not found'
            });
        }

        res.json(expense);
    } catch (error) {
        console.error('Error fetching expense:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch expense',
            message: error.message
        });
    }
});

/**
 * Update an existing expense - Protected: Secretary can only edit expenses created today
 * NOTE: This route MUST come after all specific /expenses/* routes
 */
router.put('/expenses/:id',
    authenticate,
    authorize(['admin', 'secretary']),
    requireRecordAge({
        resourceType: 'expense',
        operation: 'update',
        getRecordDate: getExpenseCreationDate
    }),
    async (req, res) => {
        try {
            const { id } = req.params;
        const { expenseDate, amount, currency, note, categoryId, subcategoryId } = req.body;

        // Validate that id is a valid number
        const expenseId = parseInt(id);
        if (isNaN(expenseId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid expense ID. Must be a number.'
            });
        }

        // Validation
        if (!expenseDate || !amount) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: expenseDate, amount'
            });
        }

        const expenseData = {
            expenseDate,
            amount: parseInt(amount),
            currency: currency || 'IQD',
            note,
            categoryId: categoryId ? parseInt(categoryId) : null,
            subcategoryId: subcategoryId ? parseInt(subcategoryId) : null
        };

        const result = await updateExpense(expenseId, expenseData);
        res.json({
            success: true,
            message: 'Expense updated successfully',
            data: result
        });
        } catch (error) {
            console.error('Error updating expense:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to update expense',
                message: error.message
            });
        }
    }
);

/**
 * Delete an expense - Protected: Secretary can only delete expenses created today
 * NOTE: This route MUST come after all specific /expenses/* routes
 */
router.delete('/expenses/:id',
    authenticate,
    authorize(['admin', 'secretary']),
    requireRecordAge({
        resourceType: 'expense',
        operation: 'delete',
        getRecordDate: getExpenseCreationDate
    }),
    async (req, res) => {
        try {
            const { id } = req.params;

        // Validate that id is a valid number
        const expenseId = parseInt(id);
        if (isNaN(expenseId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid expense ID. Must be a number.'
            });
        }

        const result = await deleteExpense(expenseId);
        res.json({
            success: true,
            message: 'Expense deleted successfully',
            data: result
        });
        } catch (error) {
            console.error('Error deleting expense:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to delete expense',
                message: error.message
            });
        }
    }
);

export default router;
