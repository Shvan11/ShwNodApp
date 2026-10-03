/**
 * Custom hooks for Stand / Mini-Pharmacy
 *
 * Reads are thin wrappers over the React Query `queryOptions` factories in
 * `query/queries.ts` — so the cache is shared/deduped across screens and a write
 * on one screen refreshes every other. Mutations are `useApiMutation`s that
 * write via `core/http` then invalidate `qk.stand.all()` (the hierarchical
 * parent that covers items, sales, categories, dashboard, movements & reports).
 */
import { useState, useCallback } from 'react';
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
// boundary at runtime — H11). Request/filter shapes stay frontend-owned below.

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

export interface StandItemCreateData {
  itemName: string;
  sku?: string | null;
  barcode?: string | null;
  categoryId?: number | null;
  costPrice: number;
  sellPrice: number;
  currentStock?: number;
  reorderLevel?: number;
  expiryDate?: string | null;
  unit?: string | null;
  notes?: string | null;
}

interface SaleCreateData {
  items: Array<{ itemId: number; quantity: number }>;
  amountPaid: number;
  paymentMethod?: string;
  customerNote?: string | null;
  personId?: number | null;
}

// ============================================================================
// ITEMS
// ============================================================================

export function useStandItems(filters: StandItemFilters = {}): {
  items: StandItem[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
} {
  const query = useQuery(standItemsQuery(filters));
  return {
    items: query.data ?? [],
    loading: query.isLoading,
    error: query.error ? httpErrorMessage(query.error, 'Failed to fetch items') : null,
    refetch: async () => { await query.refetch(); },
  };
}

export function useStandItemByBarcode(): {
  lookupByBarcode: (barcode: string) => Promise<StandItem | null>;
  loading: boolean;
  error: string | null;
} {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lookupByBarcode = useCallback(async (barcode: string): Promise<StandItem | null> => {
    try {
      setLoading(true);
      setError(null);
      return await fetchJSON<StandItem>(`/api/stand/items/barcode/${encodeURIComponent(barcode)}`, { schema: standContract.itemByBarcode.response });
    } catch (err) {
      // 404 is a genuine "no such barcode", not an error — keep returning null.
      if ((err as HttpError).status === 404) return null;
      // Surface real failures (network/5xx) to the caller instead of masking
      // them as "not found" — only a 404 above means a genuinely unknown barcode.
      setError(httpErrorMessage(err, 'Barcode lookup failed'));
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { lookupByBarcode, loading, error };
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
} {
  const query = useQuery(standSaleQuery(id));
  return {
    sale: query.data ?? null,
    loading: query.isLoading,
    error: query.error ? httpErrorMessage(query.error, 'Failed to fetch sale') : null,
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
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
} {
  const query = useQuery(expiringItemsQuery(daysAhead));
  return {
    items: query.data ?? [],
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
  createItem: (data: StandItemCreateData) => Promise<{ item_id: number }>;
  updateItem: (id: number, data: Partial<StandItemCreateData>) => Promise<void>;
  deleteItem: (id: number) => Promise<void>;
  restockItem: (id: number, quantity: number, unitCost: number) => Promise<void>;
  adjustStock: (id: number, delta: number, reason: string) => Promise<void>;
  loading: boolean;
} {
  const create = useApiMutation({
    mutationFn: (data: StandItemCreateData) =>
      postJSON<{ item_id: number }>('/api/stand/items', data, { schema: standContract.createItem.response }),
    invalidate: STAND_KEYS,
  });
  const update = useApiMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<StandItemCreateData> }) => {
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
  const restock = useApiMutation({
    mutationFn: async ({ id, quantity, unitCost }: { id: number; quantity: number; unitCost: number }) => {
      await postJSON(`/api/stand/items/${id}/restock`, { quantity, unitCost });
    },
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
    restockItem: (id, quantity, unitCost) => restock.mutateAsync({ id, quantity, unitCost }),
    adjustStock: (id, delta, reason) => adjust.mutateAsync({ id, delta, reason }),
    loading: create.isPending || update.isPending || remove.isPending || restock.isPending || adjust.isPending,
  };
}

// ============================================================================
// SALE MUTATIONS
// ============================================================================

/** See `useStandItemMutations` for why each write is its own `useApiMutation`. */
export function useStandSaleMutations(): {
  createSale: (data: SaleCreateData) => Promise<StandSaleResult>;
  voidSale: (id: number, reason: string) => Promise<void>;
  loading: boolean;
} {
  const create = useApiMutation({
    mutationFn: (data: SaleCreateData) =>
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
  createCategory: (name: string) => Promise<void>;
  updateCategory: (id: number, data: { categoryName?: string }) => Promise<void>;
  deleteCategory: (id: number) => Promise<void>;
  loading: boolean;
} {
  const create = useApiMutation({
    mutationFn: async (name: string) => {
      await postJSON('/api/stand/categories', { name });
    },
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
