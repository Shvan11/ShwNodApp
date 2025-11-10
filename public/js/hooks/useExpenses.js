/**
 * Custom hooks for Expenses Management
 * Handles all expense-related API calls with proper state management
 */
import { useState, useEffect, useCallback } from 'react';

/**
 * Hook for fetching and managing expenses list
 */
export function useExpenses(filters = {}) {
    const [expenses, setExpenses] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const fetchExpenses = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);

            const queryParams = new URLSearchParams();
            if (filters.startDate) queryParams.append('startDate', filters.startDate);
            if (filters.endDate) queryParams.append('endDate', filters.endDate);
            if (filters.categoryId) queryParams.append('categoryId', filters.categoryId);
            if (filters.subcategoryId) queryParams.append('subcategoryId', filters.subcategoryId);
            if (filters.currency) queryParams.append('currency', filters.currency);

            const response = await fetch(`/api/expenses?${queryParams}`);
            if (!response.ok) throw new Error('Failed to fetch expenses');

            const data = await response.json();
            setExpenses(data);
        } catch (err) {
            setError(err.message);
            console.error('Error fetching expenses:', err);
        } finally {
            setLoading(false);
        }
    }, [filters.startDate, filters.endDate, filters.categoryId, filters.subcategoryId, filters.currency]);

    useEffect(() => {
        fetchExpenses();
    }, [fetchExpenses]);

    return { expenses, loading, error, refetch: fetchExpenses };
}

/**
 * Hook for fetching categories
 */
export function useCategories() {
    const [categories, setCategories] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchCategories = async () => {
            try {
                setLoading(true);
                const response = await fetch('/api/expenses/categories');
                if (!response.ok) throw new Error('Failed to fetch categories');
                const data = await response.json();
                setCategories(data);
            } catch (err) {
                setError(err.message);
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
export function useSubcategories(categoryId) {
    const [subcategories, setSubcategories] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

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
                setError(err.message);
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
export function useExpenseMutations(onSuccess) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const createExpense = useCallback(async (expenseData) => {
        try {
            setLoading(true);
            setError(null);

            const response = await fetch('/api/expenses', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(expenseData)
            });

            if (!response.ok) throw new Error('Failed to create expense');

            const data = await response.json();
            if (onSuccess) onSuccess();
            return data;
        } catch (err) {
            setError(err.message);
            console.error('Error creating expense:', err);
            throw err;
        } finally {
            setLoading(false);
        }
    }, [onSuccess]);

    const updateExpense = useCallback(async (id, expenseData) => {
        try {
            setLoading(true);
            setError(null);

            const response = await fetch(`/api/expenses/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(expenseData)
            });

            if (!response.ok) throw new Error('Failed to update expense');

            const data = await response.json();
            if (onSuccess) onSuccess();
            return data;
        } catch (err) {
            setError(err.message);
            console.error('Error updating expense:', err);
            throw err;
        } finally {
            setLoading(false);
        }
    }, [onSuccess]);

    const deleteExpense = useCallback(async (id) => {
        try {
            setLoading(true);
            setError(null);

            const response = await fetch(`/api/expenses/${id}`, {
                method: 'DELETE'
            });

            if (!response.ok) throw new Error('Failed to delete expense');

            if (onSuccess) onSuccess();
        } catch (err) {
            setError(err.message);
            console.error('Error deleting expense:', err);
            throw err;
        } finally {
            setLoading(false);
        }
    }, [onSuccess]);

    return {
        createExpense,
        updateExpense,
        deleteExpense,
        loading,
        error
    };
}

/**
 * Hook for fetching expense summary
 */
export function useExpenseSummary(startDate, endDate) {
    const [summary, setSummary] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchSummary = async () => {
            try {
                setLoading(true);
                const queryParams = new URLSearchParams();
                if (startDate) queryParams.append('startDate', startDate);
                if (endDate) queryParams.append('endDate', endDate);

                const response = await fetch(`/api/expenses/summary?${queryParams}`);
                if (!response.ok) throw new Error('Failed to fetch summary');

                const data = await response.json();
                setSummary(data);
            } catch (err) {
                setError(err.message);
                console.error('Error fetching summary:', err);
            } finally {
                setLoading(false);
            }
        };

        fetchSummary();
    }, [startDate, endDate]);

    return { summary, loading, error };
}
