import { useState } from 'react';
import { useStandSales, useStandSale, useStandSaleMutations } from '../hooks/useStand';
import SalesHistoryTable from '../components/stand/SalesHistoryTable';
import SaleDetailModal from '../components/stand/SaleDetailModal';
import { useToast } from '../contexts/ToastContext';
import styles from './StandSalesHistory.module.css';

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

export default function StandSalesHistory() {
  const toast = useToast();
  const defaults = getDefaultDates();

  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState(defaults.endDate);
  const [viewSaleId, setViewSaleId] = useState<number | null>(null);

  const { sales, loading, error, refetch } = useStandSales({ startDate, endDate });
  const { sale: viewSale, loading: saleLoading } = useStandSale(viewSaleId);
  const { voidSale } = useStandSaleMutations(refetch);

  const handleVoid = async (saleId: number) => {
    const reason = prompt('Enter void reason:');
    if (!reason) return;

    try {
      await voidSale(saleId, reason);
      toast.success('Sale voided successfully');
      setViewSaleId(null);
    } catch {
      toast.error('Failed to void sale');
    }
  };

  return (
    <div className={styles.salesContainer}>
      <div className={styles.pageHeader}>
        <h1>Sales History</h1>
      </div>

      <div className={styles.filterRow}>
        <div className={styles.filterGroup}>
          <label>Start Date</label>
          <input
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
          />
        </div>
        <div className={styles.filterGroup}>
          <label>End Date</label>
          <input
            type="date"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
          />
        </div>
        <button className="btn btn-primary" onClick={refetch}>Apply</button>
      </div>

      {error && (
        <div className={styles.errorBanner}>
          <p>Error: {error}</p>
          <button onClick={refetch} className="btn btn-secondary">Retry</button>
        </div>
      )}

      <SalesHistoryTable
        sales={sales}
        loading={loading}
        onView={(saleId) => setViewSaleId(saleId)}
        onVoid={handleVoid}
      />

      <SaleDetailModal
        isOpen={!!viewSaleId}
        sale={viewSale}
        loading={saleLoading}
        onClose={() => setViewSaleId(null)}
        onVoid={handleVoid}
      />
    </div>
  );
}
