/**
 * Stand / Mini-Pharmacy database queries
 */
import type { ColumnValue } from '../../../types/database.types.js';
import { executeQuery, withConnection, TYPES } from '../index.js';
import type { SqlParam } from '../index.js';
import { Connection, Request } from 'tedious';
import { log } from '../../../utils/logger.js';

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

// ============================================================================
// HELPER: execute raw SQL on a connection, returning rows + rowsAffected
// ============================================================================

function execOnConnection(
  connection: Connection,
  query: string,
  params: SqlParam[] = []
): Promise<{ rows: unknown[][]; rowsAffected: number }> {
  return new Promise((resolve, reject) => {
    const rows: unknown[][] = [];
    let affected = 0;

    const request = new Request(query, (err: Error | null | undefined, rowCount?: number) => {
      if (err) {
        reject(err);
        return;
      }
      affected = rowCount ?? 0;
    });

    params.forEach(([name, type, value]) => {
      request.addParameter(name, type, value);
    });

    request.on('row', (columns: ColumnValue[]) => {
      rows.push(columns.map(c => c.value));
    });

    request.on('requestCompleted', () => {
      resolve({ rows, rowsAffected: affected });
    });

    request.on('error', (error: Error) => {
      reject(error);
    });

    connection.execSql(request);
  });
}

// ============================================================================
// CATEGORIES
// ============================================================================

export async function getStandCategories(): Promise<StandCategoryRow[]> {
  const query = `
    SELECT CategoryID, CategoryName, IsActive
    FROM dbo.tblStandCategories
    WHERE IsActive = 1
    ORDER BY CategoryName
  `;

  return executeQuery<StandCategoryRow>(query, [], (columns: ColumnValue[]) => ({
    CategoryID: columns[0].value as number,
    CategoryName: columns[1].value as string,
    IsActive: columns[2].value as boolean,
  }));
}

export async function addStandCategory(name: string): Promise<{ CategoryID: number }> {
  const query = `
    INSERT INTO dbo.tblStandCategories (CategoryName)
    VALUES (@name);
    SELECT SCOPE_IDENTITY() AS NewID;
  `;

  const result = await executeQuery<{ NewID: number }>(
    query,
    [['name', TYPES.NVarChar, name]],
    (columns: ColumnValue[]) => ({ NewID: columns[0].value as number })
  );

  if (!result?.[0]) throw new Error('Failed to create category: no ID returned');
  return { CategoryID: result[0].NewID };
}

export async function updateStandCategory(
  id: number,
  data: { categoryName?: string; isActive?: boolean }
): Promise<void> {
  const sets: string[] = [];
  const params: SqlParam[] = [['id', TYPES.Int, id]];

  if (data.categoryName !== undefined) {
    sets.push('CategoryName = @name');
    params.push(['name', TYPES.NVarChar, data.categoryName]);
  }
  if (data.isActive !== undefined) {
    sets.push('IsActive = @isActive');
    params.push(['isActive', TYPES.Bit, data.isActive]);
  }

  if (sets.length === 0) return;

  const query = `UPDATE dbo.tblStandCategories SET ${sets.join(', ')} WHERE CategoryID = @id`;
  await executeQuery(query, params, () => ({}));
}

export async function deactivateStandCategory(id: number): Promise<void> {
  await updateStandCategory(id, { isActive: false });
}

// ============================================================================
// ITEMS
// ============================================================================

export async function getStandItems(filters: StandItemFilters = {}): Promise<StandItemRow[]> {
  let query = `
    SELECT
      i.ItemID, i.ItemName, i.SKU, i.Barcode, i.CategoryID,
      i.CostPrice, i.SellPrice, i.CurrentStock, i.ReorderLevel,
      i.ExpiryDate, i.Unit, i.Notes, i.IsActive,
      i.DateAdded, i.ModifiedDate, i.CreatedBy,
      c.CategoryName
    FROM dbo.tblStandItems i
    LEFT JOIN dbo.tblStandCategories c ON i.CategoryID = c.CategoryID
    WHERE 1=1
  `;

  const params: SqlParam[] = [];

  if (!filters.includeInactive) {
    query += ' AND i.IsActive = 1';
  }

  if (filters.search) {
    query += ' AND (i.ItemName LIKE @search OR i.SKU LIKE @search OR i.Barcode LIKE @search)';
    params.push(['search', TYPES.NVarChar, `%${filters.search}%`]);
  }

  if (filters.categoryId) {
    query += ' AND i.CategoryID = @categoryId';
    params.push(['categoryId', TYPES.Int, filters.categoryId]);
  }

  if (filters.stockStatus === 'out-of-stock') {
    query += ' AND i.CurrentStock = 0';
  } else if (filters.stockStatus === 'low-stock') {
    query += ' AND i.CurrentStock > 0 AND i.CurrentStock <= i.ReorderLevel';
  } else if (filters.stockStatus === 'in-stock') {
    query += ' AND i.CurrentStock > i.ReorderLevel';
  }

  query += ' ORDER BY i.ItemName';

  return executeQuery<StandItemRow>(query, params, (columns: ColumnValue[]) => ({
    ItemID: columns[0].value as number,
    ItemName: columns[1].value as string,
    SKU: columns[2].value as string | null,
    Barcode: columns[3].value as string | null,
    CategoryID: columns[4].value as number | null,
    CostPrice: columns[5].value as number,
    SellPrice: columns[6].value as number,
    CurrentStock: columns[7].value as number,
    ReorderLevel: columns[8].value as number,
    ExpiryDate: columns[9].value as Date | null,
    Unit: columns[10].value as string | null,
    Notes: columns[11].value as string | null,
    IsActive: columns[12].value as boolean,
    DateAdded: columns[13].value as Date,
    ModifiedDate: columns[14].value as Date | null,
    CreatedBy: columns[15].value as number | null,
    CategoryName: columns[16].value as string | null,
  }));
}

