/**
 * Stand / Mini-Pharmacy database queries
 *
 * Migration Phase 4: translated to typed Kysely (PostgreSQL). This was a facade
 * BYPASSER (raw T-SQL via `executeQuery` + `new sql.Request(tx)` inside
 * `withTransaction`); all reads now run on `getKysely()` and the multi-statement
 * sale/void/restock/adjust transactions run on `withPgTransaction`. Positional
 * `ColumnValue` mappers are gone — queries return plain objects.
 *
 * Type notes:
 * - All price/cost/total/stock columns are PG `integer` → JS number (no cast).
 * - `ExpiryDate` is PG `date` → the centralized parser (kysely.ts) returns a
 *   `'YYYY-MM-DD'` string at runtime (codegen mistypes it as Timestamp). We cast
 *   it to `string` on SELECT. NOTE: `StandItemRow.ExpiryDate` is declared `Date`,
 *   but the value is now a string — the documented Phase-4 date-string behavior.
 * - `SaleDate` / `MovementDate` / `DateAdded` / `ModifiedDate` are `timestamp` → Date.
 * - citext columns (`ItemName`/`SKU`/`Barcode`/`MovementType`/…) make `=`/`LIKE`
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

interface StandCategoryRow {
  CategoryID: number;
  CategoryName: string;
  IsActive: boolean;
}

interface StandItemRow {
  ItemID: number;
  ItemName: string;
  SKU: string | null;
  Barcode: string | null;
  CategoryID: number | null;
  CostPrice: number;
  SellPrice: number;
  CurrentStock: number;
  ReorderLevel: number;
  ExpiryDate: Date | null;
  Unit: string | null;
  Notes: string | null;
  IsActive: boolean;
  DateAdded: Date;
  ModifiedDate: Date | null;
  CreatedBy: number | null;
  CategoryName: string | null;
}

interface StandSaleRow {
  SaleID: number;
  SaleDate: Date;
  TotalAmount: number;
  TotalCost: number;
  TotalProfit: number;
  AmountPaid: number;
  Change: number;
  PaymentMethod: string;
  CustomerNote: string | null;
  PersonID: number | null;
  CashierID: number | null;
  VoidedDate: Date | null;
  VoidedBy: number | null;
  VoidReason: string | null;
  PatientName: string | null;
  CashierName: string | null;
}

interface StandSaleItemRow {
  SaleItemID: number;
  SaleID: number;
  ItemID: number;
  Quantity: number;
  UnitPrice: number;
  UnitCost: number;
  LineTotal: number;
  ItemName: string;
}

interface StandMovementRow {
  MovementID: number;
  ItemID: number;
  MovementType: string;
  Quantity: number;
  UnitCost: number | null;
  TotalCost: number | null;
  RelatedSaleID: number | null;
  Reason: string | null;
  MovementDate: Date;
  PerformedBy: number | null;
  PerformedByName: string | null;
}

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

interface SalesSummaryRow {
  SaleDate: string;
  SalesCount: number;
  Revenue: number;
  Cost: number;
  Profit: number;
}

interface TopItemRow {
  ItemID: number;
  ItemName: string;
  TotalQuantity: number;
  TotalRevenue: number;
  TotalProfit: number;
}

// Shared SELECT shape for tblStandItems (+ joined CategoryName). Reused by every
// item read so the column projection stays identical across functions.
function selectStandItemColumns() {
  return [
    'i.ItemID',
    'i.ItemName',
    'i.SKU',
    'i.Barcode',
    'i.CategoryID',
    'i.CostPrice',
    'i.SellPrice',
    'i.CurrentStock',
    'i.ReorderLevel',
    'i.Unit',
    'i.Notes',
    'i.IsActive',
    'i.DateAdded',
    'i.ModifiedDate',
    'i.CreatedBy',
    'c.CategoryName',
  ] as const;
}

// ============================================================================
// CATEGORIES
// ============================================================================

export async function getStandCategories(): Promise<StandCategoryRow[]> {
  return getKysely()
    .selectFrom('tblStandCategories')
    .select(['CategoryID', 'CategoryName', 'IsActive'])
    .where('IsActive', '=', true)
    .orderBy('CategoryName')
    .execute();
}

export async function addStandCategory(name: string): Promise<{ CategoryID: number }> {
  const row = await getKysely()
    .insertInto('tblStandCategories')
    .values({ CategoryName: name })
    .returning('CategoryID')
    .executeTakeFirstOrThrow();

  return { CategoryID: row.CategoryID };
}

export async function updateStandCategory(
  id: number,
  data: { categoryName?: string; isActive?: boolean }
): Promise<void> {
  const set: { CategoryName?: string; IsActive?: boolean } = {};

  if (data.categoryName !== undefined) set.CategoryName = data.categoryName;
  if (data.isActive !== undefined) set.IsActive = data.isActive;

  if (Object.keys(set).length === 0) return;

  await getKysely()
    .updateTable('tblStandCategories')
    .set(set)
    .where('CategoryID', '=', id)
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
    .selectFrom('tblStandItems as i')
    .leftJoin('tblStandCategories as c', 'i.CategoryID', 'c.CategoryID')
    .select((eb) => [
      ...selectStandItemColumns(),
      eb.ref('i.ExpiryDate').$castTo<string>().as('ExpiryDate'),
    ]);

  if (!filters.includeInactive) {
    q = q.where('i.IsActive', '=', true);
  }

  if (filters.search) {
    const pattern = `%${filters.search}%`;
    q = q.where((eb) =>
      eb.or([
        eb('i.ItemName', 'like', pattern),
        eb('i.SKU', 'like', pattern),
        eb('i.Barcode', 'like', pattern),
      ])
    );
  }

  if (filters.categoryId) {
    q = q.where('i.CategoryID', '=', filters.categoryId);
  }

  if (filters.stockStatus === 'out-of-stock') {
    q = q.where('i.CurrentStock', '=', 0);
  } else if (filters.stockStatus === 'low-stock') {
    q = q
      .where('i.CurrentStock', '>', 0)
      .where((eb) => eb('i.CurrentStock', '<=', eb.ref('i.ReorderLevel')));
  } else if (filters.stockStatus === 'in-stock') {
    q = q.where((eb) => eb('i.CurrentStock', '>', eb.ref('i.ReorderLevel')));
  }

  return q.orderBy('i.ItemName').execute() as unknown as Promise<StandItemRow[]>;
}

export async function getStandItemById(id: number): Promise<StandItemRow | null> {
  const row = await getKysely()
    .selectFrom('tblStandItems as i')
    .leftJoin('tblStandCategories as c', 'i.CategoryID', 'c.CategoryID')
    .select((eb) => [
      ...selectStandItemColumns(),
      eb.ref('i.ExpiryDate').$castTo<string>().as('ExpiryDate'),
    ])
    .where('i.ItemID', '=', id)
    .executeTakeFirst();

  return (row as unknown as StandItemRow | undefined) ?? null;
}

export async function getStandItemByBarcode(barcode: string): Promise<StandItemRow | null> {
  const row = await getKysely()
    .selectFrom('tblStandItems as i')
    .leftJoin('tblStandCategories as c', 'i.CategoryID', 'c.CategoryID')
    .select((eb) => [
      ...selectStandItemColumns(),
      eb.ref('i.ExpiryDate').$castTo<string>().as('ExpiryDate'),
    ])
    .where('i.Barcode', '=', barcode)
    .where('i.IsActive', '=', true)
    .executeTakeFirst();

  return (row as unknown as StandItemRow | undefined) ?? null;
}

export async function addStandItem(data: StandItemCreateData): Promise<{ ItemID: number }> {
  const initialStock = data.currentStock ?? 0;

  const row = await getKysely()
    .insertInto('tblStandItems')
    .values({
      ItemName: data.itemName,
      SKU: data.sku || null,
      Barcode: data.barcode || null,
      CategoryID: data.categoryId || null,
      CostPrice: data.costPrice,
      SellPrice: data.sellPrice,
      CurrentStock: initialStock,
      ReorderLevel: data.reorderLevel ?? 1,
      ExpiryDate: data.expiryDate || null,
      Unit: data.unit || null,
      Notes: data.notes || null,
      CreatedBy: data.createdBy || null,
    })
    .returning('ItemID')
    .executeTakeFirstOrThrow();

  const itemId = row.ItemID;

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

  return { ItemID: itemId };
}

export async function updateStandItem(id: number, data: StandItemUpdateData): Promise<void> {
  const set: Record<string, unknown> = { ModifiedDate: sql`localtimestamp` };

  if (data.itemName !== undefined) set.ItemName = data.itemName;
  if (data.sku !== undefined) set.SKU = data.sku;
  if (data.barcode !== undefined) set.Barcode = data.barcode;
  if (data.categoryId !== undefined) set.CategoryID = data.categoryId;
  if (data.costPrice !== undefined) set.CostPrice = data.costPrice;
  if (data.sellPrice !== undefined) set.SellPrice = data.sellPrice;
  if (data.reorderLevel !== undefined) set.ReorderLevel = data.reorderLevel;
  if (data.expiryDate !== undefined) set.ExpiryDate = data.expiryDate;
  if (data.unit !== undefined) set.Unit = data.unit;
  if (data.notes !== undefined) set.Notes = data.notes;

  await getKysely()
    .updateTable('tblStandItems')
    .set(set)
    .where('ItemID', '=', id)
    .execute();
}

export async function softDeleteStandItem(id: number): Promise<void> {
  await getKysely()
    .updateTable('tblStandItems')
    .set({ IsActive: false, ModifiedDate: sql`localtimestamp` })
    .where('ItemID', '=', id)
    .execute();
}

export async function getLowStockItems(): Promise<StandItemRow[]> {
  return getKysely()
    .selectFrom('tblStandItems as i')
    .leftJoin('tblStandCategories as c', 'i.CategoryID', 'c.CategoryID')
    .select((eb) => [
      ...selectStandItemColumns(),
      eb.ref('i.ExpiryDate').$castTo<string>().as('ExpiryDate'),
    ])
    .where('i.IsActive', '=', true)
    .where((eb) => eb('i.CurrentStock', '<=', eb.ref('i.ReorderLevel')))
    .orderBy('i.CurrentStock', 'asc')
    .execute() as unknown as Promise<StandItemRow[]>;
}

export async function getExpiringItems(daysAhead: number = 30): Promise<StandItemRow[]> {
  return getKysely()
    .selectFrom('tblStandItems as i')
    .leftJoin('tblStandCategories as c', 'i.CategoryID', 'c.CategoryID')
    .select((eb) => [
      ...selectStandItemColumns(),
      eb.ref('i.ExpiryDate').$castTo<string>().as('ExpiryDate'),
    ])
    .where('i.IsActive', '=', true)
    .where('i.ExpiryDate', 'is not', null)
    .where('i.ExpiryDate', '>=', sql<Date>`current_date`)
    .where('i.ExpiryDate', '<=', sql<Date>`current_date + (${daysAhead} * interval '1 day')`)
    .orderBy('i.ExpiryDate', 'asc')
    .execute() as unknown as Promise<StandItemRow[]>;
}

// ============================================================================
// SALES — TRANSACTIONAL
// ============================================================================

export async function createStandSaleTransaction(data: SaleCreateInput): Promise<{ SaleID: number }> {
  return withPgTransaction(async (trx) => {
    // 1. Insert sale header
    const saleRow = await trx
      .insertInto('tblStandSales')
      .values({
        TotalAmount: data.totalAmount,
        TotalCost: data.totalCost,
        TotalProfit: data.totalProfit,
        AmountPaid: data.amountPaid,
        Change: data.change,
        PaymentMethod: data.paymentMethod,
        CustomerNote: data.customerNote || null,
        PersonID: data.personId || null,
        CashierID: data.cashierId || null,
      })
      .returning('SaleID')
      .executeTakeFirstOrThrow();

    const saleId = saleRow.SaleID;

    // 2-4. For each line item: insert sale item, decrement stock, insert movement
    for (const item of data.items) {
      await trx
        .insertInto('tblStandSaleItems')
        .values({
          SaleID: saleId,
          ItemID: item.itemId,
          Quantity: item.quantity,
          UnitPrice: item.unitPrice,
          UnitCost: item.unitCost,
          LineTotal: item.lineTotal,
        })
        .execute();

      // Atomic stock-decrement guard: only updates when stock is sufficient.
      // 0 rows ⇒ insufficient stock — abort the whole transaction.
      const stockResult = await trx
        .updateTable('tblStandItems')
        .set((eb) => ({
          CurrentStock: eb('CurrentStock', '-', item.quantity),
          ModifiedDate: sql`localtimestamp`,
        }))
        .where('ItemID', '=', item.itemId)
        .where('CurrentStock', '>=', item.quantity)
        .executeTakeFirst();

      if (Number(stockResult.numUpdatedRows) !== 1) {
        throw new Error(`INSUFFICIENT_STOCK:${item.itemId}`);
      }

      await trx
        .insertInto('tblStandStockMovements')
        .values({
          ItemID: item.itemId,
          MovementType: 'sale',
          Quantity: -item.quantity,
          UnitCost: item.unitCost,
          RelatedSaleID: saleId,
          PerformedBy: data.cashierId || null,
        })
        .execute();
    }

    return { SaleID: saleId };
  });
}

export async function getStandSales(filters: StandSaleFilters = {}): Promise<StandSaleRow[]> {
  let q = getKysely()
    .selectFrom('tblStandSales as s')
    .leftJoin('tblpatients as p', 's.PersonID', 'p.PersonID')
    .leftJoin('tblUsers as u', 's.CashierID', 'u.UserID')
    .select([
      's.SaleID',
      's.SaleDate',
      's.TotalAmount',
      's.TotalCost',
      's.TotalProfit',
      's.AmountPaid',
      's.Change',
      's.PaymentMethod',
      's.CustomerNote',
      's.PersonID',
      's.CashierID',
      's.VoidedDate',
      's.VoidedBy',
      's.VoidReason',
      'p.PatientName',
      'u.FullName as CashierName',
    ]);

  if (filters.startDate) {
    q = q.where(sql`cast(${sql.ref('s.SaleDate')} as date)`, '>=', sql<Date>`${filters.startDate}`);
  }
  if (filters.endDate) {
    q = q.where(sql`cast(${sql.ref('s.SaleDate')} as date)`, '<=', sql<Date>`${filters.endDate}`);
  }
  if (filters.cashierId) {
    q = q.where('s.CashierID', '=', filters.cashierId);
  }
  if (filters.personId) {
    q = q.where('s.PersonID', '=', filters.personId);
  }

  q = q.orderBy('s.SaleDate', 'desc').orderBy('s.SaleID', 'desc');

  // Opt-in pagination. 1000 caps a single page so a caller can't trigger an
  // unbounded scan.
  if (filters.limit != null) {
    const limit = Math.min(Math.max(Math.trunc(filters.limit), 1), 1000);
    const offset = Math.max(Math.trunc(filters.offset ?? 0), 0);
    q = q.limit(limit).offset(offset);
  }

  return q.execute() as Promise<StandSaleRow[]>;
}

export async function getStandSaleById(id: number): Promise<(StandSaleRow & { Items: StandSaleItemRow[] }) | null> {
  // Get the sale header
  const sale = await getKysely()
    .selectFrom('tblStandSales as s')
    .leftJoin('tblpatients as p', 's.PersonID', 'p.PersonID')
    .leftJoin('tblUsers as u', 's.CashierID', 'u.UserID')
    .select([
      's.SaleID',
      's.SaleDate',
      's.TotalAmount',
      's.TotalCost',
      's.TotalProfit',
      's.AmountPaid',
      's.Change',
      's.PaymentMethod',
      's.CustomerNote',
      's.PersonID',
      's.CashierID',
      's.VoidedDate',
      's.VoidedBy',
      's.VoidReason',
      'p.PatientName',
      'u.FullName as CashierName',
    ])
    .where('s.SaleID', '=', id)
    .executeTakeFirst();

  if (!sale) return null;

  // Get line items
  const items = await getKysely()
    .selectFrom('tblStandSaleItems as si')
    .innerJoin('tblStandItems as i', 'si.ItemID', 'i.ItemID')
    .select([
      'si.SaleItemID',
      'si.SaleID',
      'si.ItemID',
      'si.Quantity',
      'si.UnitPrice',
      'si.UnitCost',
      'si.LineTotal',
      'i.ItemName',
    ])
    .where('si.SaleID', '=', id)
    .orderBy('si.SaleItemID')
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
      .updateTable('tblStandSales')
      .set({ VoidedDate: sql`localtimestamp`, VoidedBy: userId, VoidReason: reason })
      .where('SaleID', '=', saleId)
      .where('VoidedDate', 'is', null)
      .executeTakeFirst();

    // Row-level guard is the only atomic defense against a concurrent/duplicate void
    // (the caller's pre-check is TOCTOU). 0 rows ⇒ already voided — abort before
    // restocking, else CurrentStock is credited twice and duplicate movements written.
    if (Number(voidResult.numUpdatedRows) !== 1) {
      throw new Error(`ALREADY_VOIDED:${saleId}`);
    }

    const lineItems = await trx
      .selectFrom('tblStandSaleItems')
      .select(['ItemID', 'Quantity', 'UnitCost'])
      .where('SaleID', '=', saleId)
      .execute();

    for (const row of lineItems) {
      await trx
        .updateTable('tblStandItems')
        .set((eb) => ({
          CurrentStock: eb('CurrentStock', '+', row.Quantity),
          ModifiedDate: sql`localtimestamp`,
        }))
        .where('ItemID', '=', row.ItemID)
        .execute();

      await trx
        .insertInto('tblStandStockMovements')
        .values({
          ItemID: row.ItemID,
          MovementType: 'void',
          Quantity: row.Quantity,
          UnitCost: row.UnitCost,
          RelatedSaleID: saleId,
          Reason: `Void: ${reason}`,
          PerformedBy: userId,
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
    .insertInto('tblStandStockMovements')
    .values({
      ItemID: data.itemId,
      MovementType: data.movementType,
      Quantity: data.quantity,
      UnitCost: data.unitCost ?? null,
      TotalCost: data.totalCost ?? null,
      RelatedSaleID: data.relatedSaleId ?? null,
      Reason: data.reason ?? null,
      PerformedBy: data.performedBy ?? null,
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
      .updateTable('tblStandItems')
      .set((eb) => ({
        CurrentStock: eb('CurrentStock', '+', quantity),
        ModifiedDate: sql`localtimestamp`,
      }))
      .where('ItemID', '=', itemId)
      .execute();

    await trx
      .insertInto('tblStandStockMovements')
      .values({
        ItemID: itemId,
        MovementType: 'restock',
        Quantity: quantity,
        UnitCost: unitCost,
        TotalCost: quantity * unitCost,
        PerformedBy: userId,
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
      .updateTable('tblStandItems')
      .set((eb) => ({
        CurrentStock: eb('CurrentStock', '+', delta),
        ModifiedDate: sql`localtimestamp`,
      }))
      .where('ItemID', '=', itemId)
      .where(sql`("CurrentStock" + ${delta})`, '>=', 0)
      .executeTakeFirst();

    if (Number(result.numUpdatedRows) !== 1) {
      throw new Error('INSUFFICIENT_STOCK_FOR_ADJUSTMENT');
    }

    const movementType = delta < 0 ? 'waste' : 'adjustment';

    await trx
      .insertInto('tblStandStockMovements')
      .values({
        ItemID: itemId,
        MovementType: movementType,
        Quantity: delta,
        Reason: reason,
        PerformedBy: userId,
      })
      .execute();
  });
}

export async function getStockMovements(
  itemId: number,
  filters: StandStockMovementFilters = {}
): Promise<StandMovementRow[]> {
  let q = getKysely()
    .selectFrom('tblStandStockMovements as m')
    .leftJoin('tblUsers as u', 'm.PerformedBy', 'u.UserID')
    .select([
      'm.MovementID',
      'm.ItemID',
      'm.MovementType',
      'm.Quantity',
      'm.UnitCost',
      'm.TotalCost',
      'm.RelatedSaleID',
      'm.Reason',
      'm.MovementDate',
      'm.PerformedBy',
      'u.FullName as PerformedByName',
    ])
    .where('m.ItemID', '=', itemId);

  if (filters.startDate) {
    q = q.where(sql`cast(${sql.ref('m.MovementDate')} as date)`, '>=', sql<Date>`${filters.startDate}`);
  }
  if (filters.endDate) {
    q = q.where(sql`cast(${sql.ref('m.MovementDate')} as date)`, '<=', sql<Date>`${filters.endDate}`);
  }
  if (filters.movementType) {
    q = q.where('m.MovementType', '=', filters.movementType);
  }

  q = q.orderBy('m.MovementDate', 'desc').orderBy('m.MovementID', 'desc');

  return q.execute() as Promise<StandMovementRow[]>;
}

// ============================================================================
// REPORTS / KPIs
// ============================================================================

export async function getStandDashboardKPIs(): Promise<DashboardKPIs> {
  const db = getKysely();

  const todayPredicate = sql<boolean>`cast("SaleDate" as date) = current_date`;

  const todayStats = await db
    .selectFrom('tblStandSales')
    .select((eb) => [
      eb.fn.countAll().as('TodaySalesCount'),
      eb.fn.coalesce(eb.fn.sum('TotalAmount'), sql<number>`0`).as('TodayRevenue'),
      eb.fn.coalesce(eb.fn.sum('TotalProfit'), sql<number>`0`).as('TodayProfit'),
    ])
    .where(todayPredicate)
    .where('VoidedDate', 'is', null)
    .executeTakeFirstOrThrow();

  const lowStock = await db
    .selectFrom('tblStandItems')
    .select((eb) => eb.fn.countAll().as('cnt'))
    .where('IsActive', '=', true)
    .where((eb) => eb('CurrentStock', '<=', eb.ref('ReorderLevel')))
    .executeTakeFirstOrThrow();

  const expiring = await db
    .selectFrom('tblStandItems')
    .select((eb) => eb.fn.countAll().as('cnt'))
    .where('IsActive', '=', true)
    .where('ExpiryDate', 'is not', null)
    .where('ExpiryDate', '>=', sql<Date>`current_date`)
    .where('ExpiryDate', '<=', sql<Date>`current_date + interval '30 day'`)
    .executeTakeFirstOrThrow();

  const inventoryValue = await db
    .selectFrom('tblStandItems')
    .select((eb) =>
      eb.fn
        .coalesce(eb.fn.sum(sql<number>`"CurrentStock" * "CostPrice"`), sql<number>`0`)
        .as('TotalInventoryValue')
    )
    .where('IsActive', '=', true)
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
    .selectFrom('tblStandSales')
    .select((eb) => [
      sql<string>`to_char("SaleDate", 'YYYY-MM-DD')`.as('SaleDate'),
      eb.fn.countAll().as('SalesCount'),
      eb.fn.sum('TotalAmount').as('Revenue'),
      eb.fn.sum('TotalCost').as('Cost'),
      eb.fn.sum('TotalProfit').as('Profit'),
    ])
    .where(sql`cast("SaleDate" as date)`, '>=', sql<Date>`${startDate}`)
    .where(sql`cast("SaleDate" as date)`, '<=', sql<Date>`${endDate}`)
    .where('VoidedDate', 'is', null)
    .groupBy(sql`to_char("SaleDate", 'YYYY-MM-DD')`)
    .orderBy('SaleDate')
    .execute();

  return rows.map((r) => ({
    SaleDate: r.SaleDate,
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
    .selectFrom('tblStandSaleItems as si')
    .innerJoin('tblStandItems as i', 'si.ItemID', 'i.ItemID')
    .innerJoin('tblStandSales as s', 'si.SaleID', 's.SaleID')
    .select((eb) => [
      'si.ItemID',
      'i.ItemName',
      eb.fn.sum('si.Quantity').as('TotalQuantity'),
      eb.fn.sum('si.LineTotal').as('TotalRevenue'),
      eb.fn.sum(sql<number>`si."LineTotal" - (si."Quantity" * si."UnitCost")`).as('TotalProfit'),
    ])
    .where(sql`cast(${sql.ref('s.SaleDate')} as date)`, '>=', sql<Date>`${startDate}`)
    .where(sql`cast(${sql.ref('s.SaleDate')} as date)`, '<=', sql<Date>`${endDate}`)
    .where('s.VoidedDate', 'is', null)
    .groupBy(['si.ItemID', 'i.ItemName'])
    .orderBy('TotalQuantity', 'desc')
    .limit(limit)
    .execute();

  return rows.map((r) => ({
    ItemID: r.ItemID,
    ItemName: r.ItemName,
    TotalQuantity: Number(r.TotalQuantity),
    TotalRevenue: Number(r.TotalRevenue),
    TotalProfit: Number(r.TotalProfit),
  }));
}

export async function getStandPurchasesSummary(
  startDate: string,
  endDate: string
): Promise<{ totalPurchases: number; restockCount: number }> {
  const row = await getKysely()
    .selectFrom('tblStandStockMovements')
    .select((eb) => [
      eb.fn.coalesce(eb.fn.sum('TotalCost'), sql<number>`0`).as('TotalPurchases'),
      eb.fn.countAll().as('RestockCount'),
    ])
    .where('MovementType', '=', 'restock')
    .where(sql`cast("MovementDate" as date)`, '>=', sql<Date>`${startDate}`)
    .where(sql`cast("MovementDate" as date)`, '<=', sql<Date>`${endDate}`)
    .executeTakeFirstOrThrow();

  return {
    totalPurchases: Number(row.TotalPurchases),
    restockCount: Number(row.RestockCount),
  };
}
