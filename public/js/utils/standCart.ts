/**
 * The Stand till's cart, as pure functions over an immutable list (unit-tested).
 *
 * Each returns the next cart plus an optional `notice` for the till to show. The
 * notices used to be toasted from inside a `setCart` updater, a side effect React
 * runs twice in development (audit FE-F19-14c); the caller now shows them after
 * deciding the next cart.
 */
import type { StandItem } from '@shared/contracts/stand.contract';

export interface CartItem {
  item: StandItem;
  quantity: number;
  /** Past its expiry when it was added (the cashier confirmed the sale). */
  expired?: boolean;
}

interface CartNotice {
  level: 'warning' | 'error';
  message: string;
}

export interface CartChange {
  cart: CartItem[];
  notice?: CartNotice;
}

/** Sum of the lines at the prices the cart holds (integer IQD). */
export function cartTotal(cart: readonly CartItem[]): number {
  return cart.reduce((sum, ci) => sum + ci.item.sell_price * ci.quantity, 0);
}

/**
 * Add one unit of `item`. The row just read from the server replaces the line's
 * snapshot, so a re-scan picks up a new price or stock count. `expired` is decided
 * by the caller (it needs today's date) and kept on the line.
 */
export function addItem(cart: CartItem[], item: StandItem, expired = false): CartChange {
  const existing = cart.find((ci) => ci.item.item_id === item.item_id);
  if (existing) {
    if (existing.quantity >= item.current_stock) {
      return {
        cart,
        notice: { level: 'warning', message: `Only ${item.current_stock} of "${item.item_name}" in stock` },
      };
    }
    return {
      cart: cart.map((ci) => (ci.item.item_id === item.item_id ? { ...ci, item, quantity: ci.quantity + 1 } : ci)),
    };
  }
  if (item.current_stock <= 0) {
    return { cart, notice: { level: 'error', message: `"${item.item_name}" is out of stock` } };
  }
  return { cart: [...cart, expired ? { item, quantity: 1, expired } : { item, quantity: 1 }] };
}

/** Set a line's quantity: 0 or less removes it, more than the stock is capped at the stock. */
export function setQuantity(cart: CartItem[], itemId: number, quantity: number): CartChange {
  if (quantity <= 0) return { cart: cart.filter((ci) => ci.item.item_id !== itemId) };
  const line = cart.find((ci) => ci.item.item_id === itemId);
  if (!line) return { cart };
  if (quantity > line.item.current_stock) {
    return {
      cart: cart.map((ci) => (ci === line ? { ...ci, quantity: line.item.current_stock } : ci)),
      notice: { level: 'warning', message: `Only ${line.item.current_stock} of "${line.item.item_name}" in stock` },
    };
  }
  return { cart: cart.map((ci) => (ci === line ? { ...ci, quantity } : ci)) };
}

export function removeItem(cart: CartItem[], itemId: number): CartItem[] {
  return cart.filter((ci) => ci.item.item_id !== itemId);
}

/** Apply the current prices the server sent with a `PRICE_CHANGED` refusal. */
export function repriceCart(cart: CartItem[], prices: ReadonlyArray<{ itemId: number; unitPrice: number }>): CartItem[] {
  const byId = new Map(prices.map((p) => [p.itemId, p.unitPrice]));
  return cart.map((ci) => {
    const price = byId.get(ci.item.item_id);
    return price === undefined || price === ci.item.sell_price ? ci : { ...ci, item: { ...ci.item, sell_price: price } };
  });
}
