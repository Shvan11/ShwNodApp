# Plan: Mini-Pharmacy / Stand Inventory System

## Context

The clinic has added a retail stand that sells items like mouthwashes, toothbrushes, etc. There is currently **no inventory, stock, product, or sale code anywhere in the codebase** — this is a greenfield feature.

Goals:
- Track items with cost, sell price, profit, expiry, stock, category
- POS-style multi-item checkout (compatible with USB barcode scanners)
- Full stock movement audit log (restock/sale/adjustment/waste)
- Live KPIs on a new Stand landing page plus a dashboard card
- Integrate cleanly with existing patterns (Expenses, Payments, Chart.js stats)

### Decisions (confirmed with user)
1. **Separate `tblStandSales` table** — not merged into `tblInvoice`.
2. **IQD-only pricing** — no dual-currency fields, no exchange rate logic on sales. Keeps the UI and schema simple.
3. **Multi-item POS cart** — one sale = many line items, supports barcode scanners.
4. **Full stock movement log** — every change recorded in `tblStandStockMovements` for audit, shrinkage, and profit accuracy.
5. **Complete isolation from existing expenses and financial reporting** — stand profit and stand purchases are computed entirely from the stand's own tables. Nothing is written to `tblExpenses`, and existing Statistics / stored procs are not modified. The Stand has its own Reports page with its own numbers.

---

## Database Schema (new migration)

Create `/migrations/add_stand_tables.sql` with the following five tables. All money fields are `INT` (IQD, no decimals — consistent with existing tables like `tblExpenses` and `tblInvoice`).

### `tblStandCategories`
```
CategoryID      INT PK IDENTITY
CategoryName    NVARCHAR(100)  NOT NULL UNIQUE
IsActive        BIT            NOT NULL DEFAULT 1
```

### `tblStandItems`
```
ItemID          INT PK IDENTITY
ItemName        NVARCHAR(255)  NOT NULL
SKU             NVARCHAR(50)   NULL UNIQUE
Barcode         NVARCHAR(100)  NULL UNIQUE
CategoryID      INT            NULL  FK -> tblStandCategories
CostPrice       INT            NOT NULL         -- IQD per unit
SellPrice       INT            NOT NULL         -- IQD per unit
CurrentStock    INT            NOT NULL DEFAULT 0
ReorderLevel    INT            NOT NULL DEFAULT 5
ExpiryDate      DATE           NULL             -- nullable: not every item expires
Unit            NVARCHAR(20)   NULL             -- "piece", "box", "tube"
Notes           NVARCHAR(500)  NULL
IsActive        BIT            NOT NULL DEFAULT 1   -- soft delete
DateAdded       DATETIME2      NOT NULL DEFAULT SYSDATETIME()
ModifiedDate    DATETIME2      NULL
CreatedBy       INT            NULL

Indexes: Barcode, SKU, CategoryID, (IsActive, ExpiryDate)
CHECK:   CostPrice >= 0, SellPrice >= 0, CurrentStock >= 0, ReorderLevel >= 0
```

### `tblStandSales`
```
SaleID          INT PK IDENTITY
SaleDate        DATETIME2      NOT NULL DEFAULT SYSDATETIME()
TotalAmount     INT            NOT NULL         -- sum of line totals
TotalCost       INT            NOT NULL         -- sum of (qty * snapshot UnitCost)
TotalProfit     INT            NOT NULL         -- TotalAmount - TotalCost (stored)
AmountPaid      INT            NOT NULL
Change          INT            NOT NULL DEFAULT 0
PaymentMethod   NVARCHAR(20)   NOT NULL DEFAULT 'cash'
CustomerNote    NVARCHAR(255)  NULL
PersonID        INT            NULL  FK -> tblpatients  -- optional link to patient
CashierID       INT            NULL  FK -> tblUsers
VoidedDate      DATETIME2      NULL
VoidedBy        INT            NULL  FK -> tblUsers
VoidReason      NVARCHAR(255)  NULL

Indexes: SaleDate, PersonID, CashierID
```