export async function getStandItemById(id: number): Promise<StandItemRow | null> {
  const query = `
    SELECT
      i.ItemID, i.ItemName, i.SKU, i.Barcode, i.CategoryID,
      i.CostPrice, i.SellPrice, i.CurrentStock, i.ReorderLevel,
      i.ExpiryDate, i.Unit, i.Notes, i.IsActive,
      i.DateAdded, i.ModifiedDate, i.CreatedBy,
      c.CategoryName
    FROM dbo.tblStandItems i
    LEFT JOIN dbo.tblStandCategories c ON i.CategoryID = c.CategoryID
    WHERE i.ItemID = @id
  `;

  const result = await executeQuery<StandItemRow>(
    query,
    [['id', TYPES.Int, id]],
    (columns: ColumnValue[]) => ({
      ItemID: columns[0].value as number,
      ItemName: columns[1].value as string,
      SKU: columns[2].value as string | null,
      Barcode: columns[3].value as string | null,
      CategoryID: columns[4].value as number | null,
      CostPrice: columns[5].value as number,
      SellPrice: columns[6].value as number,
      CurrentStock: columns[7].value as number,
      ReorderLevel: columns[8].value as number,
      ExpiryDate: columns[9].value as Date | null,
      Unit: columns[10].value as string | null,
      Notes: columns[11].value as string | null,
      IsActive: columns[12].value as boolean,
      DateAdded: columns[13].value as Date,
      ModifiedDate: columns[14].value as Date | null,
      CreatedBy: columns[15].value as number | null,
      CategoryName: columns[16].value as string | null,
    })
  );

  return result.length > 0 ? result[0] : null;
}

export async function getStandItemByBarcode(barcode: string): Promise<StandItemRow | null> {
  const query = `
    SELECT
      i.ItemID, i.ItemName, i.SKU, i.Barcode, i.CategoryID,
      i.CostPrice, i.SellPrice, i.CurrentStock, i.ReorderLevel,
      i.ExpiryDate, i.Unit, i.Notes, i.IsActive,
      i.DateAdded, i.ModifiedDate, i.CreatedBy,
      c.CategoryName
    FROM dbo.tblStandItems i
    LEFT JOIN dbo.tblStandCategories c ON i.CategoryID = c.CategoryID
    WHERE i.Barcode = @barcode AND i.IsActive = 1
  `;

  const result = await executeQuery<StandItemRow>(
    query,
    [['barcode', TYPES.NVarChar, barcode]],
    (columns: ColumnValue[]) => ({
      ItemID: columns[0].value as number,
      ItemName: columns[1].value as string,
      SKU: columns[2].value as string | null,
      Barcode: columns[3].value as string | null,
      CategoryID: columns[4].value as number | null,
      CostPrice: columns[5].value as number,
      SellPrice: columns[6].value as number,
      CurrentStock: columns[7].value as number,
      ReorderLevel: columns[8].value as number,
      ExpiryDate: columns[9].value as Date | null,
      Unit: columns[10].value as string | null,
      Notes: columns[11].value as string | null,
      IsActive: columns[12].value as boolean,
      DateAdded: columns[13].value as Date,
      ModifiedDate: columns[14].value as Date | null,
      CreatedBy: columns[15].value as number | null,
      CategoryName: columns[16].value as string | null,
    })
  );

  return result.length > 0 ? result[0] : null;
}

