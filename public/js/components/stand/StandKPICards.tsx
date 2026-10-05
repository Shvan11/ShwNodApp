/**
 * StandKPICards Component
 * KPI tile grid for the Stand dashboard showing today's sales metrics,
 * low stock count, inventory value, and an expiring-soon badge.
 */
import type { StandDashboardKPIs } from '../../hooks/useStand';
import { formatNumber } from '../../utils/formatters';
import styles from './StandKPICards.module.css';

interface StandKPICardsProps {
  kpis: StandDashboardKPIs | null;
  loading: boolean;
}

export default function StandKPICards({ kpis, loading }: StandKPICardsProps) {
  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loadingGrid}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className={styles.skeletonCard}>
              <div className={styles.skeletonIcon} />
              <div className={styles.skeletonLabel} />
              <div className={styles.skeletonValue} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!kpis) {
    return null;
  }

  return (
    <div className={styles.container}>
      <div className={styles.grid}>
        {/* Today's Sales Count */}
        <div className={`${styles.card} ${styles.purple}`}>
          <div className={styles.cardIcon}>
            <i className="fas fa-shopping-cart" />
          </div>
          <div className={styles.cardLabel}>Today's Sales</div>
          <div className={styles.cardValue}>{kpis.todaySalesCount}</div>
        </div>

        {/* Today's Revenue */}
        <div className={`${styles.card} ${styles.blue}`}>
          <div className={styles.cardIcon}>
            <i className="fas fa-money-bill-wave" />
          </div>
          <div className={styles.cardLabel}>Today's Revenue</div>
          <div className={styles.cardValue}>
            {formatNumber(kpis.todayRevenue)}
            <span className={styles.cardCurrency}>IQD</span>
          </div>
        </div>

        {/* Today's Profit */}
        <div className={`${styles.card} ${styles.green}`}>
          <div className={styles.cardIcon}>
            <i className="fas fa-chart-line" />
          </div>
          <div className={styles.cardLabel}>Today's Profit</div>
          <div className={styles.cardValue}>
            {formatNumber(kpis.todayProfit)}
            <span className={styles.cardCurrency}>IQD</span>
          </div>
        </div>

        {/* Low Stock */}
        <div className={`${styles.card} ${styles.orange}`}>
          <div className={styles.cardIcon}>
            <i className="fas fa-exclamation-triangle" />
          </div>
          <div className={styles.cardLabel}>Low Stock</div>
          <div className={styles.cardValue}>{kpis.lowStockCount}</div>
        </div>

        {/* Inventory Value */}
        <div className={`${styles.card} ${styles.teal}`}>
          <div className={styles.cardIcon}>
            <i className="fas fa-warehouse" />
          </div>
          <div className={styles.cardLabel}>Inventory Value</div>
          <div className={styles.cardValue}>
            {formatNumber(kpis.totalInventoryValue)}
            <span className={styles.cardCurrency}>IQD</span>
          </div>
        </div>
      </div>

      {/* Expiry badges — expired stock is counted too, it used to vanish (FE-F19-2) */}
      {kpis.expiredCount > 0 && (
        <div className={`${styles.expiringBadge} ${styles.expiredBadge}`}>
          <i className="fas fa-ban" aria-hidden="true" />
          {kpis.expiredCount} expired item{kpis.expiredCount !== 1 ? 's' : ''} still in stock
        </div>
      )}
      {kpis.expiringSoonCount > 0 && (
        <div className={styles.expiringBadge}>
          <i className="fas fa-clock" aria-hidden="true" />
          {kpis.expiringSoonCount} item{kpis.expiringSoonCount !== 1 ? 's' : ''} expiring soon
        </div>
      )}
    </div>
  );
}
