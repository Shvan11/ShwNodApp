/**
 * LowStockPanel Component
 * Displays a compact list of items below their reorder level,
 * with a restock action button for each item.
 */
import React from 'react';
import type { StandItem } from '../../hooks/useStand';
import styles from './LowStockPanel.module.css';

interface LowStockPanelProps {
  items: StandItem[];
  loading: boolean;
  onRestock: (item: StandItem) => void;
}

const LowStockPanel: React.FC<LowStockPanelProps> = ({ items, loading, onRestock }) => {
  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h3 className={styles.title}>
          <i className="fas fa-exclamation-triangle" />
          Low Stock Items
        </h3>
        {items.length > 0 && (
          <span className={styles.count}>{items.length}</span>
        )}
      </div>

      {loading ? (
        <div className={styles.loadingState}>
          <div className={styles.spinner} />
        </div>
      ) : items.length === 0 ? (
        <div className={styles.emptyState}>
          <i className="fas fa-check-circle" />
          <p>All items are well-stocked</p>
        </div>
      ) : (
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={item.item_id} className={styles.item}>
              <div className={styles.itemInfo}>
                <span className={styles.itemName}>{item.item_name}</span>
                <div className={styles.stockLevel}>
                  <span className={styles.currentStock}>{item.current_stock}</span>
                  <span className={styles.separator}>/</span>
                  <span className={styles.reorderLevel}>{item.reorder_level}</span>
                </div>
              </div>
              <button
                className={styles.restockBtn}
                onClick={() => onRestock(item)}
                type="button"
              >
                <i className="fas fa-plus" />
                Restock
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default React.memo(LowStockPanel);
