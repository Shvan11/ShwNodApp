import { useState } from 'react';
import { useStandReportSummary, useTopSellingItems } from '../hooks/useStand';
import SalesTrendChart from '../components/stand/SalesTrendChart';
import TopItemsChart from '../components/stand/TopItemsChart';
import { formatNumber } from '../utils/formatters';
import { toLocalDateString } from '@/utils/calendarDate';
import styles from './StandReports.module.css';

function getDefaultDates() {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    startDate: toLocalDateString(firstDay),
    endDate: toLocalDateString(now),
  };
}

export default function StandReports() {
  const [defaults] = useState(getDefaultDates);
  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState(defaults.endDate);

  // A cleared or reversed range used to show four "0 IQD" cards (FE-F19-12).
  const rangeProblem = !startDate || !endDate
    ? 'Pick a start and an end date.'
    : startDate > endDate
      ? 'The start date is after the end date.'
      : null;
  const queryStart = rangeProblem ? null : startDate;
  const queryEnd = rangeProblem ? null : endDate;

  const { data: reportData, loading, error: reportError } = useStandReportSummary(queryStart, queryEnd);
  const { items: topItems, error: topError } = useTopSellingItems(queryStart, queryEnd, 10);

  // Gross Profit is revenue minus the cost of what was sold. Restock purchases are
  // a separate cash outflow: subtracting them from Gross Profit counted the stock's
  // cost twice and read as a loss every month the stand restocked (FE-F19-1). The
  // fourth card is cash in minus stock bought (owner decision 2026-10-04).
  const totalRevenue = reportData?.salesSummary.reduce((s, r) => s + r.Revenue, 0) ?? 0;
  const totalProfit = reportData?.salesSummary.reduce((s, r) => s + r.Profit, 0) ?? 0;
  const totalPurchases = reportData?.purchases.totalPurchases ?? 0;
  const netCash = totalRevenue - totalPurchases;

  return (
    <div className={styles.reportsContainer}>
      <div className={styles.pageHeader}>
        <h1>Stand Reports</h1>
      </div>

      <div className={styles.filterRow}>
        <div className={styles.filterGroup}>
          <label htmlFor="stand-reports-start-date">Start Date</label>
          <input id="stand-reports-start-date" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
        </div>
        <div className={styles.filterGroup}>
          <label htmlFor="stand-reports-end-date">End Date</label>
          <input id="stand-reports-end-date" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
        </div>
      </div>

      {rangeProblem ? (
        <div className={styles.loadingState}>{rangeProblem}</div>
      ) : loading ? (
        <div className={styles.loadingState}>Loading reports...</div>
      ) : reportError ? (
        <div className={styles.loadingState}>{reportError}</div>
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
              <p className={styles.cardNote}>Revenue minus the cost of the items sold</p>
            </div>
            <div className={`${styles.summaryCard} ${styles.purchasesCard}`}>
              <h3>Stand Purchases</h3>
              <p className={styles.value}>{formatNumber(totalPurchases)} IQD</p>
              <p className={styles.cardNote}>Stock bought (restocks) in this range</p>
            </div>
            <div className={`${styles.summaryCard} ${styles.netCard}`}>
              <h3>Net Cash</h3>
              <p className={styles.value}>{formatNumber(netCash)} IQD</p>
              <p className={styles.cardNote}>Revenue minus purchases — cash, not profit</p>
            </div>
          </div>

          <div className={styles.chartsGrid}>
            <div className={styles.chartPanel}>
              <h2>Sales Trend</h2>
              <SalesTrendChart data={reportData?.salesSummary ?? []} />
            </div>
            <div className={styles.chartPanel}>
              <h2>Top Selling Items</h2>
              {topError ? (
                <div className={styles.loadingState}>{topError}</div>
              ) : (
                <TopItemsChart data={topItems} />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
