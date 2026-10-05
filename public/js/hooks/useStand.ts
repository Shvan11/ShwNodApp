/**
 * Custom hooks for Stand / Mini-Pharmacy
 *
 * Reads are thin wrappers over the React Query `queryOptions` factories in
 * `query/queries.ts` — so the cache is shared/deduped across screens and a write
 * on one screen refreshes every other. Mutations are `useApiMutation`s that
 * write via `core/http` then invalidate `qk.stand.all()` (the hierarchical
 * parent that covers items, sales, categories, dashboard, movements & reports).
 */
import { useQuery } from '@tanstack/react-query';
import { fetchJSON, postJSON, putJSON, deleteJSON, httpErrorMessage, type HttpError } from '@/core/http';
import * as standContract from '@shared/contracts/stand.contract';
import { qk } from '@/query/keys';
import { useApiMutation } from '@/query/useApiMutation';
import {
  standItemsQuery,
  standCategoriesQuery,
  standDashboardQuery,
  standSalesQuery,
  standSaleQuery,
  lowStockItemsQuery,
  expiringItemsQuery,
  stockMovementsQuery,
  standReportSummaryQuery,
  topSellingItemsQuery,
} from '@/query/queries';

// ============================================================================
// TYPES
// ============================================================================
//
// Response shapes are the single source of truth in the shared contract
// (shared/contracts/stand.contract.ts), re-exported here so existing component
// imports (`from '../../hooks/useStand'`) keep resolving unchanged. The reads'
// `queryOptions` factories (query/queries.ts) pair the contract-inferred type
// with `{ schema: …response }` (the generic types it; the schema validates the
// boundary at runtime — H11). The request bodies are the contract's too
// (`CreateItemBody`, `UpdateItemBody`, `CreateSaleBody`); only the two filter
// shapes, which build query strings, are frontend-owned below.

export type {
  StandCategory,
  StandItem,
  StandSale,
  StandSaleItem,
  StandSaleWithItems,
  StandStockMovement,
  StandDashboardKPIs,
  SalesSummaryRow,
  TopItemRow,
  StandReportData,
  StandSaleResult,
  CreateItemBody,
  UpdateItemBody,
  CreateSaleBody,
} from '@shared/contracts/stand.contract';
import type {
  StandItem,
  StandCategory,
  StandSale,
  StandSaleWithItems,
  StandStockMovement,
  StandDashboardKPIs,
  TopItemRow,
  StandReportData,
  StandSaleResult,
  CreateItemBody,
  UpdateItemBody,
  CreateSaleBody,
} from '@shared/contracts/stand.contract';

export interface StandItemFilters {
  search?: string;
  categoryId?: number;
  stockStatus?: 'in-stock' | 'low-stock' | 'out-of-stock';
  includeInactive?: boolean;
}

export interface StandSaleFilters {
  startDate?: string;
  endDate?: string;
  cashierId?: number;
  personId?: number;
}


// ============================================================================
// ITEMS
// ============================================================================

export function useStandItems(filters: StandItemFilters = {}): {
  items: StandItem[];
  /** When the list was read — expiry badges are judged against that day. */
  asOf: number;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
} {
  const query = useQuery(standItemsQuery(filters));
  return {
    items: query.data ?? [],
    asOf: query.dataUpdatedAt,
    loading: query.isLoading,
    error: query.error ? httpErrorMessage(query.error, 'Failed to fetch items') : null,
    refetch: async () => { await query.refetch(); },
  };
}

/**
 * The active item carrying this barcode, or null for a genuinely unknown one (404).
 * A real failure (network/5xx) rejects so the caller can say so instead of "not found".
 * A plain function: its old hook wrapper kept a `loading`/`error` pair nobody read.
 */
export async function lookupStandItemByBarcode(barcode: string): Promise<StandItem | null> {
  try {
    return await fetchJSON<StandItem>(`/api/stand/items/barcode/${encodeURIComponent(barcode)}`, {
      schema: standContract.itemByBarcode.response,
    });
  } catch (err) {
    if ((err as HttpError).status === 404) return null;
    throw err;
  }
}

// ============================================================================
// CATEGORIES
// ============================================================================

