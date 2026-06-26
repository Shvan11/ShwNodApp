import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useExpenses, useExpenseMutations } from '../hooks/useExpenses';
import type { Expense, ExpenseFilters as ExpenseFiltersType, ExpenseData } from '../hooks/useExpenses';
import ExpenseFilters from '../components/expenses/ExpenseFilters';
import ExpenseTable from '../components/expenses/ExpenseTable';
import ExpenseSummary from '../components/expenses/ExpenseSummary';
import ExpenseModal from '../components/expenses/ExpenseModal';
import DeleteConfirmModal from '../components/expenses/DeleteConfirmModal';
import { useToast } from '../contexts/ToastContext';
import { useGlobalState } from '../contexts/GlobalStateContext';
import { roleCaps, type UserRole } from '@shared/auth/roles';
import { httpErrorMessage } from '@/core/http';
import { expenseByIdQuery } from '@/query/queries';
import styles from './Expenses.module.css';

/**
 * Filters state with optional category/subcategory IDs (undefined for unset)
 */
interface FiltersState {
  startDate: string;
  endDate: string;
  categoryId?: number | string;
  subcategoryId?: number | string;
  currency?: string;
  isMonthly?: string;
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
  const { t } = useTranslation('expenses');

  // Toast notifications (now using unified global toast system)
  const toast = useToast();

  const { user } = useGlobalState();
  const caps = roleCaps(user?.role as UserRole | undefined);

  const [searchParams] = useSearchParams();

  // Seed filters from the URL when deep-linked (e.g. from the statistics
  // daily-invoices modal: /expenses?startDate=…&endDate=…&currency=…),
  // otherwise fall back to the current month. Read once on mount only.
  const getInitialFilters = (): FiltersState => {
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const currency = searchParams.get('currency');
    if (!startDate && !endDate && !currency) {
      return getDefaultDateRange();
    }
    const defaults = getDefaultDateRange();
    return {
      ...defaults,
      startDate: startDate ?? defaults.startDate,
      endDate: endDate ?? defaults.endDate,
      currency: currency ?? undefined,
    };
  };

  // State for filters - initialized from URL params or current month
  const [filters, setFilters] = useState<FiltersState>(getInitialFilters);

  // Applied filters - start with same initial values to fetch immediately
  const [appliedFilters, setAppliedFilters] = useState<FiltersState>(getInitialFilters);

  // State for modals
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [currentExpense, setCurrentExpense] = useState<Expense | null>(null);
  const [expenseToDelete, setExpenseToDelete] = useState<Expense | null>(null);

  // Edit flow: an id gates the single-expense fetch; the row click sets it +
  // opens the modal, and an effect seeds `currentExpense` once the row arrives.
  const [editingId, setEditingId] = useState<number | null>(null);
  const { data: editingExpense, error: editingError } = useQuery(expenseByIdQuery(editingId));

  // Seed the modal's working copy from the fetched expense (edit flow only). Done
  // during render (adjust-state-during-render), keyed on the fetched-expense identity,
  // rather than in an effect so the React Compiler can optimize it. `currentExpense`
  // is also set by other handlers, so this only seeds when a freshly-fetched row arrives.
  const [seededExpense, setSeededExpense] = useState<Expense | null>(null);
  if (editingId != null && editingExpense && seededExpense !== editingExpense) {
    setSeededExpense(editingExpense as Expense);
    setCurrentExpense(editingExpense as Expense);
  }

  // Surface a load failure and abandon the edit flow. The reset is done during
  // render (adjust-during-render, not a setState-in-effect); nulling editingId
  // both closes the flow and disables the query, which also breaks this condition
  // so it runs once. The message is captured into state here — as a fresh object
  // per failure — because nulling editingId clears `editingError`; the effect then
  // fires the toast (a side effect, not derived state) once per failure object.
  const [loadErrorToast, setLoadErrorToast] = useState<{ msg: string } | null>(null);
  if (editingId != null && editingError) {
    setLoadErrorToast({ msg: httpErrorMessage(editingError, t('toast.loadFailed')) });
    setEditingId(null);
    setIsExpenseModalOpen(false);
  }
  useEffect(() => {
    if (loadErrorToast) {
      toast.error(loadErrorToast.msg);
    }
  }, [loadErrorToast, toast]);

