/**
 * Stand / Mini-Pharmacy database queries
 *
 * Migration Phase 4: translated to typed Kysely (PostgreSQL). This was a facade
 * BYPASSER (raw T-SQL via `executeQuery` + `new sql.Request(tx)` inside
 * `withTransaction`); all reads now run on `getKysely()` and the multi-statement
 * sale/void/restock/adjust transactions run on `withPgTransaction`. Positional
 * `ColumnValue` mappers are gone — queries return plain objects.
 *
 * type notes:
 * - All price/cost/total/stock columns are PG `integer` → JS number (no cast).
 * - `expiry_date` is PG `date` → the centralized parser (kysely.ts) returns a
 *   `'YYYY-MM-DD'` string at runtime, and codegen types it `string`; it's selected
 *   as-is and `StandItemRow.expiry_date` is typed `string | null` to match.
 * - `sale_date` / `movement_date` / `date_added` / `updated_at` are `timestamp` → Date.
 * - citext columns (`item_name`/`sku`/`barcode`/`movement_type`/…) make `=`/`LIKE`
 *   case-insensitive with no app churn (matches the old Arabic_CI_AS columns).
 */
import { sql } from 'kysely';
import { getKysely, withPgTransaction } from '../kysely.js';

// ============================================================================
// TYPES
// ============================================================================

interface StandItemFilters {
  search?: string;
  categoryId?: number;
  stockStatus?: 'in-stock' | 'low-stock' | 'out-of-stock';
  includeInactive?: boolean;
}

interface StandSaleFilters {
  startDate?: string;
  endDate?: string;
  cashierId?: number;
  personId?: number;
  // Optional pagination. When omitted, behavior is unchanged (all matching rows).
  limit?: number;
  offset?: number;
}

interface StandStockMovementFilters {
  startDate?: string;
  endDate?: string;
  movementType?: string;
}

// Row types that feed a `sendData(res, <looseObject>.response, …)` call are
// `type` aliases, NOT `interface`s: a `z.looseObject` response infers a string
// index signature, and an `interface` is not assignable to an index-signatured
// type (TS2345), whereas a `type` alias gets an implicit one. See the ⚠️ CRITICAL
// looseObject-index-signature Finding in docs/shared-contract-progress.md.
type StandCategoryRow = {
  category_id: number;
  category_name: string;
  is_active: boolean;
};

type StandItemRow = {
  item_id: number;
  item_name: string;
  sku: string | null;
  barcode: string | null;
  category_id: number | null;
  cost_price: number;
  sell_price: number;
  current_stock: number;
  reorder_level: number;
  expiry_date: string | null;
  unit: string | null;
  notes: string | null;
  is_active: boolean;
  date_added: Date;
  updated_at: Date | null;
  created_by: number | null;
  category_name: string | null;
};

type StandSaleRow = {
  sale_id: number;
  sale_date: Date;
  total_amount: number;
  total_cost: number;
  total_profit: number;
  amount_paid: number;
  change: number;
  payment_method: string;
  customer_note: string | null;
  person_id: number | null;
  cashier_id: number | null;
  voided_date: Date | null;
  voided_by: number | null;
  void_reason: string | null;
  patient_name: string | null;
  CashierName: string | null;
};

type StandSaleItemRow = {
  sale_item_id: number;
  sale_id: number;
  item_id: number;
  quantity: number;
  unit_price: number;
  unit_cost: number;
  line_total: number;
  item_name: string;
};

type StandMovementRow = {
  movement_id: number;
  item_id: number;
  movement_type: string;
  quantity: number;
  unit_cost: number | null;
  total_cost: number | null;
  related_sale_id: number | null;
  reason: string | null;
  movement_date: Date;
  performed_by: number | null;
  PerformedByName: string | null;
};

interface StandItemCreateData {
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
  createdBy?: number | null;
}

interface StandItemUpdateData {
  itemName?: string;
  sku?: string | null;
  barcode?: string | null;
  categoryId?: number | null;
  costPrice?: number;
  sellPrice?: number;
  reorderLevel?: number;
  expiryDate?: string | null;
  unit?: string | null;
  notes?: string | null;
}