### `tblStandSaleItems`
```
SaleItemID      INT PK IDENTITY
SaleID          INT            NOT NULL  FK -> tblStandSales  ON DELETE CASCADE
ItemID          INT            NOT NULL  FK -> tblStandItems
Quantity        INT            NOT NULL
UnitPrice       INT            NOT NULL         -- snapshot sell price
UnitCost        INT            NOT NULL         -- snapshot cost (for historical profit)
LineTotal       INT            NOT NULL         -- Quantity * UnitPrice

Indexes: SaleID, ItemID
CHECK:   Quantity > 0
```

### `tblStandStockMovements`
```
MovementID      INT PK IDENTITY
ItemID          INT            NOT NULL  FK -> tblStandItems
MovementType    NVARCHAR(20)   NOT NULL         -- 'initial','restock','sale','adjustment','waste','return','void'
Quantity        INT            NOT NULL         -- +in, -out
UnitCost        INT            NULL             -- for restocks
TotalCost       INT            NULL             -- for restocks
RelatedSaleID   INT            NULL  FK -> tblStandSales
Reason          NVARCHAR(255)  NULL             -- for adjustments/waste
MovementDate    DATETIME2      NOT NULL DEFAULT SYSDATETIME()
PerformedBy     INT            NULL  FK -> tblUsers

Indexes: ItemID, MovementDate, MovementType
```

---

## Backend

### Types — add to `types/database.types.ts`
Entity types following existing patterns (nullable fields as `Type | null`, enum via `as const`):
- `StandCategory`, `StandItem`, `StandItemWithCategory` (joined display)
- `StandSale`, `StandSaleItem`, `StandSaleWithItems` (joined)
- `StandStockMovement`
- `StandItemCreateData`, `StandSaleCreateData`, `StandRestockData`, `StandAdjustData`
- `STAND_MOVEMENT_TYPE = { INITIAL, RESTOCK, SALE, ADJUSTMENT, WASTE, RETURN, VOID } as const`

### Query module — `services/database/queries/stand-queries.ts`
Follow `expense-queries.ts` patterns exactly: `executeQuery<T>(sql, params, rowMapper)`, `SqlParam` tuples `['name', TYPES.Int, value]`, `SCOPE_IDENTITY()` for new IDs.

**Categories**
- `getStandCategories()`, `addStandCategory(name)`, `updateStandCategory(id, data)`, `deactivateStandCategory(id)`

**Items**
- `getStandItems(filters: { search?, categoryId?, stockStatus?, includeInactive? })`
- `getStandItemById(id)`, `getStandItemByBarcode(barcode)`
- `addStandItem(data)` — also inserts an `INITIAL` movement if `CurrentStock > 0`
- `updateStandItem(id, data)`
- `softDeleteStandItem(id)` — sets `IsActive = 0`
- `getLowStockItems()` — `CurrentStock <= ReorderLevel`
- `getExpiringItems(daysAhead)` — `ExpiryDate BETWEEN today AND today + N`

**Sales — transactional**
- `createStandSaleTransaction(saleData)` — uses `ConnectionPool.withConnection` and wraps in `BEGIN TRAN ... COMMIT/ROLLBACK`:
  1. `INSERT INTO tblStandSales ... OUTPUT INSERTED.SaleID`
  2. For each line: `INSERT INTO tblStandSaleItems`
  3. For each line: `UPDATE tblStandItems SET CurrentStock = CurrentStock - @qty WHERE ItemID = @id AND CurrentStock >= @qty` — **check `rowsAffected == 1`**, else rollback with insufficient-stock error
  4. For each line: `INSERT INTO tblStandStockMovements` (type='sale', negative qty, RelatedSaleID)
- `getStandSales(filters)`, `getStandSaleById(id)` (with line items joined)
- `voidStandSale(saleId, reason, userId)` — transactional: mark sale voided, re-add stock, insert reverse movements

**Stock operations**
- `addStockMovement(data)` — raw insert
- `restockItem(itemId, qty, unitCost, userId)` — transactional: update item stock, insert movement (and optionally cost update)
- `adjustStock(itemId, delta, reason, userId)` — transactional
- `getStockMovements(itemId, filters)`

**Reports / KPIs**
- `getStandDashboardKPIs()` — returns `{ todaySalesCount, todayRevenue, todayProfit, lowStockCount, expiringSoonCount, totalInventoryValue }`
- `getStandSalesSummary(startDate, endDate)` — totals grouped by date
- `getTopSellingItems(startDate, endDate, limit)`

