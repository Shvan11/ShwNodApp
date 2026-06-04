import { useState } from 'react';
import { useStandSales, useStandSale, useStandSaleMutations } from '../hooks/useStand';
import SalesHistoryTable from '../components/stand/SalesHistoryTable';
import SaleDetailModal from '../components/stand/SaleDetailModal';
import Modal from '../components/react/Modal';
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
  // The query runs against the *applied* range, not the live inputs, so editing
  // a date field doesn't refetch on every keystroke — "Apply" commits the range.
  const [appliedStart, setAppliedStart] = useState(defaults.startDate);
  const [appliedEnd, setAppliedEnd] = useState(defaults.endDate);
  const [viewSaleId, setViewSaleId] = useState<number | null>(null);
  const [voidSaleId, setVoidSaleId] = useState<number | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voiding, setVoiding] = useState(false);

  const { sales, loading, error, refetch } = useStandSales({ startDate: appliedStart, endDate: appliedEnd });

  const applyDateRange = () => {
    setAppliedStart(startDate);
    setAppliedEnd(endDate);
  };
  const { sale: viewSale, loading: saleLoading } = useStandSale(viewSaleId);
  const { voidSale } = useStandSaleMutations(refetch);

  const handleVoid = (saleId: number) => {
    setVoidSaleId(saleId);
    setVoidReason('');
  };

  const submitVoid = async () => {
    if (voidSaleId === null || voiding) return;
    const reason = voidReason.trim();
    if (!reason) {
      toast.error('A void reason is required');
      return;
    }

    setVoiding(true);
    try {
      await voidSale(voidSaleId, reason);
      toast.success('Sale voided successfully');
      setVoidSaleId(null);
      setViewSaleId(null);
    } catch {
      toast.error('Failed to void sale');
    } finally {
      setVoiding(false);
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
        <button className="btn btn-primary" onClick={applyDateRange}>Apply</button>
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

      {voidSaleId !== null && (
        <Modal
          isOpen
          onClose={() => { if (!voiding) setVoidSaleId(null); }}
          closeOnBackdropClick={!voiding}
          closeOnEscape={!voiding}
        >
          <div className={styles.voidModal}>
            <h2>Void Sale #{voidSaleId}</h2>
            <label htmlFor="void-reason">Reason for voiding this sale</label>
            <textarea
              id="void-reason"
              value={voidReason}
              onChange={e => setVoidReason(e.target.value)}
              rows={3}
              autoFocus
            />
            <div className={styles.voidModalActions}>
              <button
                className="btn btn-secondary"
                onClick={() => setVoidSaleId(null)}
                disabled={voiding}
              >
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={submitVoid}
                disabled={voiding || !voidReason.trim()}
              >
                {voiding ? 'Voiding…' : 'Void Sale'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
