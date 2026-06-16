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
 * verbatim (the H10 silent-NaN guard). The create/update BODY is now FULLY
 * ENUMERATED as a strict `z.object` (the route's `CreateExpenseBody` interface was
 * deleted; the handler types from `CreateExpenseBody = z.infer` below). The
 * handler builds an EXPLICIT `ExpenseData` literal from these fields; the two
 * id filters are `coerce.number().int().optional()` WITHOUT `.positive()` so the
 * form's "no category" empty value can't 400 (the handler's truthy check maps it
 * to undefined). Phase 3: list/categories/subcategories/byId responses are now
 * modeled with looseObject row schemas. expenseSummary is intentionally loose
 * (rollup aggregate — computed server-side, structure varies by filter).
 */
import { z } from 'zod';
import {
  idParams,
  dateString,
  optionalPositiveIntQuery,
  optionalNonNegIntQuery,
} from '../validation.js';

// ---------------------------------------------------------------------------
// ROW SCHEMAS (Phase 3)
// ---------------------------------------------------------------------------

const expenseRow = z.looseObject({
  id: z.number(),
  expense_date: z.string(),
  amount: z.number(),
  currency: z.string().nullable(),
  note: z.string().nullable(),
  category_id: z.number().nullable(),
  subcategory_id: z.number().nullable(),
  category_name: z.string().nullable(),
  subcategory_name: z.string().nullable(),
  // Arabic display names (nullable) — sent beside the base names so the client
  // resolves per-language with a base-name fallback (zero extra queries; see
  // CLAUDE.md i18n / RTL → "DB-stored lookup values").
  category_name_ar: z.string().nullable(),
  subcategory_name_ar: z.string().nullable(),
});

const expenseCategoryRow = z.looseObject({
  category_id: z.number(),
  category_name: z.string(),
  category_name_ar: z.string().nullable(),
});

const expenseSubcategoryRow = z.looseObject({
  subcategory_id: z.number(),
  subcategory_name: z.string(),
  category_id: z.number(),
  category_name: z.string().nullable(),
  subcategory_name_ar: z.string().nullable(),
});

// Shared body for create + update — fully enumerated strict `z.object`.
const expenseBody = z.object({
  expense_date: dateString,
  amount: z.coerce.number().positive('amount must be a positive number'),
  currency: z.string().optional(),
  note: z.string().optional(),
  categoryId: z.coerce.number().int().optional(),
  subcategoryId: z.coerce.number().int().optional(),
});
export type CreateExpenseBody = z.infer<typeof expenseBody>;

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
  response: z.array(expenseRow),
} as const;

// GET /api/expenses/categories — ExpenseCategory[].
export const expenseCategories = {
  response: z.array(expenseCategoryRow),
} as const;

// GET /api/expenses/subcategories/:categoryId — ExpenseSubcategory[].
export const expenseSubcategories = {
  response: z.array(expenseSubcategoryRow),
} as const;

// POST /api/expenses — addExpense → { NewID }.
export const createExpense = {
  body: expenseBody,
  response: z.object({ NewID: z.number() }),
} as const;

// GET /api/expenses/summary?startDate=&endDate= — { summary[], totals[] }.
// summary = ExpenseSummary[] (per category+currency), totals = ExpenseTotal[]
// (per currency) — both from expense-queries.
export const expenseSummary = {
  response: z.object({
    summary: z.array(
      z.object({
        category_name: z.string().nullable(),
        currency: z.string(),
        ExpenseCount: z.number(),
        total_amount: z.number(),
      })
    ),
    totals: z.array(
      z.object({
        currency: z.string(),
        ExpenseCount: z.number(),
        total_amount: z.number(),
      })
    ),
  }),
} as const;

// GET /api/expenses/:id — single Expense row.
export const expenseById = {
  response: expenseRow,
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
