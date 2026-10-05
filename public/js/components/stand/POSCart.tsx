import { useState } from 'react';
import { formatNumber } from '../../utils/formatters';
import type { CartItem } from '../../utils/standCart';
import styles from './POSCart.module.css';

interface POSCartProps {
  items: CartItem[];
  onUpdateQuantity: (itemId: number, quantity: number) => void;
  onRemove: (itemId: number) => void;
  total: number;
}

/**
 * The quantity box keeps its own draft and commits on blur or Enter, so it can be
 * emptied to type a new number (an empty value used to be ignored, leaving the old
 * digit in place — FE-F19-14d). An empty or zero draft goes back to the quantity;
 * the trash button removes a line.
 */
function QuantityInput({ quantity, label, onCommit }: { quantity: number; label: string; onCommit: (q: number) => void }) {
  const [draft, setDraft] = useState(String(quantity));
  const commit = () => {
    const parsed = parseInt(draft, 10);
    if (Number.isNaN(parsed) || parsed < 1) setDraft(String(quantity));
    else if (parsed !== quantity) onCommit(parsed);
  };
  return (
    <input
      type="text"
      inputMode="numeric"
      className={styles.quantityInput}
      value={draft}
      onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        }
      }}
      aria-label={label}
    />
  );
}

/**
 * POSCart Component
 *
 * Displays the current cart with line items. Each row shows the item name,
 * unit price, a quantity stepper (decrement / input / increment), line total,
 * and a remove button. Footer displays the running total.
 */
export default function POSCart({ items, onUpdateQuantity, onRemove, total }: POSCartProps) {
  if (items.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <h3 className={styles.title}>
            <i className="fas fa-shopping-cart" aria-hidden="true" /> Cart
          </h3>
        </div>
        <div className={styles.emptyState}>
          <i className={`fas fa-cart-plus ${styles.emptyIcon}`} aria-hidden="true" />
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
          <i className="fas fa-shopping-cart" aria-hidden="true" /> Cart
        </h3>
        <span className={styles.itemCount}>
          {items.length} {items.length === 1 ? 'item' : 'items'}
        </span>
      </div>

      <div className={styles.itemsList}>
        {items.map(({ item, quantity, expired }) => (
          <div key={item.item_id} className={styles.cartRow}>
            <div className={styles.rowInfo}>
              <span className={styles.rowName}>
                {item.item_name}
                {expired && <span className={styles.expiredTag}>Expired</span>}
              </span>
              <span className={styles.rowPrice}>{formatNumber(item.sell_price)} IQD</span>
            </div>

            <div className={styles.rowActions}>
              <div className={styles.quantityStepper}>
                <button
                  type="button"
                  className={styles.stepperButton}
                  onClick={() => onUpdateQuantity(item.item_id, quantity - 1)}
                  disabled={quantity <= 1}
                  aria-label="Decrease quantity"
                >
                  <i className="fas fa-minus" aria-hidden="true" />
                </button>
                <QuantityInput
                  key={quantity}
                  quantity={quantity}
                  label={`Quantity for ${item.item_name}`}
                  onCommit={(q) => onUpdateQuantity(item.item_id, q)}
                />
                <button
                  type="button"
                  className={styles.stepperButton}
                  onClick={() => onUpdateQuantity(item.item_id, quantity + 1)}
                  aria-label="Increase quantity"
                >
                  <i className="fas fa-plus" aria-hidden="true" />
                </button>
              </div>

              <span className={styles.lineTotal}>{formatNumber(item.sell_price * quantity)}</span>

              <button
                type="button"
                className={styles.removeButton}
                onClick={() => onRemove(item.item_id)}
                aria-label={`Remove ${item.item_name}`}
              >
                <i className="fas fa-trash-alt" aria-hidden="true" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className={styles.footer}>
        <span className={styles.totalLabel}>Total</span>
        <span className={styles.totalAmount}>{formatNumber(total)} IQD</span>
      </div>
    </div>
  );
}
