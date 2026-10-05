/**
 * ExpiringItemsPanel Component
 * Displays items past or approaching their expiry date, with the number of
 * days remaining colour-coded by urgency.
 *
 * The server now sends expired items that are still in stock too (they used to
 * drop out of the list on their expiry day, so the "Expired …" state below could
 * never show — FE-F19-2).
 */
import type { StandItem } from '../../hooks/useStand';
import { formatLocaleDate } from '../../utils/formatters';
import { daysUntil, localToday } from '../../utils/expiryDate';
import styles from './ExpiringItemsPanel.module.css';

interface ExpiringItemsPanelProps {
  items: StandItem[];
  /** When the list was read; days are counted from that day, not from the panel's mount. */
  asOf: number;
  loading: boolean;
}

/** The CSS module class for days-remaining urgency. */
function getDaysClass(days: number): string {
  if (days < 0) return styles.expired;
  if (days <= 3) return styles.urgent;
  if (days <= 14) return styles.warning;
  return styles.normal;
}

/** A human-readable label for days remaining. */
function getDaysLabel(days: number): string {
  if (days < 0) return `Expired ${Math.abs(days)}d ago`;
  if (days === 0) return 'Expires today';
  if (days === 1) return '1 day left';
  return `${days} days left`;
}

export default function ExpiringItemsPanel({ items, asOf, loading }: ExpiringItemsPanelProps) {
  const today = localToday(asOf);
  const itemsWithDays = items
    .filter((item): item is StandItem & { expiry_date: string } => item.expiry_date != null)
    .map((item) => ({ item, days: daysUntil(item.expiry_date, today) }))
    .sort((a, b) => a.days - b.days);

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h3 className={styles.title}>
          <i className="fas fa-clock" aria-hidden="true" />
          Expired &amp; Expiring Soon
        </h3>
        {itemsWithDays.length > 0 && <span className={styles.count}>{itemsWithDays.length}</span>}
      </div>

      {loading ? (
        <div className={styles.loadingState}>
          <div className={styles.spinner} />
        </div>
      ) : itemsWithDays.length === 0 ? (
        <div className={styles.emptyState}>
          <i className="fas fa-check-circle" aria-hidden="true" />
          <p>Nothing expired or expiring soon</p>
        </div>
      ) : (
        <ul className={styles.list}>
          {itemsWithDays.map(({ item, days }) => (
            <li key={item.item_id} className={styles.item}>
              <div className={styles.itemInfo}>
                <span className={styles.itemName}>{item.item_name}</span>
                <div className={styles.expiryInfo}>
                  <span className={styles.expiryDate}>{formatLocaleDate(item.expiry_date)}</span>
                  <span className={`${styles.daysRemaining} ${getDaysClass(days)}`}>{getDaysLabel(days)}</span>
                </div>
              </div>
              <span className={styles.stockBadge}>
                <i className="fas fa-cubes" aria-hidden="true" />
                {item.current_stock}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
