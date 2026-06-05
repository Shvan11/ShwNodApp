/**
 * API contract — expense endpoints.
 *
 * Single source of truth for each expense endpoint's request + response shapes,
 * imported by BOTH the Express routes (relative `.js`) and the React app
 * (`@shared` alias). One exported `const <action> = { body?, params?, query?,
 * response } as const` per endpoint; types via `z.infer`. See
 * docs/shared-contract-progress.md.
 *
 * Phase 8 (Wave 2). The query-filter schema is already structured → relocated
 * verbatim (the H10 silent-NaN guard). The create/update BODY stays LOOSE: the
 * handler builds an EXPLICIT `ExpenseData` literal (no `...req.body` spread), so
 * over-posting is already closed; the contract only enforces the two required
 * fields (`expense_date` real-calendar-day, `amount` positive) the handler
 * checks. Service-bound array responses → `anyArray` (assert array-vs-object,
 * no source-interface flip); single rich rows → `z.unknown()` (preserve payload).
 */
import { z } from 'zod';
import {
  idParams,
  dateString,
  optionalPositiveIntQuery,
  optionalNonNegIntQuery,
} from '../validation.js';

// "is it an array" guard — flip-free (every type is assignable to `unknown`).
const anyArray = z.array(z.unknown());

// Shared loose body for create + update (relocated verbatim from the route).
const expenseBody = z.looseObject({
  expense_date: dateString,
  amount: z.coerce.number().positive('amount must be a positive number'),
});

// ---------------------------------------------------------------------------
// GET /api/expenses?startDate=&endDate=&categoryId=&… — filtered list.
// Query coercion closes the H10 `limit='abc'` silent-NaN sub-issue.
// ---------------------------------------------------------------------------
export const expenseList = {
  query: z.object({
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    categoryId: optionalPositiveIntQuery,
    subcategoryId: optionalPositiveIntQuery,
    currency: z.string().optional(),
    limit: optionalPositiveIntQuery,
    offset: optionalNonNegIntQuery,
  }),
  response: anyArray,
} as const;

// GET /api/expenses/categories — ExpenseCategory[].
export const expenseCategories = {
  response: anyArray,
} as const;

// GET /api/expenses/subcategories/:categoryId — ExpenseSubcategory[].
export const expenseSubcategories = {
  response: anyArray,
} as const;

// POST /api/expenses — addExpense → { NewID }.
export const createExpense = {
  body: expenseBody,
  response: z.object({ NewID: z.number() }),
} as const;

// GET /api/expenses/summary?startDate=&endDate= — { summary[], totals[] }.
export const expenseSummary = {
  response: z.object({ summary: anyArray, totals: anyArray }),
} as const;

// GET /api/expenses/:id — single Expense row (rich) → z.unknown() preserve.
export const expenseById = {
  response: z.unknown(),
} as const;

// PUT /api/expenses/:id — updateExpense → { success, id }.
export const updateExpense = {
  params: idParams('id'),
  body: expenseBody,
  response: z.object({ success: z.boolean(), id: z.number() }),
} as const;

// DELETE /api/expenses/:id — deleteExpense → { success, id }.
export const deleteExpense = {
  params: idParams('id'),
  response: z.object({ success: z.boolean(), id: z.number() }),
} as const;
