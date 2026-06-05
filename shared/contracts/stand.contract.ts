/**
 * API contract — stand / mini-pharmacy endpoints (Phase 2).
 *
 * Single source of truth for each stand endpoint's request + response shapes,
 * imported by BOTH the Express routes (relative `.js`) and the React app
 * (`@shared` alias). One exported `const <action> = { body?, params?, query?,
 * response } as const` per endpoint; types via `z.infer`.
 * See docs/shared-contract-progress.md + the plan.
 *
 * Stand is the N13 victim (a `patients/search` array-vs-`{patients}` change
 * silently broke a POS consumer) — so the responses here assert the CONTAINER
 * (array vs object) + the stable ids the consumer reads, staying `z.looseObject`
 * on the long tail. Request bodies for the 5 body-validated sites are fully
 * enumerated → `z.infer` SSoT; the inline `stand*BodySchema` schemas move here.
 *
 * Phase-2 scope decisions (see the dated Findings in the progress tracker):
 *  - Only the 10 EXISTING `validate()` sites are converted to reference the
 *    contract (5 bodies + 7 param sets). No NEW request validation is added —
 *    in particular POST /stand/sales keeps its deliberate "the validateAnd…
 *    service IS the cart boundary" design (no route-level body schema), so
 *    `createSale` is response-only here.
 *  - Void-style handlers that `sendSuccess(res, null)` keep doing so (no payload
 *    to type) — their contract entry carries only `params`/`body`.
 *  - `timestamp` (Date-on-server) columns use the shared `timestampString`
 *    primitive; `date` columns (`expiry_date`) are plain `z.string()`.
 */
import { z } from 'zod';
import { idParams, timestampString } from '../validation.js';

// ===========================================================================
// Shared response row schemas (looseObject — preserve long-tail for the client,
// since core/http returns the PARSED payload). Field set mirrors the
// hand-written interfaces in public/js/hooks/useStand.ts, which become z.infer
// re-exports of these.
// ===========================================================================

const standCategoryRow = z.looseObject({
  category_id: z.number(),
  category_name: z.string(),
  is_active: z.boolean(),
});
export type StandCategory = z.infer<typeof standCategoryRow>;

const standItemRow = z.looseObject({
  item_id: z.number(),
  item_name: z.string(),
  sku: z.string().nullable(),
  barcode: z.string().nullable(),
  category_id: z.number().nullable(),
  cost_price: z.number(),
  sell_price: z.number(),
  current_stock: z.number(),
  reorder_level: z.number(),
  expiry_date: z.string().nullable(), // PG `date` → string on BOTH sides
  unit: z.string().nullable(),
  notes: z.string().nullable(),
  is_active: z.boolean(),
  date_added: timestampString, // PG `timestamp` → Date(server)/string(client)
  modified_date: timestampString.nullable(),
  created_by: z.number().nullable(),
  category_name: z.string().nullable(),
});
export type StandItem = z.infer<typeof standItemRow>;

// Build the sale header from a reusable field map so the with-items variant can
// extend it without a fragile `.extend()` on a catchall object.
const standSaleFields = {
  sale_id: z.number(),
  sale_date: timestampString,
  total_amount: z.number(),
  total_cost: z.number(),
  total_profit: z.number(),
  amount_paid: z.number(),
  change: z.number(),
  payment_method: z.string(),
  customer_note: z.string().nullable(),
  person_id: z.number().nullable(),
  cashier_id: z.number().nullable(),
  voided_date: timestampString.nullable(),
  voided_by: z.number().nullable(),
  void_reason: z.string().nullable(),
  patient_name: z.string().nullable(),
  CashierName: z.string().nullable(),
};
const standSaleRow = z.looseObject(standSaleFields);
export type StandSale = z.infer<typeof standSaleRow>;

const standSaleItemRow = z.looseObject({
  sale_item_id: z.number(),
  sale_id: z.number(),
  item_id: z.number(),
  quantity: z.number(),
  unit_price: z.number(),
  unit_cost: z.number(),
  line_total: z.number(),
  item_name: z.string(),
});
export type StandSaleItem = z.infer<typeof standSaleItemRow>;