export async function addStandItem(data: StandItemCreateData): Promise<{ ItemID: number }> {
  const initialStock = data.currentStock ?? 0;

  const query = `
    INSERT INTO dbo.tblStandItems
      (ItemName, SKU, Barcode, CategoryID, CostPrice, SellPrice,
       CurrentStock, ReorderLevel, ExpiryDate, Unit, Notes, CreatedBy)
    VALUES
      (@itemName, @sku, @barcode, @categoryId, @costPrice, @sellPrice,
       @currentStock, @reorderLevel, @expiryDate, @unit, @notes, @createdBy);
    SELECT SCOPE_IDENTITY() AS NewID;
  `;

  const params: SqlParam[] = [
    ['itemName', TYPES.NVarChar, data.itemName],
    ['sku', TYPES.NVarChar, data.sku || null],
    ['barcode', TYPES.NVarChar, data.barcode || null],
    ['categoryId', TYPES.Int, data.categoryId || null],
    ['costPrice', TYPES.Int, data.costPrice],
    ['sellPrice', TYPES.Int, data.sellPrice],
    ['currentStock', TYPES.Int, initialStock],
    ['reorderLevel', TYPES.Int, data.reorderLevel ?? 5],
    ['expiryDate', TYPES.Date, data.expiryDate || null],
    ['unit', TYPES.NVarChar, data.unit || null],
    ['notes', TYPES.NVarChar, data.notes || null],
    ['createdBy', TYPES.Int, data.createdBy || null],
  ];

  const result = await executeQuery<{ NewID: number }>(query, params, (columns: ColumnValue[]) => ({
    NewID: columns[0].value as number,
  }));

  if (!result?.[0]) throw new Error('Failed to create item: no ID returned');

  const itemId = result[0].NewID;

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
  const sets: string[] = ['ModifiedDate = SYSDATETIME()'];
  const params: SqlParam[] = [['id', TYPES.Int, id]];

  if (data.itemName !== undefined) {
    sets.push('ItemName = @itemName');
    params.push(['itemName', TYPES.NVarChar, data.itemName]);
  }
  if (data.sku !== undefined) {
    sets.push('SKU = @sku');
    params.push(['sku', TYPES.NVarChar, data.sku]);
  }
  if (data.barcode !== undefined) {
    sets.push('Barcode = @barcode');
    params.push(['barcode', TYPES.NVarChar, data.barcode]);
  }
  if (data.categoryId !== undefined) {
    sets.push('CategoryID = @categoryId');
    params.push(['categoryId', TYPES.Int, data.categoryId]);
  }
  if (data.costPrice !== undefined) {
    sets.push('CostPrice = @costPrice');
    params.push(['costPrice', TYPES.Int, data.costPrice]);
  }
  if (data.sellPrice !== undefined) {
    sets.push('SellPrice = @sellPrice');
    params.push(['sellPrice', TYPES.Int, data.sellPrice]);
  }
  if (data.reorderLevel !== undefined) {
    sets.push('ReorderLevel = @reorderLevel');
    params.push(['reorderLevel', TYPES.Int, data.reorderLevel]);
  }
  if (data.expiryDate !== undefined) {
    sets.push('ExpiryDate = @expiryDate');
    params.push(['expiryDate', TYPES.Date, data.expiryDate]);
  }
  if (data.unit !== undefined) {
    sets.push('Unit = @unit');
    params.push(['unit', TYPES.NVarChar, data.unit]);
  }
  if (data.notes !== undefined) {
    sets.push('Notes = @notes');
    params.push(['notes', TYPES.NVarChar, data.notes]);
  }

  const query = `UPDATE dbo.tblStandItems SET ${sets.join(', ')} WHERE ItemID = @id`;
  await executeQuery(query, params, () => ({}));
}

export async function softDeleteStandItem(id: number): Promise<void> {
  const query = `
    UPDATE dbo.tblStandItems
    SET IsActive = 0, ModifiedDate = SYSDATETIME()
    WHERE ItemID = @id
  `;
  await executeQuery(query, [['id', TYPES.Int, id]], () => ({}));
}

export async function getLowStockItems(): Promise<StandItemRow[]> {
  const query = `
    SELECT
      i.ItemID, i.ItemName, i.SKU, i.Barcode, i.CategoryID,
      i.CostPrice, i.SellPrice, i.CurrentStock, i.ReorderLevel,
      i.ExpiryDate, i.Unit, i.Notes, i.IsActive,
      i.DateAdded, i.ModifiedDate, i.CreatedBy,
      c.CategoryName
    FROM dbo.tblStandItems i
    LEFT JOIN dbo.tblStandCategories c ON i.CategoryID = c.CategoryID
    WHERE i.IsActive = 1 AND i.CurrentStock <= i.ReorderLevel
    ORDER BY i.CurrentStock ASC
  `;

  return executeQuery<StandItemRow>(query, [], (columns: ColumnValue[]) => ({
    ItemID: columns[0].value as number,
    ItemName: columns[1].value as string,
    SKU: columns[2].value as string | null,
    Barcode: columns[3].value as string | null,
    CategoryID: columns[4].value as number | null,
    CostPrice: columns[5].value as number,
    SellPrice: columns[6].value as number,
    CurrentStock: columns[7].value as number,
    ReorderLevel: columns[8].value as number,
    ExpiryDate: columns[9].value as Date | null,
    Unit: columns[10].value as string | null,
    Notes: columns[11].value as string | null,
    IsActive: columns[12].value as boolean,
    DateAdded: columns[13].value as Date,
    ModifiedDate: columns[14].value as Date | null,
    CreatedBy: columns[15].value as number | null,
    CategoryName: columns[16].value as string | null,
  }));
}

