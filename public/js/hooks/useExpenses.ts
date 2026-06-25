/**
 * Custom hooks for Expenses Management
 *
 * Reads are thin wrappers over the React Query `queryOptions` factories in
 * `query/queries.ts` (shared/deduped cache); mutations write via `core/http`
 * then invalidate `qk.expenses.all()` so every expense read refreshes —
 * replacing the old caller-supplied `onSuccess`→`refetch` wiring.
 *
 * The entity types below stay frontend-owned (the expense responses predate full
 * contract modelling); the factories keep these as their return generics while
 * the contract `.response` still validates the boundary at runtime.
 */
import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { postJSON, putJSON, deleteJSON, httpErrorMessage } from '@/core/http';
import * as expenseContract from '@shared/contracts/expense.contract';
import { qk } from '@/query/keys';
import {
  expensesQuery,
  expenseCategoriesQuery,
  expenseSubcategoriesQuery,
  expenseSummaryQuery,
} from '@/query/queries';

/**
 * Expense filters
 */
export interface ExpenseFilters {
  startDate?: string;
  endDate?: string;
  categoryId?: number | string;
  subcategoryId?: number | string;
  currency?: string;
}

/**
 * Expense data
 */
export interface Expense {
  id: number;
  amount: number;
  currency: string;
  category_id?: number;
  category_name?: string;
  subcategory_id?: number;
  subcategory_name?: string;
  // Arabic display names (nullable) — paired with the base names for client-side
  // per-language resolution via useLocalizedName. See "DB-stored lookup values".
  category_name_ar?: string | null;
  subcategory_name_ar?: string | null;
  note?: string;
  expense_date?: string;
  [key: string]: unknown;
}

/**
 * Category data
 */
export interface Category {
  category_id: number;
  category_name: string;
  category_name_ar?: string | null;
  [key: string]: unknown;
}

/**
 * Subcategory data
 */
export interface Subcategory {
  subcategory_id: number;
  subcategory_name: string;
  category_id: number;
  subcategory_name_ar?: string | null;
  [key: string]: unknown;
}

/**
 * Expense summary data
 */
export interface ExpenseSummary {
  totalExpenses: number;
  byCategory: Array<{
    category_name: string;
    total: number;
  }>;
  byCurrency: Array<{
    currency: string;
    total: number;
  }>;
  [key: string]: unknown;
}

/**
 * Expense data for create/update (matches backend API)
 */
export interface ExpenseData {
  expense_date: string;
  amount: number;
  currency: string;
  note?: string;
  categoryId?: number;
  subcategoryId?: number;
  [key: string]: unknown;
}

/**
 * Hook for fetching and managing expenses list
 */
export function useExpenses(filters: ExpenseFilters = {}): {
  expenses: Expense[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
} {
  const query = useQuery(expensesQuery(filters));
  return {
    expenses: query.data ?? [],
    loading: query.isLoading,
    error: query.error ? httpErrorMessage(query.error, 'Failed to fetch expenses') : null,
    refetch: async () => { await query.refetch(); },
  };
}

/**
 * Hook for fetching categories
 */
export function useCategories(): {
  categories: Category[];
  loading: boolean;
  error: string | null;
} {
  const query = useQuery(expenseCategoriesQuery());
  return {
    categories: query.data ?? [],
    loading: query.isLoading,
    error: query.error ? httpErrorMessage(query.error, 'Failed to fetch categories') : null,
  };
}

/**
 * Hook for fetching subcategories by category
 */
export function useSubcategories(categoryId: number | string | null | undefined): {
  subcategories: Subcategory[];
  loading: boolean;
  error: string | null;
} {
  const query = useQuery(expenseSubcategoriesQuery(categoryId));
  return {
    subcategories: query.data ?? [],
    loading: query.isLoading,
    error: query.error ? httpErrorMessage(query.error, 'Failed to fetch subcategories') : null,
  };
}

/**
 * Hook for expense mutations (create, update, delete)
 */
export function useExpenseMutations(): {
  createExpense: (expenseData: ExpenseData) => Promise<Expense>;
  updateExpense: (id: number, expenseData: ExpenseData) => Promise<{ outcome: 'applied' | 'pending' }>;
  deleteExpense: (id: number) => Promise<{ outcome: 'applied' | 'pending' }>;
  loading: boolean;
  error: string | null;
} {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createExpense = useCallback(
    async (expenseData: ExpenseData): Promise<Expense> => {
      try {
        setLoading(true);
        setError(null);

        const data = await postJSON<Expense>('/api/expenses', expenseData, { schema: expenseContract.createExpense.response });
        void queryClient.invalidateQueries({ queryKey: qk.expenses.all() });
        return data;
      } catch (err) {
        setError(httpErrorMessage(err, 'Failed to create expense'));
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [queryClient]
  );

  const updateExpense = useCallback(
    async (id: number, expenseData: ExpenseData): Promise<{ outcome: 'applied' | 'pending' }> => {
      try {
        setLoading(true);
        setError(null);

        const data = await putJSON<{ outcome: string }>(`/api/expenses/${id}`, expenseData, { schema: expenseContract.updateExpense.response });
        if (data.outcome === 'pending') return { outcome: 'pending' };
        void queryClient.invalidateQueries({ queryKey: qk.expenses.all() });
        return { outcome: 'applied' };
      } catch (err) {
        setError(httpErrorMessage(err, 'Failed to update expense'));
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [queryClient]
  );

  const deleteExpense = useCallback(
    async (id: number): Promise<{ outcome: 'applied' | 'pending' }> => {
      try {
        setLoading(true);
        setError(null);

        const data = await deleteJSON<{ outcome: string }>(`/api/expenses/${id}`, { schema: expenseContract.deleteExpense.response });
        if (data.outcome === 'pending') return { outcome: 'pending' };
        void queryClient.invalidateQueries({ queryKey: qk.expenses.all() });
        return { outcome: 'applied' };
      } catch (err) {
        setError(httpErrorMessage(err, 'Failed to delete expense'));
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [queryClient]
  );

  return {
    createExpense,
    updateExpense,
    deleteExpense,
    loading,
    error,
  };
}

/**
 * Hook for fetching expense summary
 */
export function useExpenseSummary(
  startDate: string | null | undefined,
  endDate: string | null | undefined
): {
  summary: ExpenseSummary | null;
  loading: boolean;
  error: string | null;
} {
  const query = useQuery(expenseSummaryQuery(startDate, endDate));
  return {
    summary: query.data ?? null,
    loading: query.isLoading,
    error: query.error ? httpErrorMessage(query.error, 'Failed to fetch summary') : null,
  };
}