interface SaleCreateInput {
  items: Array<{
    itemId: number;
    quantity: number;
    unitPrice: number;
    unitCost: number;
    lineTotal: number;
  }>;
  totalAmount: number;
  totalCost: number;
  totalProfit: number;
  amountPaid: number;
  change: number;
  paymentMethod: string;
  customerNote?: string | null;
  personId?: number | null;
  cashierId?: number | null;
}

interface DashboardKPIs {
  todaySalesCount: number;
  todayRevenue: number;
  todayProfit: number;
  lowStockCount: number;
  expiringSoonCount: number;
  totalInventoryValue: number;
}

// `type` (not interface) — feeds a looseObject `sendData` response (see note above).
type SalesSummaryRow = {
  sale_date: string;
  SalesCount: number;
  Revenue: number;
  Cost: number;
  Profit: number;
};

type TopItemRow = {
  item_id: number;
  item_name: string;
  TotalQuantity: number;
  TotalRevenue: number;
  total_profit: number;
};

// Shared SELECT shape for tblStandItems (+ joined category_name). Reused by every
// item read so the column projection stays identical across functions.
function selectStandItemColumns() {
  return [
    'i.item_id',
    'i.item_name',
    'i.sku',
    'i.barcode',
    'i.category_id',
    'i.cost_price',
    'i.sell_price',
    'i.current_stock',
    'i.reorder_level',
    'i.expiry_date',
    'i.unit',
    'i.notes',
    'i.is_active',
    'i.date_added',
    'i.updated_at',
    'i.created_by',
    'c.category_name',
  ] as const;
}

// ============================================================================
// CATEGORIES
// ============================================================================

export async function getStandCategories(): Promise<StandCategoryRow[]> {
  return getKysely()
    .selectFrom('stand_categories')
    .select(['category_id', 'category_name', 'is_active'])
    .where('is_active', '=', true)
    .orderBy('category_name')
    .execute();
}

export async function addStandCategory(name: string): Promise<{ category_id: number }> {
  const row = await getKysely()
    .insertInto('stand_categories')
    .values({ category_name: name })
    .returning('category_id')
    .executeTakeFirstOrThrow();

  return { category_id: row.category_id };
}

export async function updateStandCategory(
  id: number,
  data: { categoryName?: string; isActive?: boolean }
): Promise<void> {
  const set: { category_name?: string; is_active?: boolean } = {};

  if (data.categoryName !== undefined) set.category_name = data.categoryName;
  if (data.isActive !== undefined) set.is_active = data.isActive;

  if (Object.keys(set).length === 0) return;

  await getKysely()
    .updateTable('stand_categories')
    .set(set)
    .where('category_id', '=', id)
    .execute();
}

export async function deactivateStandCategory(id: number): Promise<void> {
  await updateStandCategory(id, { isActive: false });
}

// ============================================================================
// ITEMS
// ============================================================================

export async function getStandItems(filters: StandItemFilters = {}): Promise<StandItemRow[]> {
  let q = getKysely()
    .selectFrom('stand_items as i')
    .leftJoin('stand_categories as c', 'i.category_id', 'c.category_id')
    .select(selectStandItemColumns());

  if (!filters.includeInactive) {
    q = q.where('i.is_active', '=', true);
  }

  if (filters.search) {
    const pattern = `%${filters.search}%`;
    q = q.where((eb) =>
      eb.or([
        eb('i.item_name', 'like', pattern),
        eb('i.sku', 'like', pattern),
        eb('i.barcode', 'like', pattern),
      ])
    );
  }

  if (filters.categoryId) {
    q = q.where('i.category_id', '=', filters.categoryId);
  }

  if (filters.stockStatus === 'out-of-stock') {
    q = q.where('i.current_stock', '=', 0);
  } else if (filters.stockStatus === 'low-stock') {
    q = q
      .where('i.current_stock', '>', 0)
      .where((eb) => eb('i.current_stock', '<=', eb.ref('i.reorder_level')));
  } else if (filters.stockStatus === 'in-stock') {
    q = q.where((eb) => eb('i.current_stock', '>', eb.ref('i.reorder_level')));
  }

  return q.orderBy('i.item_name').execute() as Promise<StandItemRow[]>;
}