export async function getExpiringItems(daysAhead: number = 30): Promise<StandItemRow[]> {
  const query = `
    SELECT
      i.ItemID, i.ItemName, i.SKU, i.Barcode, i.CategoryID,
      i.CostPrice, i.SellPrice, i.CurrentStock, i.ReorderLevel,
      i.ExpiryDate, i.Unit, i.Notes, i.IsActive,
      i.DateAdded, i.ModifiedDate, i.CreatedBy,
      c.CategoryName
    FROM dbo.tblStandItems i
    LEFT JOIN dbo.tblStandCategories c ON i.CategoryID = c.CategoryID
    WHERE i.IsActive = 1
      AND i.ExpiryDate IS NOT NULL
      AND i.ExpiryDate BETWEEN CAST(GETDATE() AS DATE) AND DATEADD(DAY, @days, CAST(GETDATE() AS DATE))
    ORDER BY i.ExpiryDate ASC
  `;

  return executeQuery<StandItemRow>(
    query,
    [['days', TYPES.Int, daysAhead]],
    (columns: ColumnValue[]) => ({
      ItemID: columns[0].value as number,
      ItemName: columns[1].value as string,
      SKU: columns[2].value as string | null,
      Barcode: columns[3].value as string | null,
      CategoryID: columns[4].value as number | null,
      CostPrice: columns[5].value as number,
      SellPrice: columns[6].value as number,
      CurrentStock: columns[7].value as number,
      ReorderLevel: columns[8].value as number,
      ExpiryDate: columns[9].value as Date | null,
      Unit: columns[10].value as string | null,
      Notes: columns[11].value as string | null,
      IsActive: columns[12].value as boolean,
      DateAdded: columns[13].value as Date,
      ModifiedDate: columns[14].value as Date | null,
      CreatedBy: columns[15].value as number | null,
      CategoryName: columns[16].value as string | null,
    })
  );
}

// ============================================================================
// SALES — TRANSACTIONAL
// ============================================================================

export async function createStandSaleTransaction(data: SaleCreateInput): Promise<{ SaleID: number }> {
  return withConnection(async (connection: Connection) => {
    // BEGIN TRANSACTION
    await execOnConnection(connection, 'BEGIN TRANSACTION');

    try {
      // 1. Insert sale header
      const saleResult = await execOnConnection(
        connection,
        `INSERT INTO dbo.tblStandSales
          (TotalAmount, TotalCost, TotalProfit, AmountPaid, Change, PaymentMethod, CustomerNote, PersonID, CashierID)
         VALUES (@totalAmount, @totalCost, @totalProfit, @amountPaid, @change, @paymentMethod, @customerNote, @personId, @cashierId);
         SELECT SCOPE_IDENTITY() AS SaleID;`,
        [
          ['totalAmount', TYPES.Int, data.totalAmount],
          ['totalCost', TYPES.Int, data.totalCost],
          ['totalProfit', TYPES.Int, data.totalProfit],
          ['amountPaid', TYPES.Int, data.amountPaid],
          ['change', TYPES.Int, data.change],
          ['paymentMethod', TYPES.NVarChar, data.paymentMethod],
          ['customerNote', TYPES.NVarChar, data.customerNote || null],
          ['personId', TYPES.Int, data.personId || null],
          ['cashierId', TYPES.Int, data.cashierId || null],
        ]
      );

      const saleId = saleResult.rows[0]?.[0] as number;
      if (!saleId) throw new Error('Failed to create sale: no ID returned');

      // 2-4. For each line item: insert sale item, decrement stock, insert movement
      for (let i = 0; i < data.items.length; i++) {
        const item = data.items[i];

        // Insert sale item
        await execOnConnection(
          connection,
          `INSERT INTO dbo.tblStandSaleItems (SaleID, ItemID, Quantity, UnitPrice, UnitCost, LineTotal)
           VALUES (@saleId, @itemId, @qty, @unitPrice, @unitCost, @lineTotal)`,
          [
            ['saleId', TYPES.Int, saleId],
            ['itemId', TYPES.Int, item.itemId],
            ['qty', TYPES.Int, item.quantity],
            ['unitPrice', TYPES.Int, item.unitPrice],
            ['unitCost', TYPES.Int, item.unitCost],
            ['lineTotal', TYPES.Int, item.lineTotal],
          ]
        );

        // Decrement stock — check rowsAffected to ensure sufficient stock
        const stockResult = await execOnConnection(
          connection,
          `UPDATE dbo.tblStandItems
           SET CurrentStock = CurrentStock - @qty, ModifiedDate = SYSDATETIME()
           WHERE ItemID = @itemId AND CurrentStock >= @qty`,
          [
            ['qty', TYPES.Int, item.quantity],
            ['itemId', TYPES.Int, item.itemId],
          ]
        );

        if (stockResult.rowsAffected !== 1) {
          throw new Error(`INSUFFICIENT_STOCK:${item.itemId}`);
        }

        // Insert stock movement (negative qty for sale)
        await execOnConnection(
          connection,
          `INSERT INTO dbo.tblStandStockMovements
            (ItemID, MovementType, Quantity, UnitCost, RelatedSaleID, PerformedBy)
           VALUES (@itemId, 'sale', @qty, @unitCost, @saleId, @cashierId)`,
          [
            ['itemId', TYPES.Int, item.itemId],
            ['qty', TYPES.Int, -item.quantity],
            ['unitCost', TYPES.Int, item.unitCost],
            ['saleId', TYPES.Int, saleId],
            ['cashierId', TYPES.Int, data.cashierId || null],
          ]
        );
      }

      // COMMIT
      await execOnConnection(connection, 'COMMIT TRANSACTION');
      return { SaleID: saleId };
    } catch (err) {
      // ROLLBACK on any failure
      try {
        await execOnConnection(connection, 'ROLLBACK TRANSACTION');
      } catch (rollbackErr) {
        log.error('Rollback failed during sale transaction', { error: (rollbackErr as Error).message });
      }
      throw err;
    }
  });
}