### Service — `services/business/StandService.ts`
Follow `PaymentService.ts` pattern exactly (custom error class with codes, validation helpers, delegates to query layer).

```typescript
export class StandValidationError extends Error {
  constructor(
    message: string,
    public readonly code: StandErrorCode,
    public readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'StandValidationError';
  }
}

export type StandErrorCode =
  | 'INSUFFICIENT_STOCK'
  | 'ITEM_INACTIVE'
  | 'ITEM_NOT_FOUND'
  | 'INVALID_QUANTITY'
  | 'NEGATIVE_CHANGE'
  | 'UNDERPAID'
  | 'SELL_BELOW_COST'   // warn, not block
  | 'SALE_NOT_FOUND'
  | 'ALREADY_VOIDED';
```

Functions:
- `validateAndCreateSale(saleData)` — loads each item, checks active + stock, computes totals & profit (snapshotting cost/price), validates `AmountPaid >= TotalAmount`, computes `Change`, delegates to `createStandSaleTransaction`
- `validateAndRestockItem(itemId, qty, unitCost, userId)` — validates qty > 0, updates stock, inserts a `restock` movement recording `UnitCost` and `TotalCost` (these become the stand-internal purchase spend; no write to `tblExpenses`)
- `validateAndAdjustStock(itemId, delta, reason, userId)` — validates resulting stock >= 0
- `validateAndVoidSale(saleId, reason, userId)` — checks not already voided, delegates

### Routes — `routes/api/stand.routes.ts`
Follow `expense.routes.ts` structure. Use `authenticate` + `authorize([...])` middleware. `ErrorResponses.*` for errors. Catch `StandValidationError` and convert to 400 with its `code` and `details`. **Specific routes before parameterized ones.**

```
GET    /stand/dashboard                       -> KPIs
GET    /stand/categories
POST   /stand/categories                      (admin)
PUT    /stand/categories/:id                  (admin)
DELETE /stand/categories/:id                  (admin)

GET    /stand/items/low-stock                 (specific — before :id)
GET    /stand/items/expiring                  (specific — before :id)
GET    /stand/items/barcode/:barcode          (specific — before :id)
GET    /stand/items                           ?search=&categoryId=&stockStatus=
GET    /stand/items/:id
POST   /stand/items                           (admin|secretary)
PUT    /stand/items/:id                       (admin|secretary)
DELETE /stand/items/:id                       (admin — soft delete)
POST   /stand/items/:id/restock               (admin|secretary)
POST   /stand/items/:id/adjust                (admin)
GET    /stand/items/:id/movements

POST   /stand/sales                           (admin|secretary|staff)
GET    /stand/sales                           ?startDate=&endDate=&cashierId=&personId=
GET    /stand/sales/:id
POST   /stand/sales/:id/void                  (admin)

GET    /stand/reports/summary                 ?startDate=&endDate=
GET    /stand/reports/top-items               ?startDate=&endDate=&limit=
```

Register in `routes/api/index.ts`:
```typescript
import standRoutes from './stand.routes.js';
router.use('/', standRoutes);     // matches existing pattern where routes define their own /stand/* prefix
```

---

## Frontend

### Router — `public/js/router/routes.config.tsx`
Add lazy imports and route entries (with `RouteErrorBoundary`) for:
- `/stand` → `Stand.tsx` (landing/dashboard)
- `/stand/inventory` → `StandInventory.tsx`
- `/stand/pos` → `StandPOS.tsx`
- `/stand/sales` → `StandSalesHistory.tsx`
- `/stand/reports` → `StandReports.tsx`

### Dashboard card — `public/js/routes/Dashboard.tsx`
Add one entry to the `dashboardCards` array:
```typescript
{
  title: 'Stand / Mini Pharmacy',
  description: 'Inventory, POS sales, and reports for the retail stand',
  icon: 'fas fa-store',
  link: '/stand',
  linkText: 'Open Stand'
}
```
Live KPIs live inside the `Stand.tsx` landing page — keeping the dashboard card a plain nav tile for visual consistency with the other cards.