  // Convert FiltersState to ExpenseFiltersType for the hook
  const hookFilters: ExpenseFiltersType = {
    startDate: appliedFilters.startDate,
    endDate: appliedFilters.endDate,
    categoryId: appliedFilters.categoryId ?? undefined,
    subcategoryId: appliedFilters.subcategoryId ?? undefined,
    currency: appliedFilters.currency ?? undefined,
    isMonthly: appliedFilters.isMonthly || undefined,
  };

  // Fetch expenses with applied filters
  const { expenses, loading, error, refetch } = useExpenses(hookFilters);

  // Mutations
  const {
    createExpense,
    updateExpense,
    deleteExpense,
    loading: mutationLoading
  } = useExpenseMutations();

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
    setEditingId(null);
    setCurrentExpense(null);
    setIsExpenseModalOpen(true);
  };

  // Open edit expense modal — the query (gated on editingId) loads the row and
  // an effect seeds `currentExpense` once it arrives.
  const handleEditExpense = (id: number) => {
    setEditingId(id);
    setIsExpenseModalOpen(true);
  };

  // Open delete confirmation modal
  const handleDeleteExpense = (id: number) => {
    const expense = expenses.find(e => e.id === id);
    if (expense) {
      setExpenseToDelete(expense);
      setIsDeleteModalOpen(true);
    }
  };

  // Save expense (create or update)
  const handleSaveExpense = async (expenseData: ExpenseData) => {
    try {
      if (currentExpense) {
        const r = await updateExpense(currentExpense.id, expenseData);
        toast.success(r.outcome === 'pending' ? 'Submitted for admin approval' : t('toast.updated'));
      } else {
        await createExpense(expenseData);
        toast.success(t('toast.created'));
      }
      setIsExpenseModalOpen(false);
      setCurrentExpense(null);
      setEditingId(null);
    } catch {
      toast.error(
        currentExpense ? t('toast.updateFailed') : t('toast.createFailed')
      );
    }
  };

  // Confirm delete
  const handleConfirmDelete = async () => {
    if (!expenseToDelete) return;

    try {
      const r = await deleteExpense(expenseToDelete.id);
      toast.success(r.outcome === 'pending' ? 'Submitted for admin approval' : t('toast.deleted'));
      setIsDeleteModalOpen(false);
      setExpenseToDelete(null);
    } catch {
      toast.error(t('toast.deleteFailed'));
    }
  };

  return (
    <div className={styles.expensesContainer}>
      <div className={styles.expensesPageHeader}>
        <h1>{t('title')}</h1>
        {caps.writeFinance && (
          <button
            className="btn btn-primary"
            onClick={handleAddExpense}
            disabled={mutationLoading}
          >
            {t('addNew')}
          </button>
        )}
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
        <div className={styles.errorBanner}>
          <p>{t('errorLoading', { error })}</p>
          <button onClick={refetch} className="btn btn-secondary">
            {t('retry')}
          </button>
        </div>
      )}

      {/* Expenses Table */}
      <ExpenseTable
        expenses={expenses}
        loading={loading}
        onEdit={handleEditExpense}
        onDelete={handleDeleteExpense}
        writeFinance={caps.writeFinance}
      />

      {/* Expense Modal (Add/Edit) */}
      <ExpenseModal
        isOpen={isExpenseModalOpen}
        expense={currentExpense}
        onClose={() => {
          setIsExpenseModalOpen(false);
          setCurrentExpense(null);
          setEditingId(null);
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
