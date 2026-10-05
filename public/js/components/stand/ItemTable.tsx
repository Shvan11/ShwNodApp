/**
 * ItemTable Component
 * Displays stand inventory items in a table with stock badges, profit, expiry warnings, and action buttons
 */
import type { StandItem } from '../../hooks/useStand';
import { formatNumber, formatLocaleDate } from '../../utils/formatters';
import { daysUntil, localToday } from '../../utils/expiryDate';
import styles from './ItemTable.module.css';

interface ItemTableProps {
  items: StandItem[];
  /** When the list was read (the query's `dataUpdatedAt`); expiry is judged on that day. */
  asOf: number;
  loading: boolean;
  /** Delete, Adjust and Reactivate are admin-only on the server (FE-F19-7). */
  canAdmin: boolean;
  onEdit: (item: StandItem) => void;
  onDelete: (item: StandItem) => void;
  onReactivate: (item: StandItem) => void;
  onRestock: (item: StandItem) => void;
  onAdjust: (item: StandItem) => void;
  onMovements: (item: StandItem) => void;
}

function getStockBadge(currentStock: number, reorderLevel: number): { label: string; className: string } {
  if (currentStock <= 0) {
    return { label: 'Out', className: styles.stockOut };
  }
  if (currentStock <= reorderLevel) {
    return { label: 'Low', className: styles.stockLow };
  }
  return { label: 'In Stock', className: styles.stockInStock };
}

/**
 * `expiry_date` is a `'YYYY-MM-DD'` day, compared as local days: `new Date(expiry)`
 * is UTC midnight, which flagged an item "expired" from 03:00 on its last good day
 * here and a day early west of UTC (FE-F19-12).
 */
function expiryStatus(expiryDate: string | null, today: string): 'expired' | 'warning' | null {
  if (!expiryDate) return null;
  const days = daysUntil(expiryDate, today);
  if (days < 0) return 'expired';
  if (days <= 30) return 'warning';
  return null;
}

export default function ItemTable({
  items,
  asOf,
  loading,
  canAdmin,
  onEdit,
  onDelete,
  onReactivate,
  onRestock,
  onAdjust,
  onMovements,
}: ItemTableProps) {
  const today = localToday(asOf);

  if (loading) {
    return (
      <div className={styles.loadingState}>
        <div className={styles.loadingSpinner}></div>
        <p>Loading items...</p>
      </div>
    );
  }

  if (!items || items.length === 0) {
    return (
      <div className={styles.emptyState}>
        <p>No items found</p>
      </div>
    );
  }

  return (
    <div className={styles.tableScrollWrapper}>
      <div className={styles.tableContainer}>
        <table className={styles.itemsTable}>
          <thead>
            <tr>
              <th>Name</th>
              <th>SKU</th>
              <th>Category</th>
              <th>Stock</th>
              <th>Cost</th>
              <th>Sell</th>
              <th>Profit</th>
              <th>Expiry</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const stockBadge = getStockBadge(item.current_stock, item.reorder_level);
              const profit = item.sell_price - item.cost_price;
              const expiry = expiryStatus(item.expiry_date, today);

              return (
                <tr
                  key={item.item_id}
                  className={!item.is_active ? styles.inactiveRow : undefined}
                >
                  <td>{item.item_name}</td>
                  <td>{item.sku || '-'}</td>
                  <td>{item.category_name || '-'}</td>
                  <td>
                    <span className={`${styles.stockBadge} ${stockBadge.className}`}>
                      {item.current_stock} &middot; {stockBadge.label}
                    </span>
                  </td>
                  <td className={styles.amountCell}>{formatNumber(item.cost_price)}</td>
                  <td className={styles.amountCell}>{formatNumber(item.sell_price)}</td>
                  <td
                    className={`${styles.profitCell} ${profit < 0 ? styles.profitNegative : ''}`}
                  >
                    {formatNumber(profit)}
                  </td>
                  <td>
                    {item.expiry_date ? (
                      <span
                        className={
                          expiry === 'expired'
                            ? `${styles.expiryBadge} ${styles.expiryExpired}`
                            : expiry === 'warning'
                              ? `${styles.expiryBadge} ${styles.expiryWarning}`
                              : undefined
                        }
                      >
                        {formatLocaleDate(item.expiry_date)}
                      </span>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td>
                    <div className={styles.actionButtons}>
                      <button
                        className={`${styles.actionBtn} ${styles.btnEdit}`}
                        onClick={() => onEdit(item)}
                        aria-label={`Edit ${item.item_name}`}
                      >
                        Edit
                      </button>
                      {item.is_active && (
                        <button
                          className={`${styles.actionBtn} ${styles.btnRestock}`}
                          onClick={() => onRestock(item)}
                          aria-label={`Restock ${item.item_name}`}
                        >
                          Restock
                        </button>
                      )}
                      {item.is_active && canAdmin && (
                        <button
                          className={`${styles.actionBtn} ${styles.btnAdjust}`}
                          onClick={() => onAdjust(item)}
                          aria-label={`Adjust stock for ${item.item_name}`}
                        >
                          Adjust
                        </button>
                      )}
                      <button
                        className={`${styles.actionBtn} ${styles.btnMovements}`}
                        onClick={() => onMovements(item)}
                        aria-label={`View movements for ${item.item_name}`}
                      >
                        Movements
                      </button>
                      {canAdmin &&
                        (item.is_active ? (
                          <button
                            className={`${styles.actionBtn} ${styles.btnDelete}`}
                            onClick={() => onDelete(item)}
                            aria-label={`Delete ${item.item_name}`}
                          >
                            Delete
                          </button>
                        ) : (
                          // A deleted item comes back here: its barcode and SKU stay
                          // reserved by it, so re-adding the product can't (FE-F19-8).
                          <button
                            className={`${styles.actionBtn} ${styles.btnRestock}`}
                            onClick={() => onReactivate(item)}
                            aria-label={`Reactivate ${item.item_name}`}
                          >
                            Reactivate
                          </button>
                        ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