export async function getStandItemById(id: number): Promise<StandItemRow | null> {
  const row = await getKysely()
    .selectFrom('stand_items as i')
    .leftJoin('stand_categories as c', 'i.category_id', 'c.category_id')
    .select(selectStandItemColumns())
    .where('i.item_id', '=', id)
    .executeTakeFirst();

  return (row as StandItemRow | undefined) ?? null;
}

export async function getStandItemByBarcode(barcode: string): Promise<StandItemRow | null> {
  const row = await getKysely()
    .selectFrom('stand_items as i')
    .leftJoin('stand_categories as c', 'i.category_id', 'c.category_id')
    .select(selectStandItemColumns())
    .where('i.barcode', '=', barcode)
    .where('i.is_active', '=', true)
    .executeTakeFirst();

  return (row as StandItemRow | undefined) ?? null;
}

export async function addStandItem(data: StandItemCreateData): Promise<{ item_id: number }> {
  const initialStock = data.currentStock ?? 0;

  const row = await getKysely()
    .insertInto('stand_items')
    .values({
      item_name: data.itemName,
      sku: data.sku || null,
      barcode: data.barcode || null,
      category_id: data.categoryId || null,
      cost_price: data.costPrice,
      sell_price: data.sellPrice,
      current_stock: initialStock,
      reorder_level: data.reorderLevel ?? 1,
      expiry_date: data.expiryDate || null,
      unit: data.unit || null,
      notes: data.notes || null,
      created_by: data.createdBy || null,
    })
    .returning('item_id')
    .executeTakeFirstOrThrow();

  const itemId = row.item_id;

  // Insert initial stock movement if stock > 0
  if (initialStock > 0) {
    await addStockMovement({
      itemId,
      movementType: 'initial',
      quantity: initialStock,
      unitCost: data.costPrice,
      totalCost: initialStock * data.costPrice,
      reason: 'Initial stock',
      performedBy: data.createdBy || null,
    });
  }

  return { item_id: itemId };
}

export async function updateStandItem(id: number, data: StandItemUpdateData): Promise<void> {
  const set: Record<string, unknown> = {};

  if (data.itemName !== undefined) set.item_name = data.itemName;
  if (data.sku !== undefined) set.sku = data.sku;
  if (data.barcode !== undefined) set.barcode = data.barcode;
  if (data.categoryId !== undefined) set.category_id = data.categoryId;
  if (data.costPrice !== undefined) set.cost_price = data.costPrice;
  if (data.sellPrice !== undefined) set.sell_price = data.sellPrice;
  if (data.reorderLevel !== undefined) set.reorder_level = data.reorderLevel;
  if (data.expiryDate !== undefined) set.expiry_date = data.expiryDate;
  if (data.unit !== undefined) set.unit = data.unit;
  if (data.notes !== undefined) set.notes = data.notes;

  // No fields provided → skip the write (the trg_set_updated_at trigger now owns updated_at;
  // an empty SET would be invalid SQL and a no-op bump is undesirable).
  if (Object.keys(set).length === 0) return;

  await getKysely()
    .updateTable('stand_items')
    .set(set)
    .where('item_id', '=', id)
    .execute();
}

export async function softDeleteStandItem(id: number): Promise<void> {
  await getKysely()
    .updateTable('stand_items')
    .set({ is_active: false })
    .where('item_id', '=', id)
    .execute();
}

export async function getLowStockItems(): Promise<StandItemRow[]> {
  return getKysely()
    .selectFrom('stand_items as i')
    .leftJoin('stand_categories as c', 'i.category_id', 'c.category_id')
    .select(selectStandItemColumns())
    .where('i.is_active', '=', true)
    .where((eb) => eb('i.current_stock', '<=', eb.ref('i.reorder_level')))
    .orderBy('i.current_stock', 'asc')
    .execute() as Promise<StandItemRow[]>;
}

export async function getExpiringItems(daysAhead: number = 30): Promise<StandItemRow[]> {
  return getKysely()
    .selectFrom('stand_items as i')
    .leftJoin('stand_categories as c', 'i.category_id', 'c.category_id')
    .select(selectStandItemColumns())
    .where('i.is_active', '=', true)
    .where('i.expiry_date', 'is not', null)
    .where('i.expiry_date', '>=', sql<string>`current_date`)
    .where('i.expiry_date', '<=', sql<string>`current_date + (${daysAhead} * interval '1 day')`)
    .orderBy('i.expiry_date', 'asc')
    .execute() as Promise<StandItemRow[]>;
}

