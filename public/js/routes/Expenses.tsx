import { useState } from 'react';
import { useExpenses, useExpenseMutations } from '../hooks/useExpenses';
import type { Expense, ExpenseFilters as ExpenseFiltersType, ExpenseData } from '../hooks/useExpenses';
import ExpenseFilters from '../components/expenses/ExpenseFilters';
import ExpenseTable from '../components/expenses/ExpenseTable';
import ExpenseSummary from '../components/expenses/ExpenseSummary';
import ExpenseModal from '../components/expenses/ExpenseModal';
import DeleteConfirmModal from '../components/expenses/DeleteConfirmModal';
import { useToast } from '../contexts/ToastContext';

// Expenses page styles
import '../../css/pages/expenses.css';

/**
 * Filters state with optional category/subcategory IDs (undefined for unset)
 */
interface FiltersState {
  startDate: string;
  endDate: string;
  categoryId?: number | string;
  subcategoryId?: number | string;
  currency?: string;
}

/**
 * Format a Date object as YYYY-MM-DD string
 */
function formatDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get default date range (current month)
 */
function getDefaultDateRange(): FiltersState {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  return {
    startDate: formatDateString(firstDay),
    endDate: formatDateString(lastDay),
    categoryId: undefined,
    subcategoryId: undefined,
    currency: undefined
  };
}

export default function Expenses() {
  // Toast notifications (now using unified global toast system)
  const toast = useToast();

  // State for filters - initialize with default date range
  const [filters, setFilters] = useState<FiltersState>(getDefaultDateRange);

  // Applied filters - start with same default to prevent loading all expenses
  const [appliedFilters, setAppliedFilters] = useState<FiltersState>(getDefaultDateRange);

  // State for modals
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [currentExpense, setCurrentExpense] = useState<Expense | null>(null);
  const [expenseToDelete, setExpenseToDelete] = useState<Expense | null>(null);

  // Convert FiltersState to ExpenseFiltersType for the hook
  const hookFilters: ExpenseFiltersType = {
    startDate: appliedFilters.startDate,
    endDate: appliedFilters.endDate,
    categoryId: appliedFilters.categoryId ?? undefined,
    subcategoryId: appliedFilters.subcategoryId ?? undefined,
    currency: appliedFilters.currency ?? undefined
  };

  // Fetch expenses with applied filters
  const { expenses, loading, error, refetch } = useExpenses(hookFilters);

  // Mutations
  const {
    createExpense,
    updateExpense,
    deleteExpense,
    loading: mutationLoading
  } = useExpenseMutations(refetch);

  // Handle filter changes (updates local state only, not applied yet)
  const handleFilterChange = (updates: Partial<FiltersState>) => {
    setFilters(prev => ({ ...prev, ...updates }));
  };

  // Apply filters (triggers refetch)
  const handleApplyFilters = () => {
    setAppliedFilters(filters);
  };

  // Reset filters
  const handleResetFilters = () => {
    const resetFilters = getDefaultDateRange();
    setFilters(resetFilters);
    setAppliedFilters(resetFilters);
  };

  // Open add expense modal
  const handleAddExpense = () => {
    setCurrentExpense(null);
    setIsExpenseModalOpen(true);
  };

  // Open edit expense modal
  const handleEditExpense = async (id: number) => {
    try {
      const response = await fetch(`/api/expenses/${id}`);
      if (!response.ok) throw new Error('Failed to fetch expense');

      const expense: Expense = await response.json();
      setCurrentExpense(expense);
      setIsExpenseModalOpen(true);
    } catch (err) {
      console.error('Error loading expense:', err);
      toast.error('Failed to load expense data');
    }
  };

  // Open delete confirmation modal
  const handleDeleteExpense = (id: number) => {
    const expense = expenses.find(e => e.ExpenseID === id);
    if (expense) {
      setExpenseToDelete(expense);
      setIsDeleteModalOpen(true);
    }
  };

  // Save expense (create or update)
  const handleSaveExpense = async (expenseData: ExpenseData) => {
    try {
      if (currentExpense) {
        await updateExpense(currentExpense.ExpenseID, expenseData);
        toast.success('Expense updated successfully');
      } else {
        await createExpense(expenseData);
        toast.success('Expense created successfully');
      }
      setIsExpenseModalOpen(false);
      setCurrentExpense(null);
    } catch {
      toast.error(
        currentExpense ? 'Failed to update expense' : 'Failed to create expense'
      );
    }
  };

  // Confirm delete
  const handleConfirmDelete = async () => {
    if (!expenseToDelete) return;

    try {
      await deleteExpense(expenseToDelete.ExpenseID);
      toast.success('Expense deleted successfully');
      setIsDeleteModalOpen(false);
      setExpenseToDelete(null);
    } catch {
      toast.error('Failed to delete expense');
    }
  };

  return (
    <div className="expenses-container">
      <div className="expenses-page-header">
        <h1>Expense Management</h1>
        <button
          className="btn-action btn-primary"
          onClick={handleAddExpense}
          disabled={mutationLoading}
        >
          Add New Expense
        </button>
      </div>

      {/* Filters Section */}
      <ExpenseFilters
        filters={filters}
        onFilterChange={handleFilterChange}
        onApply={handleApplyFilters}
        onReset={handleResetFilters}
      />

      {/* Summary Section */}
      <ExpenseSummary
        startDate={appliedFilters.startDate}
        endDate={appliedFilters.endDate}
        expenses={expenses}
      />

      {/* Error Display */}
      {error && (
        <div className="error-banner">
          <p>Error loading expenses: {error}</p>
          <button onClick={refetch} className="btn-action btn-secondary">
            Retry
          </button>
        </div>
      )}

      {/* Expenses Table */}
      <ExpenseTable
        expenses={expenses}
        loading={loading}
        onEdit={handleEditExpense}
        onDelete={handleDeleteExpense}
      />

      {/* Expense Modal (Add/Edit) */}
      <ExpenseModal
        isOpen={isExpenseModalOpen}
        expense={currentExpense}
        onClose={() => {
          setIsExpenseModalOpen(false);
          setCurrentExpense(null);
        }}
        onSave={handleSaveExpense}
      />

      {/* Delete Confirmation Modal */}
      <DeleteConfirmModal
        isOpen={isDeleteModalOpen}
        expense={expenseToDelete}
        onConfirm={handleConfirmDelete}
        onCancel={() => {
          setIsDeleteModalOpen(false);
          setExpenseToDelete(null);
        }}
      />

      {/* Toast Notifications now handled globally by ToastProvider in App.tsx */}
    </div>
  );
}
