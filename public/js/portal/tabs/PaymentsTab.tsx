import { useEffect, useMemo, useState } from 'react';
import styles from '../portal.module.css';

interface PaymentRow {
  Payment: number;
  Date: string;
}

interface Response {
  success: boolean;
  payments?: PaymentRow[];
  error?: string;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatAmount(v: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(v);
}

const PaymentsTab = () => {
  const [payments, setPayments] = useState<PaymentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/portal/payments', { credentials: 'same-origin' });
        const data = (await res.json()) as Response;
        if (cancelled) return;
        if (!res.ok || !data.success || !data.payments) {
          setError(data.error || 'Unable to load your payments.');
          return;
        }
        const sorted = [...data.payments].sort(
          (a, b) => new Date(b.Date).getTime() - new Date(a.Date).getTime()
        );
        setPayments(sorted);
      } catch {
        if (!cancelled) setError('Unable to reach the server.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const total = useMemo(
    () => (payments || []).reduce((sum, p) => sum + (p.Payment || 0), 0),
    [payments]
  );

  if (error) {
    return (
      <div className={styles.tabPanel}>
        <div className={styles.errorBox}>{error}</div>
      </div>
    );
  }

  if (!payments) {
    return (
      <div className={styles.tabPanel}>
        <div className={styles.loadingRow}>
          <div className={styles.spinner} />
          <span>Loading your payments…</span>
        </div>
      </div>
    );
  }

  if (payments.length === 0) {
    return (
      <div className={styles.tabPanel}>
        <div className={styles.emptyState}>
          <i className={`fas fa-receipt ${styles.emptyIcon}`} aria-hidden="true" />
          <p>No payments recorded yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.tabPanel}>
      <div className={styles.totalCard}>
        <div className={styles.totalLabel}>Total paid</div>
        <div className={styles.totalValue}>{formatAmount(total)}</div>
      </div>

      <ul className={styles.paymentList}>
        {payments.map((p, idx) => (
          <li key={`${p.Date}-${idx}`} className={styles.paymentItem}>
            <div className={styles.paymentDate}>{formatDate(p.Date)}</div>
            <div className={styles.paymentAmount}>{formatAmount(p.Payment)}</div>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default PaymentsTab;
