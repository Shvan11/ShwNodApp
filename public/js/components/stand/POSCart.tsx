import React, { useCallback } from 'react';
import { formatNumber } from '../../utils/formatters';
import styles from './POSCart.module.css';

interface StandItem {
  ItemID: number;
  ItemName: string;
  SKU: string | null;
  Barcode: string | null;
  CostPrice: number;
  SellPrice: number;
  CurrentStock: number;
  CategoryName: string | null;
  IsActive: boolean;
}

export interface CartItem {
  item: StandItem;
  quantity: number;
}

interface POSCartProps {
  items: CartItem[];
  onUpdateQuantity: (itemId: number, quantity: number) => void;
  onRemove: (itemId: number) => void;
  total: number;
}

/**
 * POSCart Component
 *
 * Displays the current cart with line items. Each row shows the item name,
 * unit price, a quantity stepper (decrement / input / increment), line total,
 * and a remove button. Footer displays the running total.
 */
const POSCart: React.FC<POSCartProps> = ({
  items,
  onUpdateQuantity,
  onRemove,
  total,
}) => {
  const handleQuantityChange = useCallback(
    (itemId: number, value: string) => {
      const parsed = parseInt(value, 10);
      if (!isNaN(parsed) && parsed >= 1) {
        onUpdateQuantity(itemId, parsed);
      }
    },
    [onUpdateQuantity]
  );

  const handleIncrement = useCallback(
    (itemId: number, currentQty: number) => {
      onUpdateQuantity(itemId, currentQty + 1);
    },
    [onUpdateQuantity]
  );

  const handleDecrement = useCallback(
    (itemId: number, currentQty: number) => {
      if (currentQty > 1) {
        onUpdateQuantity(itemId, currentQty - 1);
      }
    },
    [onUpdateQuantity]
  );

  if (items.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <h3 className={styles.title}>
            <i className="fas fa-shopping-cart" /> Cart
          </h3>
        </div>
        <div className={styles.emptyState}>
          <i className={`fas fa-cart-plus ${styles.emptyIcon}`} />
          <p>Cart is empty</p>
          <span>Scan or search items to add</span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3 className={styles.title}>
          <i className="fas fa-shopping-cart" /> Cart
        </h3>
        <span className={styles.itemCount}>
          {items.length} {items.length === 1 ? 'item' : 'items'}
        </span>
      </div>

      <div className={styles.itemsList}>
        {items.map((cartItem) => {
          const lineTotal = cartItem.item.SellPrice * cartItem.quantity;
          return (
            <div key={cartItem.item.ItemID} className={styles.cartRow}>
              <div className={styles.rowInfo}>
                <span className={styles.rowName}>
                  {cartItem.item.ItemName}
                </span>
                <span className={styles.rowPrice}>
                  {formatNumber(cartItem.item.SellPrice)} IQD
                </span>
              </div>

              <div className={styles.rowActions}>
                <div className={styles.quantityStepper}>
                  <button
                    type="button"
                    className={styles.stepperButton}
                    onClick={() =>
                      handleDecrement(cartItem.item.ItemID, cartItem.quantity)
                    }
                    disabled={cartItem.quantity <= 1}
                    aria-label="Decrease quantity"
                  >
                    <i className="fas fa-minus" />
                  </button>
                  <input
                    type="number"
                    className={styles.quantityInput}
                    value={cartItem.quantity}
                    onChange={(e) =>
                      handleQuantityChange(cartItem.item.ItemID, e.target.value)
                    }
                    min={1}
                    aria-label={`Quantity for ${cartItem.item.ItemName}`}
                  />
                  <button
                    type="button"
                    className={styles.stepperButton}
                    onClick={() =>
                      handleIncrement(cartItem.item.ItemID, cartItem.quantity)
                    }
                    aria-label="Increase quantity"
                  >
                    <i className="fas fa-plus" />
                  </button>
                </div>

                <span className={styles.lineTotal}>
                  {formatNumber(lineTotal)}
                </span>

                <button
                  type="button"
                  className={styles.removeButton}
                  onClick={() => onRemove(cartItem.item.ItemID)}
                  aria-label={`Remove ${cartItem.item.ItemName}`}
                >
                  <i className="fas fa-trash-alt" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className={styles.footer}>
        <span className={styles.totalLabel}>Total</span>
        <span className={styles.totalAmount}>{formatNumber(total)} IQD</span>
      </div>
    </div>
  );
};

export default React.memo(POSCart);
