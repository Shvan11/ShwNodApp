/**
 * Custom hooks for Stand / Mini-Pharmacy
 * Handles all stand-related API calls with proper state management
 */
import { useState, useEffect, useCallback } from 'react';
import { fetchJSON, postJSON, putJSON, deleteJSON, httpErrorMessage, type HttpError } from '@/core/http';
import * as standContract from '@shared/contracts/stand.contract';

// ============================================================================
// TYPES
// ============================================================================
//
// Response shapes are the single source of truth in the shared contract
// (shared/contracts/stand.contract.ts), re-exported here so existing component
// imports (`from '../../hooks/useStand'`) keep resolving unchanged. Each typed
// read below pairs the contract-inferred generic with `{ schema: …response }`
// (the generic types it; the schema validates the boundary at runtime — H11).
// Request/filter shapes stay frontend-owned below.

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
  const [items, setItems] = useState<StandItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (filters.search) params.append('search', filters.search);
      if (filters.categoryId) params.append('categoryId', String(filters.categoryId));
      if (filters.stockStatus) params.append('stockStatus', filters.stockStatus);
      if (filters.includeInactive) params.append('includeInactive', 'true');

      const data = await fetchJSON<StandItem[]>(`/api/stand/items?${params}`, { schema: standContract.items.response });
      setItems(data);
    } catch (err) {
      setError(httpErrorMessage(err, 'Failed to fetch items'));
    } finally {
      setLoading(false);
    }
  }, [filters.search, filters.categoryId, filters.stockStatus, filters.includeInactive]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  return { items, loading, error, refetch: fetchItems };
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
  const [categories, setCategories] = useState<StandCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCategories = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchJSON<StandCategory[]>('/api/stand/categories', { schema: standContract.categories.response });
      setCategories(data);
    } catch (err) {
      setError(httpErrorMessage(err, 'Failed to fetch categories'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCategories(); }, [fetchCategories]);

  return { categories, loading, error, refetch: fetchCategories };
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
  const [kpis, setKpis] = useState<StandDashboardKPIs | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchKPIs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchJSON<StandDashboardKPIs>('/api/stand/dashboard', { schema: standContract.dashboard.response });
      setKpis(data);
    } catch (err) {
      setError(httpErrorMessage(err, 'Failed to fetch KPIs'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchKPIs(); }, [fetchKPIs]);

  return { kpis, loading, error, refetch: fetchKPIs };
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
  const [sales, setSales] = useState<StandSale[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSales = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (filters.startDate) params.append('startDate', filters.startDate);
      if (filters.endDate) params.append('endDate', filters.endDate);
      if (filters.cashierId) params.append('cashierId', String(filters.cashierId));
      if (filters.personId) params.append('personId', String(filters.personId));

      const data = await fetchJSON<StandSale[]>(`/api/stand/sales?${params}`, { schema: standContract.sales.response });
      setSales(data);
    } catch (err) {
      setError(httpErrorMessage(err, 'Failed to fetch sales'));
    } finally {
      setLoading(false);
    }
  }, [filters.startDate, filters.endDate, filters.cashierId, filters.personId]);

  useEffect(() => { fetchSales(); }, [fetchSales]);

  return { sales, loading, error, refetch: fetchSales };
}