// ============================================================================
// SALES — TRANSACTIONAL
// ============================================================================

export async function createStandSaleTransaction(data: SaleCreateInput): Promise<{ sale_id: number }> {
  return withPgTransaction(async (trx) => {
    // 1. Insert sale header
    const saleRow = await trx
      .insertInto('stand_sales')
      .values({
        total_amount: data.totalAmount,
        total_cost: data.totalCost,
        total_profit: data.totalProfit,
        amount_paid: data.amountPaid,
        change: data.change,
        payment_method: data.paymentMethod,
        customer_note: data.customerNote || null,
        person_id: data.personId || null,
        cashier_id: data.cashierId || null,
      })
      .returning('sale_id')
      .executeTakeFirstOrThrow();

    const saleId = saleRow.sale_id;

    // 2-4. For each line item: insert sale item, decrement stock, insert movement
    for (const item of data.items) {
      await trx
        .insertInto('stand_sale_items')
        .values({
          sale_id: saleId,
          item_id: item.itemId,
          quantity: item.quantity,
          unit_price: item.unitPrice,
          unit_cost: item.unitCost,
          line_total: item.lineTotal,
        })
        .execute();

      // Atomic stock-decrement guard: only updates when stock is sufficient.
      // 0 rows ⇒ insufficient stock — abort the whole transaction.
      const stockResult = await trx
        .updateTable('stand_items')
        .set((eb) => ({
          current_stock: eb('current_stock', '-', item.quantity),
        }))
        .where('item_id', '=', item.itemId)
        .where('current_stock', '>=', item.quantity)
        .executeTakeFirst();

      if (Number(stockResult.numUpdatedRows) !== 1) {
        throw new Error(`INSUFFICIENT_STOCK:${item.itemId}`);
      }

      await trx
        .insertInto('stand_stock_movements')
        .values({
          item_id: item.itemId,
          movement_type: 'sale',
          quantity: -item.quantity,
          unit_cost: item.unitCost,
          related_sale_id: saleId,
          performed_by: data.cashierId || null,
        })
        .execute();
    }

    return { sale_id: saleId };
  });
}

export async function getStandSales(
  filters: StandSaleFilters = {}
): Promise<(StandSaleRow & { items_summary: string })[]> {
  let q = getKysely()
    .selectFrom('stand_sales as s')
    .leftJoin('patients as p', 's.person_id', 'p.person_id')
    .leftJoin('users as u', 's.cashier_id', 'u.user_id')
    .select([
      's.sale_id',
      's.sale_date',
      's.total_amount',
      's.total_cost',
      's.total_profit',
      's.amount_paid',
      's.change',
      's.payment_method',
      's.customer_note',
      's.person_id',
      's.cashier_id',
      's.voided_date',
      's.voided_by',
      's.void_reason',
      'p.patient_name',
      'u.full_name as CashierName',
      // Per-sale line-item summary, e.g. "Panadol ×2, Dental Floss". Correlated
      // subquery (cast item_name out of citext to text for concat) so the
      // history list shows what was sold without an N+1 detail fetch. coalesce
      // to '' so a hypothetical item-less sale stays a string, not NULL.
      sql<string>`coalesce((
        select string_agg(
          i.item_name::text || case when si.quantity > 1 then ' ×' || si.quantity else '' end,
          ', ' order by si.sale_item_id
        )
        from stand_sale_items si
        join stand_items i on i.item_id = si.item_id
        where si.sale_id = s.sale_id
      ), '')`.as('items_summary'),
    ]);

  if (filters.startDate) {
    q = q.where(sql`cast(${sql.ref('s.sale_date')} as date)`, '>=', sql<string>`${filters.startDate}`);
  }
  if (filters.endDate) {
    q = q.where(sql`cast(${sql.ref('s.sale_date')} as date)`, '<=', sql<string>`${filters.endDate}`);
  }
  if (filters.cashierId) {
    q = q.where('s.cashier_id', '=', filters.cashierId);
  }
  if (filters.personId) {
    q = q.where('s.person_id', '=', filters.personId);
  }

  q = q.orderBy('s.sale_date', 'desc').orderBy('s.sale_id', 'desc');

  // Opt-in pagination. 1000 caps a single page so a caller can't trigger an
  // unbounded scan.
  if (filters.limit != null) {
    const limit = Math.min(Math.max(Math.trunc(filters.limit), 1), 1000);
    const offset = Math.max(Math.trunc(filters.offset ?? 0), 0);
    q = q.limit(limit).offset(offset);
  }

  return q.execute() as Promise<(StandSaleRow & { items_summary: string })[]>;
}

