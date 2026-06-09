/**
 * ItemTable Component
 * Displays stand inventory items in a table with stock badges, profit, expiry warnings, and action buttons
 */
import type { StandItem } from '../../hooks/useStand';
import { formatNumber } from '../../utils/formatters';
import styles from './ItemTable.module.css';

interface ItemTableProps {
  items: StandItem[];
  loading: boolean;
  onEdit: (item: StandItem) => void;
  onDelete: (item: StandItem) => void;
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

function isExpiringSoon(expiryDate: string | null): 'expired' | 'warning' | null {
  if (!expiryDate) return null;
  const now = new Date();
  const expiry = new Date(expiryDate);
  if (isNaN(expiry.getTime())) return null;
  const diffMs = expiry.getTime() - now.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  if (diffDays < 0) return 'expired';
  if (diffDays <= 30) return 'warning';
  return null;
}

function formatDate(dateString: string | null): string {
  if (!dateString) return '-';
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleDateString();
}

export default function ItemTable({
  items,
  loading,
  onEdit,
  onDelete,
  onRestock,
  onAdjust,
  onMovements,
}: ItemTableProps) {
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
              const expiryStatus = isExpiringSoon(item.expiry_date);

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
                          expiryStatus === 'expired'
                            ? `${styles.expiryBadge} ${styles.expiryExpired}`
                            : expiryStatus === 'warning'
                              ? `${styles.expiryBadge} ${styles.expiryWarning}`
                              : undefined
                        }
                      >
                        {formatDate(item.expiry_date)}
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
                      <button
                        className={`${styles.actionBtn} ${styles.btnRestock}`}
                        onClick={() => onRestock(item)}
                        aria-label={`Restock ${item.item_name}`}
                      >
                        Restock
                      </button>
                      <button
                        className={`${styles.actionBtn} ${styles.btnAdjust}`}
                        onClick={() => onAdjust(item)}
                        aria-label={`Adjust stock for ${item.item_name}`}
                      >
                        Adjust
                      </button>
                      <button
                        className={`${styles.actionBtn} ${styles.btnMovements}`}
                        onClick={() => onMovements(item)}
                        aria-label={`View movements for ${item.item_name}`}
                      >
                        Movements
                      </button>
                      <button
                        className={`${styles.actionBtn} ${styles.btnDelete}`}
                        onClick={() => onDelete(item)}
                        aria-label={`Delete ${item.item_name}`}
                      >
                        Delete
                      </button>
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
