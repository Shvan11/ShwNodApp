import { useState } from 'react';
import { useStandReportSummary, useTopSellingItems } from '../hooks/useStand';
import SalesTrendChart from '../components/stand/SalesTrendChart';
import TopItemsChart from '../components/stand/TopItemsChart';
import { formatNumber } from '../utils/formatters';
import styles from './StandReports.module.css';

function formatDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getDefaultDates() {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    startDate: formatDateString(firstDay),
    endDate: formatDateString(now),
  };
}

export default function StandReports() {
  const defaults = getDefaultDates();
  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState(defaults.endDate);

  const { data: reportData, loading } = useStandReportSummary(startDate, endDate);
  const { items: topItems } = useTopSellingItems(startDate, endDate, 10);

  // Compute summary totals from daily data
  const totalRevenue = reportData?.salesSummary.reduce((s, r) => s + r.Revenue, 0) ?? 0;
  const totalProfit = reportData?.salesSummary.reduce((s, r) => s + r.Profit, 0) ?? 0;
  const totalPurchases = reportData?.purchases.totalPurchases ?? 0;
  const netProfit = totalProfit - totalPurchases;

  return (
    <div className={styles.reportsContainer}>
      <div className={styles.pageHeader}>
        <h1>Stand Reports</h1>
      </div>

      <div className={styles.filterRow}>
        <div className={styles.filterGroup}>
          <label>Start Date</label>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
        </div>
        <div className={styles.filterGroup}>
          <label>End Date</label>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
        </div>
      </div>

      {loading ? (
        <div className={styles.loadingState}>Loading reports...</div>
      ) : (
        <>
          <div className={styles.summaryCards}>
            <div className={`${styles.summaryCard} ${styles.revenueCard}`}>
              <h3>Total Revenue</h3>
              <p className={styles.value}>{formatNumber(totalRevenue)} IQD</p>
            </div>
            <div className={`${styles.summaryCard} ${styles.profitCard}`}>
              <h3>Gross Profit</h3>
              <p className={styles.value}>{formatNumber(totalProfit)} IQD</p>
            </div>
            <div className={`${styles.summaryCard} ${styles.purchasesCard}`}>
              <h3>Stand Purchases</h3>
              <p className={styles.value}>{formatNumber(totalPurchases)} IQD</p>
            </div>
            <div className={`${styles.summaryCard} ${styles.netCard}`}>
              <h3>Net Profit</h3>
              <p className={styles.value}>{formatNumber(netProfit)} IQD</p>
            </div>
          </div>

          <div className={styles.chartsGrid}>
            <div className={styles.chartPanel}>
              <h2>Sales Trend</h2>
              <SalesTrendChart data={reportData?.salesSummary ?? []} />
            </div>
            <div className={styles.chartPanel}>
              <h2>Top Selling Items</h2>
              <TopItemsChart data={topItems} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