export async function getStandSaleById(id: number): Promise<(StandSaleRow & { Items: StandSaleItemRow[] }) | null> {
  // Get the sale header
  const sale = await getKysely()
    .selectFrom('stand_sales as s')
    .leftJoin('patients as p', 's.person_id', 'p.person_id')
    .leftJoin('users as u', 's.cashier_id', 'u.user_id')
    .select([
      's.sale_id',
      's.sale_date',
      's.total_amount',
      's.total_cost',
      's.total_profit',
      's.amount_paid',
      's.change',
      's.payment_method',
      's.customer_note',
      's.person_id',
      's.cashier_id',
      's.voided_date',
      's.voided_by',
      's.void_reason',
      'p.patient_name',
      'u.full_name as CashierName',
    ])
    .where('s.sale_id', '=', id)
    .executeTakeFirst();

  if (!sale) return null;

  // Get line items
  const items = await getKysely()
    .selectFrom('stand_sale_items as si')
    .innerJoin('stand_items as i', 'si.item_id', 'i.item_id')
    .select([
      'si.sale_item_id',
      'si.sale_id',
      'si.item_id',
      'si.quantity',
      'si.unit_price',
      'si.unit_cost',
      'si.line_total',
      'i.item_name',
    ])
    .where('si.sale_id', '=', id)
    .orderBy('si.sale_item_id')
    .execute();

  return { ...(sale as StandSaleRow), Items: items as StandSaleItemRow[] };
}

export async function voidStandSale(
  saleId: number,
  reason: string,
  userId: number | null
): Promise<void> {
  return withPgTransaction(async (trx) => {
    const voidResult = await trx
      .updateTable('stand_sales')
      .set({ voided_date: sql`localtimestamp`, voided_by: userId, void_reason: reason })
      .where('sale_id', '=', saleId)
      .where('voided_date', 'is', null)
      .executeTakeFirst();

    // Row-level guard is the only atomic defense against a concurrent/duplicate void
    // (the caller's pre-check is TOCTOU). 0 rows ⇒ already voided — abort before
    // restocking, else current_stock is credited twice and duplicate movements written.
    if (Number(voidResult.numUpdatedRows) !== 1) {
      throw new Error(`ALREADY_VOIDED:${saleId}`);
    }

    const lineItems = await trx
      .selectFrom('stand_sale_items')
      .select(['item_id', 'quantity', 'unit_cost'])
      .where('sale_id', '=', saleId)
      .execute();

    for (const row of lineItems) {
      await trx
        .updateTable('stand_items')
        .set((eb) => ({
          current_stock: eb('current_stock', '+', row.quantity),
        }))
        .where('item_id', '=', row.item_id)
        .execute();

      await trx
        .insertInto('stand_stock_movements')
        .values({
          item_id: row.item_id,
          movement_type: 'void',
          quantity: row.quantity,
          unit_cost: row.unit_cost,
          related_sale_id: saleId,
          reason: `Void: ${reason}`,
          performed_by: userId,
        })
        .execute();
    }
  });
}

// ============================================================================
// STOCK OPERATIONS
// ============================================================================

export async function addStockMovement(data: {
  itemId: number;
  movementType: string;
  quantity: number;
  unitCost?: number | null;
  totalCost?: number | null;
  relatedSaleId?: number | null;
  reason?: string | null;
  performedBy?: number | null;
}): Promise<void> {
  await getKysely()
    .insertInto('stand_stock_movements')
    .values({
      item_id: data.itemId,
      movement_type: data.movementType,
      quantity: data.quantity,
      unit_cost: data.unitCost ?? null,
      total_cost: data.totalCost ?? null,
      related_sale_id: data.relatedSaleId ?? null,
      reason: data.reason ?? null,
      performed_by: data.performedBy ?? null,
    })
    .execute();
}

