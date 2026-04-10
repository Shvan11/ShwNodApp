/**
 * ExpiringItemsPanel Component
 * Displays items approaching their expiry date, with the number of
 * days remaining colour-coded by urgency.
 */
import React, { useMemo } from 'react';
import type { StandItem } from '../../hooks/useStand';
import styles from './ExpiringItemsPanel.module.css';

interface ExpiringItemsPanelProps {
  items: StandItem[];
  loading: boolean;
}

/**
 * Calculate the number of calendar days between two dates.
 * Returns a negative value if the target date is in the past.
 */
function daysBetween(from: Date, to: Date): number {
  const msPerDay = 86_400_000;
  const fromStart = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const toStart = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((toStart.getTime() - fromStart.getTime()) / msPerDay);
}

/**
 * Format a date string as DD/MM/YYYY.
 */
function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.getDate().toString().padStart(2, '0');
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Return the CSS module class for days-remaining urgency.
 */
function getDaysClass(days: number): string {
  if (days < 0) return styles.expired;
  if (days <= 3) return styles.urgent;
  if (days <= 14) return styles.warning;
  return styles.normal;
}

/**
 * Return a human-readable label for days remaining.
 */
function getDaysLabel(days: number): string {
  if (days < 0) return `Expired ${Math.abs(days)}d ago`;
  if (days === 0) return 'Expires today';
  if (days === 1) return '1 day left';
  return `${days} days left`;
}

const ExpiringItemsPanel: React.FC<ExpiringItemsPanelProps> = ({ items, loading }) => {
  const today = useMemo(() => new Date(), []);

  const itemsWithDays = useMemo(
    () =>
      items
        .filter((item) => item.ExpiryDate != null)
        .map((item) => {
          const days = daysBetween(today, new Date(item.ExpiryDate as string));
          return { item, days };
        })
        .sort((a, b) => a.days - b.days),
    [items, today],
  );

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h3 className={styles.title}>
          <i className="fas fa-clock" />
          Expiring Soon
        </h3>
        {itemsWithDays.length > 0 && (
          <span className={styles.count}>{itemsWithDays.length}</span>
        )}
      </div>

      {loading ? (
        <div className={styles.loadingState}>
          <div className={styles.spinner} />
        </div>
      ) : itemsWithDays.length === 0 ? (
        <div className={styles.emptyState}>
          <i className="fas fa-check-circle" />
          <p>No items expiring soon</p>
        </div>
      ) : (
        <ul className={styles.list}>
          {itemsWithDays.map(({ item, days }) => (
            <li key={item.ItemID} className={styles.item}>
              <div className={styles.itemInfo}>
                <span className={styles.itemName}>{item.ItemName}</span>
                <div className={styles.expiryInfo}>
                  <span className={styles.expiryDate}>
                    {formatDate(item.ExpiryDate as string)}
                  </span>
                  <span className={`${styles.daysRemaining} ${getDaysClass(days)}`}>
                    {getDaysLabel(days)}
                  </span>
                </div>
              </div>
              <span className={styles.stockBadge}>
                <i className="fas fa-cubes" />
                {item.CurrentStock}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default React.memo(ExpiringItemsPanel);
