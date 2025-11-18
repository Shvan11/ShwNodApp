import React, { useState, useEffect } from 'react';
import { useExpenses, useExpenseMutations } from '../hooks/useExpenses.js';
import ExpenseFilters from '../components/expenses/ExpenseFilters.jsx';
import ExpenseTable from '../components/expenses/ExpenseTable.jsx';
import ExpenseSummary from '../components/expenses/ExpenseSummary.jsx';
import ExpenseModal from '../components/expenses/ExpenseModal.jsx';
import DeleteConfirmModal from '../components/expenses/DeleteConfirmModal.jsx';
import { useToast } from '../contexts/ToastContext.jsx';

export default function Expenses() {
  // Toast notifications (now using unified global toast system)
  const toast = useToast();

  // Initialize default date range (current month)
  const getDefaultDateRange = () => {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const formatDateString = (date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    return {
      startDate: formatDateString(firstDay),
      endDate: formatDateString(lastDay),
      categoryId: null,
      subcategoryId: null,
      currency: null
    };
  };

  // State for filters - initialize with default date range
  const [filters, setFilters] = useState(getDefaultDateRange);

  // Applied filters - start with same default to prevent loading all expenses
  const [appliedFilters, setAppliedFilters] = useState(getDefaultDateRange);

  // State for modals
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [currentExpense, setCurrentExpense] = useState(null);
  const [expenseToDelete, setExpenseToDelete] = useState(null);

  // Fetch expenses with applied filters
  const { expenses, loading, error, refetch } = useExpenses(appliedFilters);

  // Mutations
  const {
    createExpense,
    updateExpense,
    deleteExpense,
    loading: mutationLoading,
    error: mutationError
  } = useExpenseMutations(refetch);

  // Handle filter changes (updates local state only, not applied yet)
  const handleFilterChange = (updates) => {
    setFilters(prev => ({ ...prev, ...updates }));
  };

  // Apply filters (triggers refetch)
  const handleApplyFilters = () => {
    setAppliedFilters(filters);
  };

  // Reset filters
  const handleResetFilters = () => {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const formatDateString = (date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    const resetFilters = {
      startDate: formatDateString(firstDay),
      endDate: formatDateString(lastDay),
      categoryId: null,
      subcategoryId: null,
      currency: null
    };

    setFilters(resetFilters);
    setAppliedFilters(resetFilters);
  };

  // Open add expense modal
  const handleAddExpense = () => {
    setCurrentExpense(null);
    setIsExpenseModalOpen(true);
  };

  // Open edit expense modal
  const handleEditExpense = async (id) => {
    try {
      const response = await fetch(`/api/expenses/${id}`);
      if (!response.ok) throw new Error('Failed to fetch expense');

      const expense = await response.json();
      setCurrentExpense(expense);
      setIsExpenseModalOpen(true);
    } catch (err) {
      console.error('Error loading expense:', err);
      toast.error('Failed to load expense data');
    }
  };

  // Open delete confirmation modal
  const handleDeleteExpense = (id) => {
    const expense = expenses.find(e => e.ID === id);
    if (expense) {
      setExpenseToDelete(expense);
      setIsDeleteModalOpen(true);
    }
  };

  // Save expense (create or update)
  const handleSaveExpense = async (expenseData) => {
    try {
      if (currentExpense) {
        await updateExpense(currentExpense.ID, expenseData);
        toast.success('Expense updated successfully');
      } else {
        await createExpense(expenseData);
        toast.success('Expense created successfully');
      }
      setIsExpenseModalOpen(false);
      setCurrentExpense(null);
    } catch (err) {
      toast.error(
        currentExpense ? 'Failed to update expense' : 'Failed to create expense'
      );
    }
  };

  // Confirm delete
  const handleConfirmDelete = async () => {
    if (!expenseToDelete) return;

    try {
      await deleteExpense(expenseToDelete.ID);
      toast.success('Expense deleted successfully');
      setIsDeleteModalOpen(false);
      setExpenseToDelete(null);
    } catch (err) {
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

      {/* Toast Notifications now handled globally by ToastProvider in App.jsx */}
    </div>
  );
}