export async function restockItem(
  itemId: number,
  quantity: number,
  unitCost: number,
  userId: number | null
): Promise<void> {
  return withPgTransaction(async (trx) => {
    await trx
      .updateTable('stand_items')
      .set((eb) => ({
        current_stock: eb('current_stock', '+', quantity),
      }))
      .where('item_id', '=', itemId)
      .execute();

    await trx
      .insertInto('stand_stock_movements')
      .values({
        item_id: itemId,
        movement_type: 'restock',
        quantity: quantity,
        unit_cost: unitCost,
        total_cost: quantity * unitCost,
        performed_by: userId,
      })
      .execute();
  });
}

export async function adjustStock(
  itemId: number,
  delta: number,
  reason: string,
  userId: number | null
): Promise<void> {
  return withPgTransaction(async (trx) => {
    // Guard: only adjust when the result stays non-negative.
    // 0 rows ⇒ would go negative — abort the transaction.
    const result = await trx
      .updateTable('stand_items')
      .set((eb) => ({
        current_stock: eb('current_stock', '+', delta),
      }))
      .where('item_id', '=', itemId)
      .where(sql`("current_stock" + ${delta})`, '>=', 0)
      .executeTakeFirst();

    if (Number(result.numUpdatedRows) !== 1) {
      throw new Error('INSUFFICIENT_STOCK_FOR_ADJUSTMENT');
    }

    const movementType = delta < 0 ? 'waste' : 'adjustment';

    await trx
      .insertInto('stand_stock_movements')
      .values({
        item_id: itemId,
        movement_type: movementType,
        quantity: delta,
        reason: reason,
        performed_by: userId,
      })
      .execute();
  });
}

export async function getStockMovements(
  itemId: number,
  filters: StandStockMovementFilters = {}
): Promise<StandMovementRow[]> {
  let q = getKysely()
    .selectFrom('stand_stock_movements as m')
    .leftJoin('users as u', 'm.performed_by', 'u.user_id')
    .select([
      'm.movement_id',
      'm.item_id',
      'm.movement_type',
      'm.quantity',
      'm.unit_cost',
      'm.total_cost',
      'm.related_sale_id',
      'm.reason',
      'm.movement_date',
      'm.performed_by',
      'u.full_name as PerformedByName',
    ])
    .where('m.item_id', '=', itemId);

  if (filters.startDate) {
    q = q.where(sql`cast(${sql.ref('m.movement_date')} as date)`, '>=', sql<string>`${filters.startDate}`);
  }
  if (filters.endDate) {
    q = q.where(sql`cast(${sql.ref('m.movement_date')} as date)`, '<=', sql<string>`${filters.endDate}`);
  }
  if (filters.movementType) {
    q = q.where('m.movement_type', '=', filters.movementType);
  }

  q = q.orderBy('m.movement_date', 'desc').orderBy('m.movement_id', 'desc');

  return q.execute() as Promise<StandMovementRow[]>;
}

// ============================================================================
// REPORTS / KPIs
// ============================================================================

export async function getStandDashboardKPIs(): Promise<DashboardKPIs> {
  const db = getKysely();

  const todayPredicate = sql<boolean>`cast("sale_date" as date) = current_date`;

  const todayStats = await db
    .selectFrom('stand_sales')
    .select((eb) => [
      eb.fn.countAll().as('TodaySalesCount'),
      eb.fn.coalesce(eb.fn.sum('total_amount'), sql<number>`0`).as('TodayRevenue'),
      eb.fn.coalesce(eb.fn.sum('total_profit'), sql<number>`0`).as('TodayProfit'),
    ])
    .where(todayPredicate)
    .where('voided_date', 'is', null)
    .executeTakeFirstOrThrow();

  const lowStock = await db
    .selectFrom('stand_items')
    .select((eb) => eb.fn.countAll().as('cnt'))
    .where('is_active', '=', true)
    .where((eb) => eb('current_stock', '<=', eb.ref('reorder_level')))
    .executeTakeFirstOrThrow();

  const expiring = await db
    .selectFrom('stand_items')
    .select((eb) => eb.fn.countAll().as('cnt'))
    .where('is_active', '=', true)
    .where('expiry_date', 'is not', null)
    .where('expiry_date', '>=', sql<string>`current_date`)
    .where('expiry_date', '<=', sql<string>`current_date + interval '30 day'`)
    .executeTakeFirstOrThrow();

  const inventoryValue = await db
    .selectFrom('stand_items')
    .select((eb) =>
      eb.fn
        .coalesce(eb.fn.sum(sql<number>`"current_stock" * "cost_price"`), sql<number>`0`)
        .as('TotalInventoryValue')
    )
    .where('is_active', '=', true)
    .executeTakeFirstOrThrow();

  return {
    todaySalesCount: Number(todayStats.TodaySalesCount),
    todayRevenue: Number(todayStats.TodayRevenue),
    todayProfit: Number(todayStats.TodayProfit),
    lowStockCount: Number(lowStock.cnt),
    expiringSoonCount: Number(expiring.cnt),
    totalInventoryValue: Number(inventoryValue.TotalInventoryValue),
  };
}