### Hook — `public/js/hooks/useStand.ts`
Follow `useExpenses.ts` pattern (fetch hooks + mutation hook that accepts `onSuccess` refetch callback):
- `useStandItems(filters)`, `useStandItem(id)`, `useStandItemByBarcode(barcode)`
- `useStandCategories()`
- `useStandDashboardKPIs()` — polled or refetched on focus
- `useStandSales(filters)`, `useStandSale(id)`
- `useLowStockItems()`, `useExpiringItems(daysAhead)`
- `useStandItemMutations(onSuccess)` — `createItem`, `updateItem`, `deleteItem`, `restockItem`, `adjustStock`
- `useStandSaleMutations(onSuccess)` — `createSale`, `voidSale`

### Components — `public/js/components/stand/`
CSS Modules co-located. NO inline styles, NO `!important`. Use `variables.css` tokens. Use `useToast()` for all feedback.

**Inventory management**
- `ItemTable.tsx` + `.module.css` — columns: name, SKU, category, stock (badge: in/low/out), cost, sell, profit, expiry (badge if near), actions
- `ItemFilters.tsx` + `.module.css` — search, category, stock-status, show inactive toggle
- `ItemFormModal.tsx` + `.module.css` — fields: name, SKU, barcode, category, cost, sell (show computed profit live), initial stock, reorder level, expiry, unit, notes
- `RestockModal.tsx` + `.module.css` — quantity, unit cost, optional note. Purchase cost is captured in the stock movement itself (stand-internal).
- `StockAdjustModal.tsx` + `.module.css` — delta + reason (required)
- `DeleteItemModal.tsx` + `.module.css` — confirm soft delete
- `StockMovementsModal.tsx` + `.module.css` — timeline of movements for one item

**POS**
- `BarcodeInput.tsx` — autofocused `<input>` that captures keystrokes; on `Enter` calls `onScan(value)`. Works with any keyboard-wedge USB scanner — no library required. Also supports manual typing / search.
- `POSItemSearch.tsx` + `.module.css` — search box with typeahead list (by name/SKU)
- `POSCart.tsx` + `.module.css` — line items, quantity stepper, remove button, running total
- `POSCheckout.tsx` + `.module.css` — AmountPaid input, live Change calculation, payment method, optional patient link, Confirm button
- `StandPOS.tsx` ties these together

**Landing + reports**
- `StandKPICards.tsx` + `.module.css` — KPI tiles: Today's Sales, Today's Profit, Low Stock, Expiring Soon, Inventory Value
- `LowStockPanel.tsx` + `.module.css` — list + quick restock
- `ExpiringItemsPanel.tsx` + `.module.css`
- `SalesHistoryTable.tsx` + `.module.css` — with void action
- `SaleDetailModal.tsx` + `.module.css` — full sale view with line items, void button
- `SalesTrendChart.tsx` — Chart.js line chart (reuses pattern from `StatisticsComponent.tsx`)
- `TopItemsChart.tsx` — Chart.js bar chart

---

## Integration points

**The Stand is fully isolated from the existing expenses and financial reporting systems.** Stand profit and expenses are calculated entirely from stand tables (`tblStandSales`, `tblStandSaleItems`, `tblStandStockMovements`). Nothing is written to `tblExpenses`. Nothing modifies `ProcGrandTotal` / `ProcYearlyMonthlyTotals`. The Stand's money numbers will not appear in the existing Expenses page or Statistics page, and the existing pages stay untouched.

Stand-internal accounting:
- **Revenue** = `SUM(TotalAmount)` from `tblStandSales` in the period (excluding voided).
- **Cost of goods sold** = `SUM(TotalCost)` from `tblStandSales` in the period (snapshotted per line at sale time via `UnitCost` on `tblStandSaleItems`).
- **Gross profit** = `SUM(TotalProfit)` from `tblStandSales` in the period.
- **Purchase/restock spend** (separate view) = `SUM(TotalCost)` from `tblStandStockMovements WHERE MovementType = 'restock'` in the period. Reported as "Stand Purchases" on the Reports page — a stand-only expense figure, never written anywhere else.

Other integrations kept:
- **Patient link**: `PersonID` is an optional nullable FK on sales. POS checkout has an optional "link to patient" search (reuse existing `/api/patients/search`).
- **Navigation**: Dashboard card + optional secondary nav from the `Stand.tsx` landing page to Inventory / POS / Sales / Reports sub-pages.