const standSaleWithItemsRow = z.looseObject({
  ...standSaleFields,
  Items: z.array(standSaleItemRow),
});
export type StandSaleWithItems = z.infer<typeof standSaleWithItemsRow>;

const standMovementRow = z.looseObject({
  movement_id: z.number(),
  item_id: z.number(),
  movement_type: z.string(),
  quantity: z.number(),
  unit_cost: z.number().nullable(),
  total_cost: z.number().nullable(),
  related_sale_id: z.number().nullable(),
  reason: z.string().nullable(),
  movement_date: timestampString,
  performed_by: z.number().nullable(),
  PerformedByName: z.string().nullable(),
});
export type StandStockMovement = z.infer<typeof standMovementRow>;

const salesSummaryRow = z.looseObject({
  sale_date: z.string(), // `to_char(... )` → string on the server already
  SalesCount: z.number(),
  Revenue: z.number(),
  Cost: z.number(),
  Profit: z.number(),
});
export type SalesSummaryRow = z.infer<typeof salesSummaryRow>;

const topItemRow = z.looseObject({
  item_id: z.number(),
  item_name: z.string(),
  TotalQuantity: z.number(),
  TotalRevenue: z.number(),
  total_profit: z.number(),
});
export type TopItemRow = z.infer<typeof topItemRow>;

// ===========================================================================
// DASHBOARD — GET /api/stand/dashboard (closed container: 6 numbers).
// ===========================================================================

export const dashboard = {
  response: z.object({
    todaySalesCount: z.number(),
    todayRevenue: z.number(),
    todayProfit: z.number(),
    lowStockCount: z.number(),
    expiringSoonCount: z.number(),
    totalInventoryValue: z.number(),
  }),
} as const;
export type StandDashboardKPIs = z.infer<typeof dashboard.response>;

// ===========================================================================
// CATEGORIES
// ===========================================================================

// GET /api/stand/categories — array of active categories.
export const categories = {
  response: z.array(standCategoryRow),
} as const;
export type CategoriesResponse = z.infer<typeof categories.response>;

// POST /api/stand/categories — { name } → { category_id } (201).
export const createCategory = {
  body: z.object({ name: z.string().min(1, 'category name is required') }),
  response: z.object({ category_id: z.number() }),
} as const;
export type CreateCategoryBody = z.infer<typeof createCategory.body>;
export type CreateCategoryResponse = z.infer<typeof createCategory.response>;

// PUT /api/stand/categories/:id — partial update, sendSuccess(null). The body
// ({ categoryName?, isActive? }) is NOT route-validated today (forwarded to the
// service); left unchanged this phase — only `:id` is validated.
export const updateCategory = { params: idParams('id') } as const;

// DELETE /api/stand/categories/:id — deactivate, sendSuccess(null).
export const deleteCategory = { params: idParams('id') } as const;

// ===========================================================================
// ITEMS
// ===========================================================================

// GET /api/stand/items?search=&categoryId=&stockStatus=&includeInactive=
export const items = {
  response: z.array(standItemRow),
} as const;
export type ItemsResponse = z.infer<typeof items.response>;

// GET /api/stand/items/low-stock
export const itemsLowStock = {
  response: z.array(standItemRow),
} as const;

// GET /api/stand/items/expiring?days=
export const itemsExpiring = {
  response: z.array(standItemRow),
} as const;

// GET /api/stand/items/barcode/:barcode — single item (404 when unknown).
export const itemByBarcode = {
  response: standItemRow,
} as const;

// GET /api/stand/items/:id — single item (404 when unknown).
export const itemById = {
  response: standItemRow,
} as const;

// POST /api/stand/items/scan-vision — Gemini structured product extraction.
// Body: { images } (existing schema). Response: the AI's parsed JSON. The four
// fields Gemini marks `required` are modeled required; barcode/expiry_date are
// nullable+optional (Gemini emits them as null per its schema, but tolerate
// absence rather than fail-loud on unreliable model output). looseObject.
export const scanVision = {
  body: z.object({ images: z.array(z.string()) }),
  response: z.looseObject({
    item_name: z.string(),
    barcode: z.string().nullable().optional(),
    expiry_date: z.string().nullable().optional(),
    CategorySuggestion: z.string(),
    unit: z.string(),
    notes: z.string(),
  }),
} as const;
export type ScanVisionBody = z.infer<typeof scanVision.body>;
export type VisionScanResult = z.infer<typeof scanVision.response>;

