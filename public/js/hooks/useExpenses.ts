/**
 * Custom hooks for Expenses Management
 * Handles all expense-related API calls with proper state management
 */
import { useState, useEffect, useCallback } from 'react';

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
  ExpenseID: number;
  Amount: number;
  Currency: string;
  CategoryID?: number;
  CategoryName?: string;
  SubcategoryID?: number;
  SubcategoryName?: string;
  Description?: string;
  ExpenseDate?: string;
  [key: string]: unknown;
}

/**
 * Category data
 */
export interface Category {
  CategoryID: number;
  CategoryName: string;
  [key: string]: unknown;
}

/**
 * Subcategory data
 */
export interface Subcategory {
  SubcategoryID: number;
  SubcategoryName: string;
  CategoryID: number;
  [key: string]: unknown;
}

/**
 * Expense summary data
 */
export interface ExpenseSummary {
  totalExpenses: number;
  byCategory: Array<{
    CategoryName: string;
    Total: number;
  }>;
  byCurrency: Array<{
    Currency: string;
    Total: number;
  }>;
  [key: string]: unknown;
}

/**
 * Expense data for create/update (matches backend API)
 */
export interface ExpenseData {
  expenseDate: string;
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

      const response = await fetch(`/api/expenses?${queryParams}`);
      if (!response.ok) throw new Error('Failed to fetch expenses');

      const data = await response.json();
      setExpenses(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch expenses');
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
        const response = await fetch('/api/expenses/categories');
        if (!response.ok) throw new Error('Failed to fetch categories');
        const data = await response.json();
        setCategories(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch categories');
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
      return;
    }

    const fetchSubcategories = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/expenses/subcategories/${categoryId}`);
        if (!response.ok) throw new Error('Failed to fetch subcategories');
        const data = await response.json();
        setSubcategories(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch subcategories');
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

        const response = await fetch('/api/expenses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(expenseData),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => null);
          const errorMessage = errorData?.error || `Failed to create expense (${response.status})`;
          throw new Error(errorMessage);
        }

        const data = await response.json();
        if (onSuccess) onSuccess();
        return data;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create expense';
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

        const response = await fetch(`/api/expenses/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(expenseData),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => null);
          const errorMessage = errorData?.error || `Failed to update expense (${response.status})`;
          throw new Error(errorMessage);
        }

        const data = await response.json();
        if (onSuccess) onSuccess();
        return data;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update expense';
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

        const response = await fetch(`/api/expenses/${id}`, {
          method: 'DELETE',
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => null);
          const errorMessage = errorData?.error || `Failed to delete expense (${response.status})`;
          throw new Error(errorMessage);
        }

        if (onSuccess) onSuccess();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to delete expense';
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

        const response = await fetch(`/api/expenses/summary?${queryParams}`);
        if (!response.ok) throw new Error('Failed to fetch summary');

        const data = await response.json();
        setSummary(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch summary');
        console.error('Error fetching summary:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchSummary();
  }, [startDate, endDate]);

  return { summary, loading, error };
}