---

## Barcode scanner support

- **Schema**: `Barcode NVARCHAR(100) NULL UNIQUE` on `tblStandItems`.
- **UI**: `BarcodeInput.tsx` is a simple autofocused input that treats USB scanner output as keyboard input. Most USB barcode scanners emulate a keyboard and append `Enter` — no library is needed to support this. Optional timing-based heuristic (bursts < 50ms = scanner, slower = human) can refine UX later.
- **Backend lookup**: `GET /stand/items/barcode/:barcode` for scanner resolution.
- **Label printing (future)**: Reuse the already-installed `qrcode@1.5.4` package (currently used for patient QR codes in `services/imaging/qrcode.ts`) to generate printable labels for items. Deferred to a later phase.

---

## Reusable patterns to copy (specific references)

| Need                         | File                                                              |
|------------------------------|-------------------------------------------------------------------|
| Route file structure         | `routes/api/expense.routes.ts`                                    |
| Query module + executeQuery  | `services/database/queries/expense-queries.ts`                    |
| Transaction in queries       | `services/database/ConnectionPool.ts` `withConnection`            |
| Service + custom error class | `services/business/PaymentService.ts` (`PaymentValidationError`)  |
| Error response helpers       | `utils/error-response.ts` (`ErrorResponses.*`)                    |
| Winston logging              | `utils/logger.ts` (`log.info/warn/error`)                         |
| Route component layout       | `public/js/routes/Expenses.tsx`                                   |
| Fetch + mutation hooks       | `public/js/hooks/useExpenses.ts`                                  |
| Modal pattern                | `public/js/components/expenses/ExpenseModal.tsx`                  |
| Filter component             | `public/js/components/expenses/ExpenseFilters.tsx`                |
| Table component              | `public/js/components/expenses/ExpenseTable.tsx`                  |
| Summary cards                | `public/js/components/expenses/ExpenseSummary.tsx`                |
| Delete confirm modal         | `public/js/components/expenses/DeleteConfirmModal.tsx`            |
| Chart.js usage               | `public/js/components/react/StatisticsComponent.tsx`              |
| Currency/number formatting   | `public/js/utils/formatters.ts` (`formatNumber`, `formatCurrency`)|
| Dashboard card registration  | `public/js/routes/Dashboard.tsx` (`dashboardCards` array)         |
| Route registration           | `public/js/router/routes.config.tsx`                              |

---

## Implementation phases

**Phase 1 — Foundation (MVP)**
1. Write `/migrations/add_stand_tables.sql`; run via `mcp__mssql__exec_sql_json`
2. Add types to `types/database.types.ts`
3. Create `stand-queries.ts` (categories + items CRUD + initial movements)
4. Create `StandService.ts` with `StandValidationError` + item validation
5. Create `stand.routes.ts` (category + item endpoints)
6. Register router in `routes/api/index.ts`
7. Create `useStand.ts` (item hooks only)
8. Create `StandInventory.tsx` + `ItemTable` + `ItemFormModal` + `ItemFilters` + `DeleteItemModal`
9. Add route to `routes.config.tsx` + dashboard card

**Phase 2 — Sales (Core)**
1. Add sales + sale-items + movements queries with `BEGIN TRAN` transaction
2. Add `validateAndCreateSale` to service
3. Add sale endpoints
4. `BarcodeInput`, `POSItemSearch`, `POSCart`, `POSCheckout`, `StandPOS.tsx`
5. Add sale mutation hooks; wire stock decrement

**Phase 3 — Stock operations**
1. Restock endpoint + `RestockModal` (purchase cost recorded in movement only)
2. Adjust endpoint + `StockAdjustModal`
3. `StockMovementsModal`
4. Low-stock + expiring queries and UI panels

**Phase 4 — Dashboard & reports**
1. KPI endpoint
2. `Stand.tsx` landing page with `StandKPICards`, `LowStockPanel`, `ExpiringItemsPanel`, quick actions
3. `StandSalesHistory.tsx` with filters + void
4. `StandReports.tsx` with Chart.js trend + top items + profit summaries. Include a "Stand Purchases" card (sum of restock totals from movements) — this is the stand's internal expense figure, separate from the global expense system.