export async function getStandSales(filters: StandSaleFilters = {}): Promise<StandSaleRow[]> {
  let query = `
    SELECT
      s.SaleID, s.SaleDate, s.TotalAmount, s.TotalCost, s.TotalProfit,
      s.AmountPaid, s.Change, s.PaymentMethod, s.CustomerNote,
      s.PersonID, s.CashierID, s.VoidedDate, s.VoidedBy, s.VoidReason,
      p.PatientName, u.FullName AS CashierName
    FROM dbo.tblStandSales s
    LEFT JOIN dbo.tblpatients p ON s.PersonID = p.PersonID
    LEFT JOIN dbo.tblUsers u ON s.CashierID = u.UserID
    WHERE 1=1
  `;

  const params: SqlParam[] = [];

  if (filters.startDate) {
    query += ' AND CAST(s.SaleDate AS DATE) >= @startDate';
    params.push(['startDate', TYPES.Date, filters.startDate]);
  }
  if (filters.endDate) {
    query += ' AND CAST(s.SaleDate AS DATE) <= @endDate';
    params.push(['endDate', TYPES.Date, filters.endDate]);
  }
  if (filters.cashierId) {
    query += ' AND s.CashierID = @cashierId';
    params.push(['cashierId', TYPES.Int, filters.cashierId]);
  }
  if (filters.personId) {
    query += ' AND s.PersonID = @personId';
    params.push(['personId', TYPES.Int, filters.personId]);
  }

  query += ' ORDER BY s.SaleDate DESC, s.SaleID DESC';

  return executeQuery<StandSaleRow>(query, params, (columns: ColumnValue[]) => ({
    SaleID: columns[0].value as number,
    SaleDate: columns[1].value as Date,
    TotalAmount: columns[2].value as number,
    TotalCost: columns[3].value as number,
    TotalProfit: columns[4].value as number,
    AmountPaid: columns[5].value as number,
    Change: columns[6].value as number,
    PaymentMethod: columns[7].value as string,
    CustomerNote: columns[8].value as string | null,
    PersonID: columns[9].value as number | null,
    CashierID: columns[10].value as number | null,
    VoidedDate: columns[11].value as Date | null,
    VoidedBy: columns[12].value as number | null,
    VoidReason: columns[13].value as string | null,
    PatientName: columns[14].value as string | null,
    CashierName: columns[15].value as string | null,
  }));
}

export async function getStandSaleById(id: number): Promise<(StandSaleRow & { Items: StandSaleItemRow[] }) | null> {
  // Get the sale header
  const saleQuery = `
    SELECT
      s.SaleID, s.SaleDate, s.TotalAmount, s.TotalCost, s.TotalProfit,
      s.AmountPaid, s.Change, s.PaymentMethod, s.CustomerNote,
      s.PersonID, s.CashierID, s.VoidedDate, s.VoidedBy, s.VoidReason,
      p.PatientName, u.FullName AS CashierName
    FROM dbo.tblStandSales s
    LEFT JOIN dbo.tblpatients p ON s.PersonID = p.PersonID
    LEFT JOIN dbo.tblUsers u ON s.CashierID = u.UserID
    WHERE s.SaleID = @id
  `;

  const sales = await executeQuery<StandSaleRow>(
    saleQuery,
    [['id', TYPES.Int, id]],
    (columns: ColumnValue[]) => ({
      SaleID: columns[0].value as number,
      SaleDate: columns[1].value as Date,
      TotalAmount: columns[2].value as number,
      TotalCost: columns[3].value as number,
      TotalProfit: columns[4].value as number,
      AmountPaid: columns[5].value as number,
      Change: columns[6].value as number,
      PaymentMethod: columns[7].value as string,
      CustomerNote: columns[8].value as string | null,
      PersonID: columns[9].value as number | null,
      CashierID: columns[10].value as number | null,
      VoidedDate: columns[11].value as Date | null,
      VoidedBy: columns[12].value as number | null,
      VoidReason: columns[13].value as string | null,
      PatientName: columns[14].value as string | null,
      CashierName: columns[15].value as string | null,
    })
  );

  if (sales.length === 0) return null;

  // Get line items
  const itemsQuery = `
    SELECT
      si.SaleItemID, si.SaleID, si.ItemID, si.Quantity,
      si.UnitPrice, si.UnitCost, si.LineTotal,
      i.ItemName
    FROM dbo.tblStandSaleItems si
    JOIN dbo.tblStandItems i ON si.ItemID = i.ItemID
    WHERE si.SaleID = @id
    ORDER BY si.SaleItemID
  `;

  const items = await executeQuery<StandSaleItemRow>(
    itemsQuery,
    [['id', TYPES.Int, id]],
    (columns: ColumnValue[]) => ({
      SaleItemID: columns[0].value as number,
      SaleID: columns[1].value as number,
      ItemID: columns[2].value as number,
      Quantity: columns[3].value as number,
      UnitPrice: columns[4].value as number,
      UnitCost: columns[5].value as number,
      LineTotal: columns[6].value as number,
      ItemName: columns[7].value as string,
    })
  );

  return { ...sales[0], Items: items };
}