export async function getStandSalesSummary(
  startDate: string,
  endDate: string
): Promise<SalesSummaryRow[]> {
  const rows = await getKysely()
    .selectFrom('stand_sales')
    .select((eb) => [
      sql<string>`to_char("sale_date", 'YYYY-MM-DD')`.as('sale_date'),
      eb.fn.countAll().as('SalesCount'),
      eb.fn.sum('total_amount').as('Revenue'),
      eb.fn.sum('total_cost').as('Cost'),
      eb.fn.sum('total_profit').as('Profit'),
    ])
    .where(sql`cast("sale_date" as date)`, '>=', sql<string>`${startDate}`)
    .where(sql`cast("sale_date" as date)`, '<=', sql<string>`${endDate}`)
    .where('voided_date', 'is', null)
    .groupBy(sql`to_char("sale_date", 'YYYY-MM-DD')`)
    .orderBy('sale_date')
    .execute();

  return rows.map((r) => ({
    sale_date: r.sale_date,
    SalesCount: Number(r.SalesCount),
    Revenue: Number(r.Revenue),
    Cost: Number(r.Cost),
    Profit: Number(r.Profit),
  }));
}

export async function getTopSellingItems(
  startDate: string,
  endDate: string,
  limit: number = 10
): Promise<TopItemRow[]> {
  const rows = await getKysely()
    .selectFrom('stand_sale_items as si')
    .innerJoin('stand_items as i', 'si.item_id', 'i.item_id')
    .innerJoin('stand_sales as s', 'si.sale_id', 's.sale_id')
    .select((eb) => [
      'si.item_id',
      'i.item_name',
      eb.fn.sum('si.quantity').as('TotalQuantity'),
      eb.fn.sum('si.line_total').as('TotalRevenue'),
      eb.fn.sum(sql<number>`si."line_total" - (si."quantity" * si."unit_cost")`).as('total_profit'),
    ])
    .where(sql`cast(${sql.ref('s.sale_date')} as date)`, '>=', sql<string>`${startDate}`)
    .where(sql`cast(${sql.ref('s.sale_date')} as date)`, '<=', sql<string>`${endDate}`)
    .where('s.voided_date', 'is', null)
    .groupBy(['si.item_id', 'i.item_name'])
    .orderBy('TotalQuantity', 'desc')
    .limit(limit)
    .execute();

  return rows.map((r) => ({
    item_id: r.item_id,
    item_name: r.item_name,
    TotalQuantity: Number(r.TotalQuantity),
    TotalRevenue: Number(r.TotalRevenue),
    total_profit: Number(r.total_profit),
  }));
}

export async function getStandPurchasesSummary(
  startDate: string,
  endDate: string
): Promise<{ totalPurchases: number; restockCount: number }> {
  const row = await getKysely()
    .selectFrom('stand_stock_movements')
    .select((eb) => [
      eb.fn.coalesce(eb.fn.sum('total_cost'), sql<number>`0`).as('TotalPurchases'),
      eb.fn.countAll().as('RestockCount'),
    ])
    .where('movement_type', '=', 'restock')
    .where(sql`cast("movement_date" as date)`, '>=', sql<string>`${startDate}`)
    .where(sql`cast("movement_date" as date)`, '<=', sql<string>`${endDate}`)
    .executeTakeFirstOrThrow();

  return {
    totalPurchases: Number(row.TotalPurchases),
    restockCount: Number(row.RestockCount),
  };
}