export function useStandSale(id: number | null): {
  sale: StandSaleWithItems | null;
  loading: boolean;
  error: string | null;
} {
  const [sale, setSale] = useState<StandSaleWithItems | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) { setSale(null); setError(null); return; }

    const fetchSale = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchJSON<StandSaleWithItems>(`/api/stand/sales/${id}`, { schema: standContract.saleById.response });
        setSale(data);
      } catch (err) {
        setError(httpErrorMessage(err, 'Failed to fetch sale'));
      } finally {
        setLoading(false);
      }
    };

    fetchSale();
  }, [id]);

  return { sale, loading, error };
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
  const [items, setItems] = useState<StandItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setItems(await fetchJSON<StandItem[]>('/api/stand/items/low-stock', { schema: standContract.itemsLowStock.response }));
    } catch (err) {
      setError(httpErrorMessage(err, 'Failed to fetch low-stock items'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  return { items, loading, error, refetch: fetchItems };
}

export function useExpiringItems(daysAhead: number = 30): {
  items: StandItem[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
} {
  const [items, setItems] = useState<StandItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setItems(await fetchJSON<StandItem[]>(`/api/stand/items/expiring?days=${daysAhead}`, { schema: standContract.itemsExpiring.response }));
    } catch (err) {
      setError(httpErrorMessage(err, 'Failed to fetch expiring items'));
    } finally {
      setLoading(false);
    }
  }, [daysAhead]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  return { items, loading, error, refetch: fetchItems };
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
  const [movements, setMovements] = useState<StandStockMovement[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMovements = useCallback(async () => {
    if (!itemId) { setMovements([]); setError(null); return; }
    try {
      setLoading(true);
      setError(null);
      setMovements(await fetchJSON<StandStockMovement[]>(`/api/stand/items/${itemId}/movements`, { schema: standContract.itemMovements.response }));
    } catch (err) {
      setError(httpErrorMessage(err, 'Failed to fetch stock movements'));
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => { fetchMovements(); }, [fetchMovements]);

  return { movements, loading, error, refetch: fetchMovements };
}

// ============================================================================
// ITEM MUTATIONS
// ============================================================================

export function useStandItemMutations(onSuccess?: () => void): {
  createItem: (data: StandItemCreateData) => Promise<{ item_id: number }>;
  updateItem: (id: number, data: Partial<StandItemCreateData>) => Promise<void>;
  deleteItem: (id: number) => Promise<void>;
  restockItem: (id: number, quantity: number, unitCost: number) => Promise<void>;
  adjustStock: (id: number, delta: number, reason: string) => Promise<void>;
  loading: boolean;
  error: string | null;
} {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createItem = useCallback(async (data: StandItemCreateData): Promise<{ item_id: number }> => {
    try {
      setLoading(true); setError(null);
      const result = await postJSON<{ item_id: number }>('/api/stand/items', data, { schema: standContract.createItem.response });
      onSuccess?.();
      return result;
    } catch (err) {
      setError(httpErrorMessage(err, 'Failed to create item')); throw err;
    } finally { setLoading(false); }
  }, [onSuccess]);

  const updateItem = useCallback(async (id: number, data: Partial<StandItemCreateData>): Promise<void> => {
    try {
      setLoading(true); setError(null);
      await putJSON(`/api/stand/items/${id}`, data);
      onSuccess?.();
    } catch (err) {
      setError(httpErrorMessage(err, 'Failed to update item')); throw err;
    } finally { setLoading(false); }
  }, [onSuccess]);

  const deleteItem = useCallback(async (id: number): Promise<void> => {
    try {
      setLoading(true); setError(null);
      await deleteJSON(`/api/stand/items/${id}`);
      onSuccess?.();
    } catch (err) {
      setError(httpErrorMessage(err, 'Failed to delete item')); throw err;
    } finally { setLoading(false); }
  }, [onSuccess]);

  const restockItem = useCallback(async (id: number, quantity: number, unitCost: number): Promise<void> => {
    try {
      setLoading(true); setError(null);
      await postJSON(`/api/stand/items/${id}/restock`, { quantity, unitCost });
      onSuccess?.();
    } catch (err) {
      setError(httpErrorMessage(err, 'Failed to restock')); throw err;
    } finally { setLoading(false); }
  }, [onSuccess]);

  const adjustStock = useCallback(async (id: number, delta: number, reason: string): Promise<void> => {
    try {
      setLoading(true); setError(null);
      await postJSON(`/api/stand/items/${id}/adjust`, { delta, reason });
      onSuccess?.();
    } catch (err) {
      setError(httpErrorMessage(err, 'Failed to adjust stock')); throw err;
    } finally { setLoading(false); }
  }, [onSuccess]);

  return { createItem, updateItem, deleteItem, restockItem, adjustStock, loading, error };
}

// ============================================================================
// SALE MUTATIONS
// ============================================================================

export function useStandSaleMutations(onSuccess?: () => void): {
  createSale: (data: SaleCreateData) => Promise<StandSaleResult>;
  voidSale: (id: number, reason: string) => Promise<void>;
  loading: boolean;
  error: string | null;
} {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createSale = useCallback(async (data: SaleCreateData) => {
    try {
      setLoading(true); setError(null);
      const result = await postJSON<StandSaleResult>('/api/stand/sales', data, { schema: standContract.createSale.response });
      onSuccess?.();
      return result;
    } catch (err) {
      setError(httpErrorMessage(err, 'Failed to create sale')); throw err;
    } finally { setLoading(false); }
  }, [onSuccess]);

  const voidSale = useCallback(async (id: number, reason: string): Promise<void> => {
    try {
      setLoading(true); setError(null);
      await postJSON(`/api/stand/sales/${id}/void`, { reason });
      onSuccess?.();
    } catch (err) {
      setError(httpErrorMessage(err, 'Failed to void sale')); throw err;
    } finally { setLoading(false); }
  }, [onSuccess]);

  return { createSale, voidSale, loading, error };
}

// ============================================================================
// REPORTS
// ============================================================================

export function useStandReportSummary(startDate: string | null, endDate: string | null): {
  data: StandReportData | null;
  loading: boolean;
  error: string | null;
} {
  const [data, setData] = useState<StandReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!startDate || !endDate) { setData(null); return; }

    let cancelled = false;
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        const params = new URLSearchParams({ startDate, endDate });
        const json = await fetchJSON<StandReportData>(`/api/stand/reports/summary?${params}`, { schema: standContract.reportSummary.response });
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(httpErrorMessage(err, 'Failed to fetch report'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchData();
    return () => { cancelled = true; };
  }, [startDate, endDate]);

  return { data, loading, error };
}

export function useTopSellingItems(startDate: string | null, endDate: string | null, limit: number = 10): {
  items: TopItemRow[];
  loading: boolean;
  error: string | null;
} {
  const [items, setItems] = useState<TopItemRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!startDate || !endDate) { setItems([]); return; }

    let cancelled = false;
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        const params = new URLSearchParams({ startDate, endDate, limit: String(limit) });
        const json = await fetchJSON<TopItemRow[]>(`/api/stand/reports/top-items?${params}`, { schema: standContract.reportTopItems.response });
        if (!cancelled) setItems(json);
      } catch (err) {
        if (!cancelled) setError(httpErrorMessage(err, 'Failed to fetch top-selling items'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchData();
    return () => { cancelled = true; };
  }, [startDate, endDate, limit]);

  return { items, loading, error };
}

// ============================================================================
// CATEGORY MUTATIONS
// ============================================================================

export function useStandCategoryMutations(onSuccess?: () => void): {
  createCategory: (name: string) => Promise<void>;
  updateCategory: (id: number, data: { categoryName?: string }) => Promise<void>;
  deleteCategory: (id: number) => Promise<void>;
  loading: boolean;
} {
  const [loading, setLoading] = useState(false);

  const createCategory = useCallback(async (name: string) => {
    try {
      setLoading(true);
      await postJSON('/api/stand/categories', { name });
      onSuccess?.();
    } finally { setLoading(false); }
  }, [onSuccess]);

  const updateCategory = useCallback(async (id: number, data: { categoryName?: string }) => {
    try {
      setLoading(true);
      await putJSON(`/api/stand/categories/${id}`, data);
      onSuccess?.();
    } finally { setLoading(false); }
  }, [onSuccess]);

  const deleteCategory = useCallback(async (id: number) => {
    try {
      setLoading(true);
      await deleteJSON(`/api/stand/categories/${id}`);
      onSuccess?.();
    } finally { setLoading(false); }
  }, [onSuccess]);

  return { createCategory, updateCategory, deleteCategory, loading };
}
