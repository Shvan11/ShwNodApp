import { describe, expect, it } from 'vitest';
import type { StandItem } from '@shared/contracts/stand.contract';
import { addItem, cartTotal, removeItem, repriceCart, setQuantity, type CartItem } from './standCart';

const item = (id: number, price: number, stock: number): StandItem => ({
  item_id: id,
  item_name: `Item ${id}`,
  sku: null,
  barcode: null,
  category_id: null,
  cost_price: Math.round(price / 2),
  sell_price: price,
  current_stock: stock,
  reorder_level: 1,
  expiry_date: null,
  unit: null,
  notes: null,
  is_active: true,
  date_added: '2026-10-01T09:00:00.000Z',
  updated_at: null,
  created_by: null,
  category_name: null,
});

describe('addItem', () => {
  it('adds a new line, then counts up on a re-add', () => {
    let { cart } = addItem([], item(1, 5000, 3));
    ({ cart } = addItem(cart, item(1, 5000, 3)));
    expect(cart).toHaveLength(1);
    expect(cart[0].quantity).toBe(2);
    expect(cartTotal(cart)).toBe(10000);
  });

  it('refuses an out-of-stock item and caps at the stock', () => {
    const out = addItem([], item(2, 1000, 0));
    expect(out.cart).toHaveLength(0);
    expect(out.notice?.level).toBe('error');

    const one: CartItem[] = [{ item: item(3, 1000, 1), quantity: 1 }];
    const capped = addItem(one, item(3, 1000, 1));
    expect(capped.cart).toBe(one);
    expect(capped.notice?.level).toBe('warning');
  });

  it('takes the fresh row on a re-add, so a new price shows', () => {
    const { cart } = addItem([{ item: item(4, 1000, 5), quantity: 1 }], item(4, 1500, 5));
    expect(cart[0].item.sell_price).toBe(1500);
    expect(cartTotal(cart)).toBe(3000);
  });
});

describe('setQuantity / removeItem', () => {
  const cart: CartItem[] = [{ item: item(1, 2000, 4), quantity: 1 }, { item: item(2, 500, 9), quantity: 2 }];

  it('sets, caps and removes', () => {
    expect(setQuantity(cart, 1, 3).cart[0].quantity).toBe(3);
    const capped = setQuantity(cart, 1, 10);
    expect(capped.cart[0].quantity).toBe(4);
    expect(capped.notice?.level).toBe('warning');
    expect(setQuantity(cart, 2, 0).cart).toHaveLength(1);
    expect(removeItem(cart, 1).map((ci) => ci.item.item_id)).toEqual([2]);
  });
});

describe('repriceCart', () => {
  it('applies the server prices and leaves the rest alone', () => {
    const cart: CartItem[] = [{ item: item(1, 2000, 4), quantity: 2 }, { item: item(2, 500, 9), quantity: 1 }];
    const next = repriceCart(cart, [{ itemId: 1, unitPrice: 2500 }, { itemId: 2, unitPrice: 500 }]);
    expect(cartTotal(next)).toBe(5500);
    expect(next[1]).toBe(cart[1]);
  });
});