export function useStandCategories(): {
  categories: StandCategory[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
} {
  const query = useQuery(standCategoriesQuery());
  return {
    categories: query.data ?? [],
    loading: query.isLoading,
    error: query.error ? httpErrorMessage(query.error, 'Failed to fetch categories') : null,
    refetch: async () => { await query.refetch(); },
  };
}

// ============================================================================
// DASHBOARD KPIs
// ============================================================================

export function useStandDashboardKPIs(): {
  kpis: StandDashboardKPIs | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
} {
  const query = useQuery(standDashboardQuery());
  return {
    kpis: query.data ?? null,
    loading: query.isLoading,
    error: query.error ? httpErrorMessage(query.error, 'Failed to fetch KPIs') : null,
    refetch: async () => { await query.refetch(); },
  };
}

// ============================================================================
// SALES
// ============================================================================

export function useStandSales(filters: StandSaleFilters = {}): {
  sales: StandSale[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
} {
  const query = useQuery(standSalesQuery(filters));
  return {
    sales: query.data ?? [],
    loading: query.isLoading,
    error: query.error ? httpErrorMessage(query.error, 'Failed to fetch sales') : null,
    refetch: async () => { await query.refetch(); },
  };
}

export function useStandSale(id: number | null): {
  sale: StandSaleWithItems | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
} {
  const query = useQuery(standSaleQuery(id));
  return {
    sale: query.data ?? null,
    loading: query.isLoading,
    error: query.error ? httpErrorMessage(query.error, 'Failed to fetch sale') : null,
    refetch: async () => { await query.refetch(); },
  };
}

// ============================================================================
// LOW STOCK & EXPIRING
// ============================================================================

export function useLowStockItems(): {
  items: StandItem[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
} {
  const query = useQuery(lowStockItemsQuery());
  return {
    items: query.data ?? [],
    loading: query.isLoading,
    error: query.error ? httpErrorMessage(query.error, 'Failed to fetch low-stock items') : null,
    refetch: async () => { await query.refetch(); },
  };
}

export function useExpiringItems(daysAhead: number = 30): {
  items: StandItem[];
  /** When the list was read — the panel counts "days left" from it, not from its mount. */
  asOf: number;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
} {
  const query = useQuery(expiringItemsQuery(daysAhead));
  return {
    items: query.data ?? [],
    asOf: query.dataUpdatedAt,
    loading: query.isLoading,
    error: query.error ? httpErrorMessage(query.error, 'Failed to fetch expiring items') : null,
    refetch: async () => { await query.refetch(); },
  };
}

// ============================================================================
// STOCK MOVEMENTS
// ============================================================================

export function useStockMovements(itemId: number | null): {
  movements: StandStockMovement[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
} {
  const query = useQuery(stockMovementsQuery(itemId));
  return {
    movements: query.data ?? [],
    loading: query.isLoading,
    error: query.error ? httpErrorMessage(query.error, 'Failed to fetch stock movements') : null,
    refetch: async () => { await query.refetch(); },
  };
}

// ============================================================================
// ITEM MUTATIONS
// ============================================================================

/**
 * Each write is its own `useApiMutation`, so: the stand invalidation is AWAITED
 * before the caller's `await` resolves (a modal closing on that await no longer
 * shows the stale list for a beat); `loading` ORs the per-operation pending
 * flags (one shared boolean let the first write to settle clear a spinner the
 * other still owned); and a 5xx is reported like every other mutation's. A
 * failure rejects with the funnel's error — callers show it through
 * `httpErrorMessage(err, …)`. (An `error` field used to sit here unread — FE-F3-12.)
 */
const STAND_KEYS = [qk.stand.all()];

export function useStandItemMutations(): {
  createItem: (data: CreateItemBody) => Promise<{ item_id: number }>;
  updateItem: (id: number, data: UpdateItemBody) => Promise<void>;
  deleteItem: (id: number) => Promise<void>;
  reactivateItem: (id: number) => Promise<void>;
  /** Resolves with the item's new (weighted-average) cost. */
  restockItem: (id: number, quantity: number, unitCost: number) => Promise<{ costPrice: number }>;
  adjustStock: (id: number, delta: number, reason: string) => Promise<void>;
  loading: boolean;
} {
  const create = useApiMutation({
    mutationFn: (data: CreateItemBody) =>
      postJSON<{ item_id: number }>('/api/stand/items', data, { schema: standContract.createItem.response }),
    invalidate: STAND_KEYS,
  });
  const update = useApiMutation({
    mutationFn: async ({ id, data }: { id: number; data: UpdateItemBody }) => {
      await putJSON(`/api/stand/items/${id}`, data);
    },
    invalidate: STAND_KEYS,
  });
  const remove = useApiMutation({
    mutationFn: async (id: number) => {
      await deleteJSON(`/api/stand/items/${id}`);
    },
    invalidate: STAND_KEYS,
  });
  const reactivate = useApiMutation({
    mutationFn: async (id: number) => {
      await postJSON(`/api/stand/items/${id}/reactivate`, {});
    },
    invalidate: STAND_KEYS,
  });
  const restock = useApiMutation({
    mutationFn: ({ id, quantity, unitCost }: { id: number; quantity: number; unitCost: number }) =>
      postJSON<{ costPrice: number }>(`/api/stand/items/${id}/restock`, { quantity, unitCost }, {
        schema: standContract.restock.response,
      }),
    invalidate: STAND_KEYS,
  });
  const adjust = useApiMutation({
    mutationFn: async ({ id, delta, reason }: { id: number; delta: number; reason: string }) => {
      await postJSON(`/api/stand/items/${id}/adjust`, { delta, reason });
    },
    invalidate: STAND_KEYS,
  });

  return {
    createItem: create.mutateAsync,
    updateItem: (id, data) => update.mutateAsync({ id, data }),
    deleteItem: remove.mutateAsync,
    reactivateItem: reactivate.mutateAsync,
    restockItem: (id, quantity, unitCost) => restock.mutateAsync({ id, quantity, unitCost }),
    adjustStock: (id, delta, reason) => adjust.mutateAsync({ id, delta, reason }),
    loading:
      create.isPending || update.isPending || remove.isPending || reactivate.isPending || restock.isPending || adjust.isPending,
  };
}

// ============================================================================
// SALE MUTATIONS
// ============================================================================

/** See `useStandItemMutations` for why each write is its own `useApiMutation`. */
export function useStandSaleMutations(): {
  createSale: (data: CreateSaleBody) => Promise<StandSaleResult>;
  voidSale: (id: number, reason: string) => Promise<void>;
  loading: boolean;
} {
  const create = useApiMutation({
    mutationFn: (data: CreateSaleBody) =>
      postJSON<StandSaleResult>('/api/stand/sales', data, { schema: standContract.createSale.response }),
    invalidate: STAND_KEYS,
  });
  const voidOne = useApiMutation({
    mutationFn: async ({ id, reason }: { id: number; reason: string }) => {
      await postJSON(`/api/stand/sales/${id}/void`, { reason });
    },
    invalidate: STAND_KEYS,
  });

  return {
    createSale: create.mutateAsync,
    voidSale: (id, reason) => voidOne.mutateAsync({ id, reason }),
    loading: create.isPending || voidOne.isPending,
  };
}

// ============================================================================
// REPORTS
// ============================================================================

export function useStandReportSummary(startDate: string | null, endDate: string | null): {
  data: StandReportData | null;
  loading: boolean;
  error: string | null;
} {
  const query = useQuery(standReportSummaryQuery(startDate, endDate));
  return {
    data: query.data ?? null,
    loading: query.isLoading,
    error: query.error ? httpErrorMessage(query.error, 'Failed to fetch report') : null,
  };
}

export function useTopSellingItems(startDate: string | null, endDate: string | null, limit: number = 10): {
  items: TopItemRow[];
  loading: boolean;
  error: string | null;
} {
  const query = useQuery(topSellingItemsQuery(startDate, endDate, limit));
  return {
    items: query.data ?? [],
    loading: query.isLoading,
    error: query.error ? httpErrorMessage(query.error, 'Failed to fetch top-selling items') : null,
  };
}

// ============================================================================
// CATEGORY MUTATIONS
// ============================================================================

/**
 * See `useStandItemMutations`. This one used to be `try/finally` with no error
 * surface at all; it now rejects exactly like its siblings (FE-F3-12).
 */
export function useStandCategoryMutations(): {
  /** `reactivated` = the name belonged to a deactivated category, which is back. */
  createCategory: (name: string) => Promise<{ category_id: number; reactivated: boolean }>;
  updateCategory: (id: number, data: { categoryName?: string }) => Promise<void>;
  deleteCategory: (id: number) => Promise<void>;
  loading: boolean;
} {
  const create = useApiMutation({
    mutationFn: (name: string) =>
      postJSON<{ category_id: number; reactivated: boolean }>('/api/stand/categories', { name }, {
        schema: standContract.createCategory.response,
      }),
    invalidate: STAND_KEYS,
  });
  const update = useApiMutation({
    mutationFn: async ({ id, data }: { id: number; data: { categoryName?: string } }) => {
      await putJSON(`/api/stand/categories/${id}`, data);
    },
    invalidate: STAND_KEYS,
  });
  const remove = useApiMutation({
    mutationFn: async (id: number) => {
      await deleteJSON(`/api/stand/categories/${id}`);
    },
    invalidate: STAND_KEYS,
  });

  return {
    createCategory: create.mutateAsync,
    updateCategory: (id, data) => update.mutateAsync({ id, data }),
    deleteCategory: remove.mutateAsync,
    loading: create.isPending || update.isPending || remove.isPending,
  };
}