// POST /api/stand/items — create item → { item_id } (201).
// Body fully enumerated (mirrors the service's `StandItemCreateData` exactly —
// every field addStandItem() reads; `createdBy` is injected by the handler).
// Required: itemName, costPrice, sellPrice (validate 400s without them); the rest
// are optional (the query `?? `-defaults them). expiryDate stays a permissive
// string (NOT `dateString`) — the service does `|| null` with no validation.
// Strict `z.object`: the handler REST-SPREADS `...req.body` into addStandItem, and
// the enumeration is verified-complete, so strip safely closes over-posting.
export const createItem = {
  body: z.object({
    itemName: z.string().min(1),
    sku: z.string().nullable().optional(),
    barcode: z.string().nullable().optional(),
    categoryId: z.coerce.number().int().positive().nullable().optional(),
    costPrice: z.coerce.number(),
    sellPrice: z.coerce.number(),
    currentStock: z.coerce.number().optional(),
    reorderLevel: z.coerce.number().optional(),
    expiryDate: z.string().nullable().optional(),
    unit: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  }),
  response: z.object({ item_id: z.number() }),
} as const;
export type CreateItemBody = z.infer<typeof createItem.body>;
export type CreateItemResponse = z.infer<typeof createItem.response>;

// PUT /api/stand/items/:id — partial update, sendSuccess(null). Body forwarded
// to the service (unvalidated today); only `:id` is validated.
export const updateItem = { params: idParams('id') } as const;

// DELETE /api/stand/items/:id — soft delete, sendSuccess(null).
export const deleteItem = { params: idParams('id') } as const;

// POST /api/stand/items/:id/restock — { quantity, unitCost }, sendSuccess(null).
export const restock = {
  params: idParams('id'),
  body: z.object({ quantity: z.coerce.number(), unitCost: z.coerce.number() }),
} as const;
export type RestockBody = z.infer<typeof restock.body>;

// POST /api/stand/items/:id/adjust — { delta, reason }, sendSuccess(null).
export const adjust = {
  params: idParams('id'),
  body: z.object({ delta: z.coerce.number(), reason: z.string().min(1) }),
} as const;
export type AdjustBody = z.infer<typeof adjust.body>;

// GET /api/stand/items/:id/movements — stock movement history.
export const itemMovements = {
  response: z.array(standMovementRow),
} as const;

// ===========================================================================
// SALES
// ===========================================================================

// POST /api/stand/sales — create a POS sale (201). RESPONSE-ONLY: the cart body
// is owned by validateAndCreateSale (the service IS the boundary; no route
// validate). The service returns { saleId, totalAmount, totalCost, totalProfit,
// amountPaid, change, items } — the consumer reads saleId + change, so model
// those (stable) and keep the rest loose.
export const createSale = {
  response: z.looseObject({ saleId: z.number(), change: z.number() }),
} as const;
export type StandSaleResult = z.infer<typeof createSale.response>;

// GET /api/stand/sales?startDate=&endDate=&cashierId=&personId=&limit=&offset=
export const sales = {
  response: z.array(standSaleRow),
} as const;
export type SalesResponse = z.infer<typeof sales.response>;

// GET /api/stand/sales/:id — sale header + line items (404 when unknown).
export const saleById = {
  response: standSaleWithItemsRow,
} as const;

// POST /api/stand/sales/:id/void — void a sale, sendSuccess(null). Body { reason }
// is checked by the handler (not route-validated); only `:id` is validated.
export const voidSale = { params: idParams('id') } as const;

// ===========================================================================
// REPORTS
// ===========================================================================

// GET /api/stand/reports/summary?startDate=&endDate=
export const reportSummary = {
  response: z.object({
    salesSummary: z.array(salesSummaryRow),
    purchases: z.object({ totalPurchases: z.number(), restockCount: z.number() }),
  }),
} as const;
export type StandReportData = z.infer<typeof reportSummary.response>;

// GET /api/stand/reports/top-items?startDate=&endDate=&limit=
export const reportTopItems = {
  response: z.array(topItemRow),
} as const;
export type ReportTopItemsResponse = z.infer<typeof reportTopItems.response>;
