/**
 * Custom hooks for Expenses Management
 * Handles all expense-related API calls with proper state management
 */
import { useState, useEffect, useCallback } from 'react';
import { fetchJSON, postJSON, putJSON, deleteJSON, httpErrorMessage } from '@/core/http';

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
  [key: string]: unknown;
}

/**
 * Subcategory data
 */
export interface Subcategory {
  subcategory_id: number;
  subcategory_name: string;
  category_id: number;
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
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchExpenses = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const queryParams = new URLSearchParams();
      if (filters.startDate) queryParams.append('startDate', filters.startDate);
      if (filters.endDate) queryParams.append('endDate', filters.endDate);
      if (filters.categoryId) queryParams.append('categoryId', String(filters.categoryId));
      if (filters.subcategoryId) queryParams.append('subcategoryId', String(filters.subcategoryId));
      if (filters.currency) queryParams.append('currency', filters.currency);

      const data = await fetchJSON<Expense[]>(`/api/expenses?${queryParams}`);
      setExpenses(data);
    } catch (err) {
      setError(httpErrorMessage(err, 'Failed to fetch expenses'));
      console.error('Error fetching expenses:', err);
    } finally {
      setLoading(false);
    }
  }, [
    filters.startDate,
    filters.endDate,
    filters.categoryId,
    filters.subcategoryId,
    filters.currency,
  ]);

  useEffect(() => {
    fetchExpenses();
  }, [fetchExpenses]);

  return { expenses, loading, error, refetch: fetchExpenses };
}

/**
 * Hook for fetching categories
 */
export function useCategories(): {
  categories: Category[];
  loading: boolean;
  error: string | null;
} {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchCategories = async () => {
      try {
        setLoading(true);
        const data = await fetchJSON<Category[]>('/api/expenses/categories');
        setCategories(data);
      } catch (err) {
        setError(httpErrorMessage(err, 'Failed to fetch categories'));
        console.error('Error fetching categories:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchCategories();
  }, []);

  return { categories, loading, error };
}

/**
 * Hook for fetching subcategories by category
 */
export function useSubcategories(categoryId: number | string | null | undefined): {
  subcategories: Subcategory[];
  loading: boolean;
  error: string | null;
} {
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!categoryId) {
      setSubcategories([]);
      setError(null);
      return;
    }

    const fetchSubcategories = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchJSON<Subcategory[]>(`/api/expenses/subcategories/${categoryId}`);
        setSubcategories(data);
      } catch (err) {
        setError(httpErrorMessage(err, 'Failed to fetch subcategories'));
        console.error('Error fetching subcategories:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchSubcategories();
  }, [categoryId]);

  return { subcategories, loading, error };
}

/**
 * Hook for expense mutations (create, update, delete)
 */
export function useExpenseMutations(onSuccess?: () => void): {
  createExpense: (expenseData: ExpenseData) => Promise<Expense>;
  updateExpense: (id: number, expenseData: ExpenseData) => Promise<Expense>;
  deleteExpense: (id: number) => Promise<void>;
  loading: boolean;
  error: string | null;
} {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createExpense = useCallback(
    async (expenseData: ExpenseData): Promise<Expense> => {
      try {
        setLoading(true);
        setError(null);

        const data = await postJSON<Expense>('/api/expenses', expenseData);
        if (onSuccess) onSuccess();
        return data;
      } catch (err) {
        const message = httpErrorMessage(err, 'Failed to create expense');
        setError(message);
        console.error('Error creating expense:', err);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [onSuccess]
  );

  const updateExpense = useCallback(
    async (id: number, expenseData: ExpenseData): Promise<Expense> => {
      try {
        setLoading(true);
        setError(null);

        const data = await putJSON<Expense>(`/api/expenses/${id}`, expenseData);
        if (onSuccess) onSuccess();
        return data;
      } catch (err) {
        const message = httpErrorMessage(err, 'Failed to update expense');
        setError(message);
        console.error('Error updating expense:', err);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [onSuccess]
  );

  const deleteExpense = useCallback(
    async (id: number): Promise<void> => {
      try {
        setLoading(true);
        setError(null);

        await deleteJSON(`/api/expenses/${id}`);
        if (onSuccess) onSuccess();
      } catch (err) {
        const message = httpErrorMessage(err, 'Failed to delete expense');
        setError(message);
        console.error('Error deleting expense:', err);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [onSuccess]
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
  const [summary, setSummary] = useState<ExpenseSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Skip API call if required parameters are missing
    if (!startDate || !endDate) {
      setSummary(null);
      setLoading(false);
      setError(null);
      return;
    }

    const fetchSummary = async () => {
      try {
        setLoading(true);
        const queryParams = new URLSearchParams();
        queryParams.append('startDate', startDate);
        queryParams.append('endDate', endDate);

        const data = await fetchJSON<ExpenseSummary>(`/api/expenses/summary?${queryParams}`);
        setSummary(data);
        setError(null);
      } catch (err) {
        setError(httpErrorMessage(err, 'Failed to fetch summary'));
        console.error('Error fetching summary:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchSummary();
  }, [startDate, endDate]);

  return { summary, loading, error };
}
