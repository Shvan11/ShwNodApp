/**
 * Stand Service - Business Logic Layer
 *
 * Handles all stand/mini-pharmacy business logic including:
 * - Sale validation and creation (multi-item POS)
 * - Stock validation (restock, adjustment)
 * - Void validation
 */

import { log } from '../../utils/logger.js';
import {
  getStandItemById,
  createStandSaleTransaction,
  restockItem,
  adjustStock,
  getStandSaleById,
  voidStandSale,
} from '../database/queries/stand-queries.js';

// ============================================================================
// ERROR TYPES
// ============================================================================

export type StandErrorCode =
  | 'INSUFFICIENT_STOCK'
  | 'ITEM_INACTIVE'
  | 'ITEM_NOT_FOUND'
  | 'INVALID_QUANTITY'
  | 'NEGATIVE_CHANGE'
  | 'UNDERPAID'
  | 'SELL_BELOW_COST'
  | 'SALE_NOT_FOUND'
  | 'ALREADY_VOIDED';

export class StandValidationError extends Error {
  public readonly code: StandErrorCode;
  public readonly details: Record<string, unknown>;

  constructor(
    message: string,
    code: StandErrorCode,
    details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'StandValidationError';
    this.code = code;
    this.details = details;
  }
}

// ============================================================================
// SALE VALIDATION + CREATION
// ============================================================================

interface SaleInput {
  items: Array<{
    itemId: number;
    quantity: number;
  }>;
  amountPaid: number;
  paymentMethod?: string;
  customerNote?: string | null;
  personId?: number | null;
  cashierId?: number | null;
}

