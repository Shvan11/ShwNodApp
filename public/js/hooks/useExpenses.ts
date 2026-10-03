/**
 * Custom hooks for Expenses Management
 *
 * Reads are thin wrappers over the React Query `queryOptions` factories in
 * `query/queries.ts` (shared/deduped cache); mutations are `useApiMutation`s
 * that write via `core/http` then invalidate `qk.expenses.all()` so every
 * expense read refreshes.
 *
 * The entity types below stay frontend-owned (the expense responses predate full
 * contract modelling); the factories keep these as their return generics while
 * the contract `.response` still validates the boundary at runtime.
 */
import { useQuery } from '@tanstack/react-query';
import { postJSON, putJSON, deleteJSON, httpErrorMessage } from '@/core/http';
import * as expenseContract from '@shared/contracts/expense.contract';
import { qk } from '@/query/keys';
import { useApiMutation } from '@/query/useApiMutation';
import {
  expensesQuery,
  expenseCategoriesQuery,
  expenseSubcategoriesQuery,
  labsQuery,
  employeesQuery,
} from '@/query/queries';

/**
 * Expense filters
 */
export interface ExpenseFilters {
  startDate?: string;
  endDate?: string;
  categoryId?: number | string;
  subcategoryId?: number | string;
  labId?: number | string;
  employeeId?: number | string;
  currency?: string;
  isMonthly?: string;
}

/**
 * One expense row — the contract's row (list + by-id share it), so what the
 * screens read is exactly what the boundary validated. It used to be a
 * hand-written interface with non-null `currency`/`note`/ids, bridged onto the
 * parsed row with an `as` cast (FE-F8-11).
 */
export type Expense = expenseContract.ExpenseRow;

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
 * Expense data for create/update (matches backend API)
 */
export interface ExpenseData {
  expense_date: string;
  amount: number;
  currency: string;
  note?: string;
  categoryId?: number;
  subcategoryId?: number;
  // Entity sub-level for the Lab / Employees categories (mutually exclusive with subcategoryId).
  labId?: number;
  employeeId?: number;
  isMonthly?: boolean;
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

/** Active labs for the "Lab" category sub-level dropdown (id + name). */
export function useLabs(): { labs: Array<{ id: number; name: string }>; loading: boolean } {
  const query = useQuery(labsQuery());
  return { labs: query.data ?? [], loading: query.isLoading };
}

/** Active employees for the "Employees" category sub-level dropdown. */
export function useActiveEmployees(): { employees: Array<{ id: number; employee_name: string }>; loading: boolean } {
  const query = useQuery(employeesQuery());
  return { employees: query.data?.employees ?? [], loading: query.isLoading };
}

/**
 * Every employee, quit ones included — for the expense FILTER, where a quit
 * employee's salary history must stay reachable (FE-F8-12). Entry forms keep
 * `useActiveEmployees`: a new expense is never booked to someone who has left.
 */
export function useAllEmployees(): { employees: Array<{ id: number; employee_name: string; is_active: boolean }>; loading: boolean } {
  const query = useQuery(employeesQuery('?includeInactive=true'));
  return { employees: query.data?.employees ?? [], loading: query.isLoading };
}

/**
 * Expense writes, each its own `useApiMutation` (audit FE-F3-12): the expense
 * invalidation is AWAITED before the caller's `await` resolves, `loading` ORs
 * the per-operation pending flags instead of sharing one boolean two writes
 * could race over, and a 5xx is reported like every other mutation's.
 *
 * A failed write rejects with the funnel's error: callers show it through
 * `httpErrorMessage(err, …)`, so the server's reason (a 400's message) reaches
 * the user. (A computed `error` field used to sit here unread — FE-F8-8.)
 *
 * A held edit/delete (`outcome: 'pending'`) changed no row, so it refreshes the
 * approval reads instead: the bells poll on a 5-minute timer and otherwise only
 * hear about a request when an admin RESOLVES one, so without this the
 * submitter's MyApprovalsBadge and the admin's ApprovalsBell sit stale and the
 * request looks lost.
 */
type HoldOutcome = { outcome: 'applied' | 'pending' };

const afterHoldableWrite = (data: { outcome: string }) =>
  data.outcome === 'pending' ? [qk.approvals.all()] : [qk.expenses.all()];

export function useExpenseMutations(): {
  createExpense: (expenseData: ExpenseData) => Promise<expenseContract.CreateExpenseResponse>;
  updateExpense: (id: number, expenseData: ExpenseData) => Promise<HoldOutcome>;
  deleteExpense: (id: number) => Promise<HoldOutcome>;
  loading: boolean;
} {
  const create = useApiMutation({
    mutationFn: (expenseData: ExpenseData) =>
      postJSON<expenseContract.CreateExpenseResponse>('/api/expenses', expenseData, { schema: expenseContract.createExpense.response }),
    invalidate: [qk.expenses.all()],
  });
  const update = useApiMutation({
    mutationFn: ({ id, expenseData }: { id: number; expenseData: ExpenseData }) =>
      putJSON<{ outcome: string }>(`/api/expenses/${id}`, expenseData, { schema: expenseContract.updateExpense.response }),
    invalidate: afterHoldableWrite,
  });
  const remove = useApiMutation({
    mutationFn: (id: number) =>
      deleteJSON<{ outcome: string }>(`/api/expenses/${id}`, { schema: expenseContract.deleteExpense.response }),
    invalidate: afterHoldableWrite,
  });

  const toHoldOutcome = (data: { outcome: string }): HoldOutcome => ({
    outcome: data.outcome === 'pending' ? 'pending' : 'applied',
  });

  return {
    createExpense: create.mutateAsync,
    updateExpense: (id, expenseData) => update.mutateAsync({ id, expenseData }).then(toHoldOutcome),
    deleteExpense: (id) => remove.mutateAsync(id).then(toHoldOutcome),
    loading: create.isPending || update.isPending || remove.isPending,
  };
}