**Phase 5 — Deferred**
- QR/barcode label printing for items (uses `qrcode` package)
- CSV bulk import of items

---

## Files to modify

- `types/database.types.ts` — add entity types
- `routes/api/index.ts` — register `standRoutes`
- `public/js/router/routes.config.tsx` — add 5 routes
- `public/js/routes/Dashboard.tsx` — add card entry

## New files

**Backend**
- `migrations/add_stand_tables.sql`
- `services/database/queries/stand-queries.ts`
- `services/business/StandService.ts`
- `routes/api/stand.routes.ts`

**Frontend**
- `public/js/hooks/useStand.ts`
- `public/js/routes/Stand.tsx` + `Stand.module.css`
- `public/js/routes/StandInventory.tsx` + `.module.css`
- `public/js/routes/StandPOS.tsx` + `.module.css`
- `public/js/routes/StandSalesHistory.tsx` + `.module.css`
- `public/js/routes/StandReports.tsx` + `.module.css`
- `public/js/components/stand/ItemTable.tsx` (+ module.css)
- `public/js/components/stand/ItemFilters.tsx` (+ module.css)
- `public/js/components/stand/ItemFormModal.tsx` (+ module.css)
- `public/js/components/stand/RestockModal.tsx` (+ module.css)
- `public/js/components/stand/StockAdjustModal.tsx` (+ module.css)
- `public/js/components/stand/DeleteItemModal.tsx` (+ module.css)
- `public/js/components/stand/StockMovementsModal.tsx` (+ module.css)
- `public/js/components/stand/BarcodeInput.tsx`
- `public/js/components/stand/POSItemSearch.tsx` (+ module.css)
- `public/js/components/stand/POSCart.tsx` (+ module.css)
- `public/js/components/stand/POSCheckout.tsx` (+ module.css)
- `public/js/components/stand/StandKPICards.tsx` (+ module.css)
- `public/js/components/stand/LowStockPanel.tsx` (+ module.css)
- `public/js/components/stand/ExpiringItemsPanel.tsx` (+ module.css)
- `public/js/components/stand/SalesHistoryTable.tsx` (+ module.css)
- `public/js/components/stand/SaleDetailModal.tsx` (+ module.css)
- `public/js/components/stand/SalesTrendChart.tsx`
- `public/js/components/stand/TopItemsChart.tsx`

---

## Verification plan

1. **Apply migration** via `mcp__mssql__exec_sql_json` — run the DDL against `ShwanNew`; verify tables exist with `SELECT name FROM sys.tables WHERE name LIKE 'tblStand%'`.
2. **Type-check**: `npm run typecheck:all` — both backend and frontend must pass strict mode.
3. **Lint**: `npm run lint`.
4. **Start dev**: `npm run dev`; login as `Admin` / `Yarmok11`.
5. **End-to-end manual test**:
   - Navigate to Stand from the Dashboard card.
   - Create a category "Oral Hygiene".
   - Add an item: name "Colgate Mouthwash 250ml", cost 3000, sell 5000, initial stock 20, reorder level 5, barcode "123456789", expiry +1 year.
   - Confirm it appears in the inventory list with a computed profit of 2000 and "In Stock" badge.
   - Open POS, type or scan "123456789", add 2 to cart, enter AmountPaid 10000, confirm. Expect Change 0, stock now 18.
   - Restock 30 units @ cost 2800. Confirm stock now 48 and a `restock` movement with `TotalCost = 84000` appears in the item's history. Confirm **no** new row was added to `/expenses` (stand is fully isolated).
   - Adjust -1 with reason "breakage". Confirm stock now 47 and movement appears in the item's history.
   - Dashboard KPIs should show today's sales count, revenue, profit, and 0 low-stock.
   - Add an item with stock 2 and reorder 5 to confirm low-stock panel populates.
   - Try to sell more than available — expect a clear `INSUFFICIENT_STOCK` toast error.
   - Void the first sale — expect stock to return to 20 and a reverse movement row.
6. **DB audit**: via the mssql MCP, `SELECT * FROM tblStandStockMovements WHERE ItemID = <id> ORDER BY MovementDate` — confirm every change (initial, sale, restock, adjustment, void) appears in order.
