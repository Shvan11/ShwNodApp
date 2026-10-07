import { useEffect, useState } from 'react';
import type { PortalPaymentRow } from '../portal.schemas';
import { portalPaymentsResponseSchema } from '../portal.schemas';
import { portalGet } from '../portalApi';
import { formatCurrency, formatLocaleDate, formatNumber } from '../../utils/formatters';
import styles from '../portal.module.css';
import PortalIcon from '../PortalIcon';

// English, like the rest of the portal's text — never the phone's own locale,
// which on an Arabic phone renders Arabic-Indic digits (audit FE-F3-3).
function formatDate(iso: string): string {
  return formatLocaleDate(iso, { year: 'numeric', month: 'short', day: 'numeric' }) || iso;
}

function formatAmount(amount: number, currency: string | null): string {
  return currency ? formatCurrency(amount, currency) : formatNumber(amount);
}

/**
 * "Total paid", one line per currency. Amounts are in their work's currency and are
 * never converted, so an IQD and a USD work are two totals, not one sum (FE-F23-2).
 */
function totalsByCurrency(payments: PortalPaymentRow[]): { currency: string | null; total: number }[] {
  const totals = new Map<string | null, number>();
  for (const p of payments) totals.set(p.currency, (totals.get(p.currency) ?? 0) + p.amount);
  return [...totals].map(([currency, total]) => ({ currency, total }));
}

const PaymentsTab = () => {
  const [payments, setPayments] = useState<PortalPaymentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await portalGet('/api/portal/payments', portalPaymentsResponseSchema);
        if (cancelled) return;
        if (!result.ok || !result.data.payments) {
          setError((!result.ok && result.error) || 'Unable to load your payments.');
          return;
        }
        setPayments(result.data.payments); // every work's, newest first, from the server
      } catch {
        if (!cancelled) setError('Unable to reach the server.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
          <PortalIcon name="receipt" className={styles.emptyIcon} />
          <p>No payments recorded yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.tabPanel}>
      <div className={styles.totalCard}>
        <div className={styles.totalLabel}>Total paid</div>
        {totalsByCurrency(payments).map((t) => (
          <div key={t.currency ?? '-'} className={styles.totalValue}>
            {formatAmount(t.total, t.currency)}
          </div>
        ))}
      </div>

      <ul className={styles.paymentList}>
        {payments.map((p, idx) => (
          <li key={`${p.date}-${idx}`} className={styles.paymentItem}>
            <div className={styles.paymentDate}>{formatDate(p.date)}</div>
            <div className={styles.paymentAmount}>{formatAmount(p.amount, p.currency)}</div>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default PaymentsTab;