export async function voidStandSale(
  saleId: number,
  reason: string,
  userId: number | null
): Promise<void> {
  return withConnection(async (connection: Connection) => {
    await execOnConnection(connection, 'BEGIN TRANSACTION');

    try {
      // Mark sale as voided
      await execOnConnection(
        connection,
        `UPDATE dbo.tblStandSales
         SET VoidedDate = SYSDATETIME(), VoidedBy = @userId, VoidReason = @reason
         WHERE SaleID = @saleId AND VoidedDate IS NULL`,
        [
          ['saleId', TYPES.Int, saleId],
          ['userId', TYPES.Int, userId],
          ['reason', TYPES.NVarChar, reason],
        ]
      );

      // Get line items for stock reversal
      const lineItems = await execOnConnection(
        connection,
        `SELECT ItemID, Quantity, UnitCost FROM dbo.tblStandSaleItems WHERE SaleID = @saleId`,
        [['saleId', TYPES.Int, saleId]]
      );

      // Reverse stock for each line item
      for (const row of lineItems.rows) {
        const itemId = row[0] as number;
        const quantity = row[1] as number;
        const unitCost = row[2] as number;

        // Re-add stock
        await execOnConnection(
          connection,
          `UPDATE dbo.tblStandItems
           SET CurrentStock = CurrentStock + @qty, ModifiedDate = SYSDATETIME()
           WHERE ItemID = @itemId`,
          [
            ['qty', TYPES.Int, quantity],
            ['itemId', TYPES.Int, itemId],
          ]
        );

        // Insert reverse movement
        await execOnConnection(
          connection,
          `INSERT INTO dbo.tblStandStockMovements
            (ItemID, MovementType, Quantity, UnitCost, RelatedSaleID, Reason, PerformedBy)
           VALUES (@itemId, 'void', @qty, @unitCost, @saleId, @reason, @userId)`,
          [
            ['itemId', TYPES.Int, itemId],
            ['qty', TYPES.Int, quantity],
            ['unitCost', TYPES.Int, unitCost],
            ['saleId', TYPES.Int, saleId],
            ['reason', TYPES.NVarChar, `Void: ${reason}`],
            ['userId', TYPES.Int, userId],
          ]
        );
      }

      await execOnConnection(connection, 'COMMIT TRANSACTION');
    } catch (err) {
      try {
        await execOnConnection(connection, 'ROLLBACK TRANSACTION');
      } catch (rollbackErr) {
        log.error('Rollback failed during void transaction', { error: (rollbackErr as Error).message });
      }
      throw err;
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
  const query = `
    INSERT INTO dbo.tblStandStockMovements
      (ItemID, MovementType, Quantity, UnitCost, TotalCost, RelatedSaleID, Reason, PerformedBy)
    VALUES (@itemId, @movementType, @qty, @unitCost, @totalCost, @relatedSaleId, @reason, @performedBy)
  `;

  await executeQuery(
    query,
    [
      ['itemId', TYPES.Int, data.itemId],
      ['movementType', TYPES.NVarChar, data.movementType],
      ['qty', TYPES.Int, data.quantity],
      ['unitCost', TYPES.Int, data.unitCost ?? null],
      ['totalCost', TYPES.Int, data.totalCost ?? null],
      ['relatedSaleId', TYPES.Int, data.relatedSaleId ?? null],
      ['reason', TYPES.NVarChar, data.reason ?? null],
      ['performedBy', TYPES.Int, data.performedBy ?? null],
    ],
    () => ({})
  );
}

export async function restockItem(
  itemId: number,
  quantity: number,
  unitCost: number,
  userId: number | null
): Promise<void> {
  return withConnection(async (connection: Connection) => {
    await execOnConnection(connection, 'BEGIN TRANSACTION');
    try {
      // Update stock
      await execOnConnection(
        connection,
        `UPDATE dbo.tblStandItems
         SET CurrentStock = CurrentStock + @qty, ModifiedDate = SYSDATETIME()
         WHERE ItemID = @itemId`,
        [
          ['qty', TYPES.Int, quantity],
          ['itemId', TYPES.Int, itemId],
        ]
      );

      // Insert movement
      await execOnConnection(
        connection,
        `INSERT INTO dbo.tblStandStockMovements
          (ItemID, MovementType, Quantity, UnitCost, TotalCost, PerformedBy)
         VALUES (@itemId, 'restock', @qty, @unitCost, @totalCost, @userId)`,
        [
          ['itemId', TYPES.Int, itemId],
          ['qty', TYPES.Int, quantity],
          ['unitCost', TYPES.Int, unitCost],
          ['totalCost', TYPES.Int, quantity * unitCost],
          ['userId', TYPES.Int, userId],
        ]
      );

      await execOnConnection(connection, 'COMMIT TRANSACTION');
    } catch (err) {
      try { await execOnConnection(connection, 'ROLLBACK TRANSACTION'); } catch { /* ignore */ }
      throw err;
    }
  });
}

export async function adjustStock(
  itemId: number,
  delta: number,
  reason: string,
  userId: number | null
): Promise<void> {
  return withConnection(async (connection: Connection) => {
    await execOnConnection(connection, 'BEGIN TRANSACTION');
    try {
      // Update stock (ensure non-negative)
      const result = await execOnConnection(
        connection,
        `UPDATE dbo.tblStandItems
         SET CurrentStock = CurrentStock + @delta, ModifiedDate = SYSDATETIME()
         WHERE ItemID = @itemId AND (CurrentStock + @delta) >= 0`,
        [
          ['delta', TYPES.Int, delta],
          ['itemId', TYPES.Int, itemId],
        ]
      );

      if (result.rowsAffected !== 1) {
        throw new Error('INSUFFICIENT_STOCK_FOR_ADJUSTMENT');
      }

      const movementType = delta < 0 ? 'waste' : 'adjustment';

      await execOnConnection(
        connection,
        `INSERT INTO dbo.tblStandStockMovements
          (ItemID, MovementType, Quantity, Reason, PerformedBy)
         VALUES (@itemId, @type, @delta, @reason, @userId)`,
        [
          ['itemId', TYPES.Int, itemId],
          ['type', TYPES.NVarChar, movementType],
          ['delta', TYPES.Int, delta],
          ['reason', TYPES.NVarChar, reason],
          ['userId', TYPES.Int, userId],
        ]
      );

      await execOnConnection(connection, 'COMMIT TRANSACTION');
    } catch (err) {
      try { await execOnConnection(connection, 'ROLLBACK TRANSACTION'); } catch { /* ignore */ }
      throw err;
    }
  });
}

export async function getStockMovements(
  itemId: number,
  filters: StandStockMovementFilters = {}
): Promise<StandMovementRow[]> {
  let query = `
    SELECT
      m.MovementID, m.ItemID, m.MovementType, m.Quantity,
      m.UnitCost, m.TotalCost, m.RelatedSaleID, m.Reason,
      m.MovementDate, m.PerformedBy, u.FullName AS PerformedByName
    FROM dbo.tblStandStockMovements m
    LEFT JOIN dbo.tblUsers u ON m.PerformedBy = u.UserID
    WHERE m.ItemID = @itemId
  `;

  const params: SqlParam[] = [['itemId', TYPES.Int, itemId]];

  if (filters.startDate) {
    query += ' AND CAST(m.MovementDate AS DATE) >= @startDate';
    params.push(['startDate', TYPES.Date, filters.startDate]);
  }
  if (filters.endDate) {
    query += ' AND CAST(m.MovementDate AS DATE) <= @endDate';
    params.push(['endDate', TYPES.Date, filters.endDate]);
  }
  if (filters.movementType) {
    query += ' AND m.MovementType = @movementType';
    params.push(['movementType', TYPES.NVarChar, filters.movementType]);
  }

  query += ' ORDER BY m.MovementDate DESC, m.MovementID DESC';

  return executeQuery<StandMovementRow>(query, params, (columns: ColumnValue[]) => ({
    MovementID: columns[0].value as number,
    ItemID: columns[1].value as number,
    MovementType: columns[2].value as string,
    Quantity: columns[3].value as number,
    UnitCost: columns[4].value as number | null,
    TotalCost: columns[5].value as number | null,
    RelatedSaleID: columns[6].value as number | null,
    Reason: columns[7].value as string | null,
    MovementDate: columns[8].value as Date,
    PerformedBy: columns[9].value as number | null,
    PerformedByName: columns[10].value as string | null,
  }));
}

// ============================================================================
// REPORTS / KPIs
// ============================================================================

export async function getStandDashboardKPIs(): Promise<DashboardKPIs> {
  const query = `
    SELECT
      (SELECT COUNT(*) FROM dbo.tblStandSales WHERE CAST(SaleDate AS DATE) = CAST(GETDATE() AS DATE) AND VoidedDate IS NULL) AS TodaySalesCount,
      (SELECT ISNULL(SUM(TotalAmount), 0) FROM dbo.tblStandSales WHERE CAST(SaleDate AS DATE) = CAST(GETDATE() AS DATE) AND VoidedDate IS NULL) AS TodayRevenue,
      (SELECT ISNULL(SUM(TotalProfit), 0) FROM dbo.tblStandSales WHERE CAST(SaleDate AS DATE) = CAST(GETDATE() AS DATE) AND VoidedDate IS NULL) AS TodayProfit,
      (SELECT COUNT(*) FROM dbo.tblStandItems WHERE IsActive = 1 AND CurrentStock <= ReorderLevel) AS LowStockCount,
      (SELECT COUNT(*) FROM dbo.tblStandItems WHERE IsActive = 1 AND ExpiryDate IS NOT NULL AND ExpiryDate BETWEEN CAST(GETDATE() AS DATE) AND DATEADD(DAY, 30, CAST(GETDATE() AS DATE))) AS ExpiringSoonCount,
      (SELECT ISNULL(SUM(CurrentStock * CostPrice), 0) FROM dbo.tblStandItems WHERE IsActive = 1) AS TotalInventoryValue
  `;

  const result = await executeQuery<DashboardKPIs>(query, [], (columns: ColumnValue[]) => ({
    todaySalesCount: columns[0].value as number,
    todayRevenue: columns[1].value as number,
    todayProfit: columns[2].value as number,
    lowStockCount: columns[3].value as number,
    expiringSoonCount: columns[4].value as number,
    totalInventoryValue: columns[5].value as number,
  }));

  return result[0] || {
    todaySalesCount: 0,
    todayRevenue: 0,
    todayProfit: 0,
    lowStockCount: 0,
    expiringSoonCount: 0,
    totalInventoryValue: 0,
  };
}

export async function getStandSalesSummary(
  startDate: string,
  endDate: string
): Promise<SalesSummaryRow[]> {
  const query = `
    SELECT
      CONVERT(VARCHAR(10), SaleDate, 120) AS SaleDate,
      COUNT(*) AS SalesCount,
      SUM(TotalAmount) AS Revenue,
      SUM(TotalCost) AS Cost,
      SUM(TotalProfit) AS Profit
    FROM dbo.tblStandSales
    WHERE CAST(SaleDate AS DATE) >= @startDate
      AND CAST(SaleDate AS DATE) <= @endDate
      AND VoidedDate IS NULL
    GROUP BY CONVERT(VARCHAR(10), SaleDate, 120)
    ORDER BY SaleDate
  `;

  return executeQuery<SalesSummaryRow>(
    query,
    [
      ['startDate', TYPES.Date, startDate],
      ['endDate', TYPES.Date, endDate],
    ],
    (columns: ColumnValue[]) => ({
      SaleDate: columns[0].value as string,
      SalesCount: columns[1].value as number,
      Revenue: columns[2].value as number,
      Cost: columns[3].value as number,
      Profit: columns[4].value as number,
    })
  );
}

export async function getTopSellingItems(
  startDate: string,
  endDate: string,
  limit: number = 10
): Promise<TopItemRow[]> {
  const query = `
    SELECT TOP(@limit)
      si.ItemID,
      i.ItemName,
      SUM(si.Quantity) AS TotalQuantity,
      SUM(si.LineTotal) AS TotalRevenue,
      SUM(si.LineTotal - (si.Quantity * si.UnitCost)) AS TotalProfit
    FROM dbo.tblStandSaleItems si
    JOIN dbo.tblStandItems i ON si.ItemID = i.ItemID
    JOIN dbo.tblStandSales s ON si.SaleID = s.SaleID
    WHERE CAST(s.SaleDate AS DATE) >= @startDate
      AND CAST(s.SaleDate AS DATE) <= @endDate
      AND s.VoidedDate IS NULL
    GROUP BY si.ItemID, i.ItemName
    ORDER BY TotalQuantity DESC
  `;

  return executeQuery<TopItemRow>(
    query,
    [
      ['startDate', TYPES.Date, startDate],
      ['endDate', TYPES.Date, endDate],
      ['limit', TYPES.Int, limit],
    ],
    (columns: ColumnValue[]) => ({
      ItemID: columns[0].value as number,
      ItemName: columns[1].value as string,
      TotalQuantity: columns[2].value as number,
      TotalRevenue: columns[3].value as number,
      TotalProfit: columns[4].value as number,
    })
  );
}

export async function getStandPurchasesSummary(
  startDate: string,
  endDate: string
): Promise<{ totalPurchases: number; restockCount: number }> {
  const query = `
    SELECT
      ISNULL(SUM(TotalCost), 0) AS TotalPurchases,
      COUNT(*) AS RestockCount
    FROM dbo.tblStandStockMovements
    WHERE MovementType = 'restock'
      AND CAST(MovementDate AS DATE) >= @startDate
      AND CAST(MovementDate AS DATE) <= @endDate
  `;

  const result = await executeQuery<{ totalPurchases: number; restockCount: number }>(
    query,
    [
      ['startDate', TYPES.Date, startDate],
      ['endDate', TYPES.Date, endDate],
    ],
    (columns: ColumnValue[]) => ({
      totalPurchases: columns[0].value as number,
      restockCount: columns[1].value as number,
    })
  );

  return result[0] || { totalPurchases: 0, restockCount: 0 };
}