export async function validateAndCreateSale(saleData: SaleInput) {
  const { items, amountPaid, paymentMethod = 'cash', customerNote, personId, cashierId } = saleData;

  if (!items || items.length === 0) {
    throw new StandValidationError('Sale must contain at least one item', 'INVALID_QUANTITY');
  }

  // Load and validate each item
  const resolvedItems: Array<{
    itemId: number;
    quantity: number;
    unitPrice: number;
    unitCost: number;
    lineTotal: number;
    itemName: string;
  }> = [];

  for (const lineItem of items) {
    if (lineItem.quantity <= 0) {
      throw new StandValidationError(
        `Invalid quantity for item ${lineItem.itemId}`,
        'INVALID_QUANTITY',
        { itemId: lineItem.itemId, quantity: lineItem.quantity }
      );
    }

    const item = await getStandItemById(lineItem.itemId);

    if (!item) {
      throw new StandValidationError(
        `Item not found: ${lineItem.itemId}`,
        'ITEM_NOT_FOUND',
        { itemId: lineItem.itemId }
      );
    }

    if (!item.IsActive) {
      throw new StandValidationError(
        `Item is inactive: ${item.ItemName}`,
        'ITEM_INACTIVE',
        { itemId: item.ItemID, itemName: item.ItemName }
      );
    }

    if (item.CurrentStock < lineItem.quantity) {
      throw new StandValidationError(
        `Insufficient stock for "${item.ItemName}": available ${item.CurrentStock}, requested ${lineItem.quantity}`,
        'INSUFFICIENT_STOCK',
        { itemId: item.ItemID, itemName: item.ItemName, available: item.CurrentStock, requested: lineItem.quantity }
      );
    }

    resolvedItems.push({
      itemId: item.ItemID,
      quantity: lineItem.quantity,
      unitPrice: item.SellPrice,
      unitCost: item.CostPrice,
      lineTotal: lineItem.quantity * item.SellPrice,
      itemName: item.ItemName,
    });
  }

  // Compute totals
  const totalAmount = resolvedItems.reduce((sum, i) => sum + i.lineTotal, 0);
  const totalCost = resolvedItems.reduce((sum, i) => sum + i.quantity * i.unitCost, 0);
  const totalProfit = totalAmount - totalCost;

  // Validate payment
  if (amountPaid < totalAmount) {
    throw new StandValidationError(
      `Underpaid: total is ${totalAmount} IQD but only ${amountPaid} IQD received`,
      'UNDERPAID',
      { totalAmount, amountPaid }
    );
  }

  const change = amountPaid - totalAmount;

  let result;
  try {
    result = await createStandSaleTransaction({
      items: resolvedItems,
      totalAmount,
      totalCost,
      totalProfit,
      amountPaid,
      change,
      paymentMethod,
      customerNote,
      personId,
      cashierId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const m = msg.match(/^INSUFFICIENT_STOCK:(\d+)$/);
    if (m) {
      const racedId = parseInt(m[1], 10);
      const raced = resolvedItems.find((i) => i.itemId === racedId);
      throw new StandValidationError(
        `Insufficient stock for "${raced?.itemName ?? `item ${racedId}`}" — another sale drained inventory. Please reload and try again.`,
        'INSUFFICIENT_STOCK',
        { itemId: racedId, itemName: raced?.itemName, requested: raced?.quantity }
      );
    }
    throw err;
  }

  log.info(`Stand sale created: SaleID=${result.SaleID}, Total=${totalAmount}, Profit=${totalProfit}`);

  return {
    saleId: result.SaleID,
    totalAmount,
    totalCost,
    totalProfit,
    amountPaid,
    change,
    items: resolvedItems,
  };
}

// ============================================================================
// RESTOCK VALIDATION
// ============================================================================

export async function validateAndRestockItem(
  itemId: number,
  quantity: number,
  unitCost: number,
  userId: number | null
) {
  if (quantity <= 0) {
    throw new StandValidationError('Restock quantity must be positive', 'INVALID_QUANTITY', { quantity });
  }

  if (unitCost < 0) {
    throw new StandValidationError('Unit cost cannot be negative', 'INVALID_QUANTITY', { unitCost });
  }

  const item = await getStandItemById(itemId);
  if (!item) {
    throw new StandValidationError('Item not found', 'ITEM_NOT_FOUND', { itemId });
  }

  await restockItem(itemId, quantity, unitCost, userId);

  log.info(`Stand item restocked: ItemID=${itemId}, Qty=${quantity}, UnitCost=${unitCost}`);
}

// ============================================================================
// ADJUST STOCK VALIDATION
// ============================================================================

export async function validateAndAdjustStock(
  itemId: number,
  delta: number,
  reason: string,
  userId: number | null
) {
  if (delta === 0) {
    throw new StandValidationError('Adjustment delta cannot be zero', 'INVALID_QUANTITY', { delta });
  }

  if (!reason || reason.trim().length === 0) {
    throw new StandValidationError('Reason is required for stock adjustments', 'INVALID_QUANTITY');
  }

  const item = await getStandItemById(itemId);
  if (!item) {
    throw new StandValidationError('Item not found', 'ITEM_NOT_FOUND', { itemId });
  }

  if (item.CurrentStock + delta < 0) {
    throw new StandValidationError(
      `Adjustment would result in negative stock (current: ${item.CurrentStock}, delta: ${delta})`,
      'INSUFFICIENT_STOCK',
      { itemId, currentStock: item.CurrentStock, delta }
    );
  }

  try {
    await adjustStock(itemId, delta, reason, userId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'INSUFFICIENT_STOCK_FOR_ADJUSTMENT') {
      throw new StandValidationError(
        `Adjustment would result in negative stock for "${item.ItemName}" — stock changed concurrently.`,
        'INSUFFICIENT_STOCK',
        { itemId, currentStock: item.CurrentStock, delta }
      );
    }
    throw err;
  }

  log.info(`Stand stock adjusted: ItemID=${itemId}, Delta=${delta}, Reason="${reason}"`);
}

// ============================================================================
// VOID SALE VALIDATION
// ============================================================================

export async function validateAndVoidSale(
  saleId: number,
  reason: string,
  userId: number | null
) {
  const sale = await getStandSaleById(saleId);

  if (!sale) {
    throw new StandValidationError('Sale not found', 'SALE_NOT_FOUND', { saleId });
  }

  if (sale.VoidedDate) {
    throw new StandValidationError('Sale has already been voided', 'ALREADY_VOIDED', { saleId, voidedDate: sale.VoidedDate });
  }

  await voidStandSale(saleId, reason, userId);

  log.info(`Stand sale voided: SaleID=${saleId}, Reason="${reason}"`);
}
