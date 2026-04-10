/**
 * SaleDetailModal Component
 * Full-detail modal for a single sale, including line items table,
 * financial totals, patient/cashier info, and a void action.
 */
import React, { useCallback, useEffect } from 'react';
import type { StandSaleWithItems } from '../../hooks/useStand';
import { formatNumber } from '../../utils/formatters';
import styles from './SaleDetailModal.module.css';

interface SaleDetailModalProps {
  isOpen: boolean;
  sale: StandSaleWithItems | null;
  loading: boolean;
  onClose: () => void;
  onVoid: (saleId: number) => void;
}

/**
 * Format an ISO date string as DD/MM/YYYY HH:mm.
 */
function formatDateTime(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.getDate().toString().padStart(2, '0');
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const year = d.getFullYear();
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

const SaleDetailModal: React.FC<SaleDetailModalProps> = ({
  isOpen,
  sale,
  loading,
  onClose,
  onVoid,
}) => {
  const isVoided = sale?.VoidedDate != null;

  // Close on Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  // Close when clicking the overlay background
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose],
  );

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className={styles.modalOverlay}
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-label="Sale details"
    >
      <div className={styles.modal}>
        {/* Header */}
        <div className={styles.modalHeader}>
          <div className={styles.headerInfo}>
            <h2 className={styles.headerTitle}>
              <i className="fas fa-receipt" />
              Sale #{sale?.SaleID ?? '...'}
            </h2>
            <div className={styles.headerMeta}>
              {sale && <span>{formatDateTime(sale.SaleDate)}</span>}
              {sale && (
                <span
                  className={`${styles.statusBadge} ${
                    isVoided ? styles.statusVoided : styles.statusCompleted
                  }`}
                >
                  {isVoided ? 'Voided' : 'Completed'}
                </span>
              )}
            </div>
          </div>
          <button
            className={styles.closeBtn}
            onClick={onClose}
            type="button"
            aria-label="Close modal"
          >
            &times;
          </button>
        </div>

        {/* Body */}
        {loading || !sale ? (
          <div className={styles.loadingState}>
            <div className={styles.spinner} />
            <span>Loading sale details...</span>
          </div>
        ) : (
          <>
            <div className={styles.modalBody}>
              {/* Line items table */}
              <table className={styles.itemsTable}>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className={styles.numericCell}>Qty</th>
                    <th className={styles.numericCell}>Unit Price</th>
                    <th className={styles.numericCell}>Line Total</th>
                  </tr>
                </thead>
                <tbody>
                  {sale.Items.map((lineItem) => (
                    <tr key={lineItem.SaleItemID}>
                      <td>{lineItem.ItemName}</td>
                      <td className={styles.numericCell}>{lineItem.Quantity}</td>
                      <td className={styles.numericCell}>
                        {formatNumber(lineItem.UnitPrice)} IQD
                      </td>
                      <td className={styles.numericCell}>
                        {formatNumber(lineItem.LineTotal)} IQD
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Totals section */}
              <div className={styles.totalsSection}>
                {/* Financial totals */}
                <div className={styles.totalsCard}>
                  <h4 className={styles.totalsCardTitle}>Financials</h4>
                  <div className={styles.totalsRow}>
                    <span className={styles.totalsLabel}>Total</span>
                    <span className={styles.totalsValue}>
                      {formatNumber(sale.TotalAmount)} IQD
                    </span>
                  </div>
                  <div className={styles.totalsRow}>
                    <span className={styles.totalsLabel}>Cost</span>
                    <span className={styles.totalsValue}>
                      {formatNumber(sale.TotalCost)} IQD
                    </span>
                  </div>
                  <div className={`${styles.totalsRow} ${styles.totalHighlight}`}>
                    <span className={styles.totalsLabel}>Profit</span>
                    <span className={`${styles.totalsValue} ${styles.profitValue}`}>
                      {formatNumber(sale.TotalProfit)} IQD
                    </span>
                  </div>
                </div>

                {/* Payment totals */}
                <div className={styles.totalsCard}>
                  <h4 className={styles.totalsCardTitle}>Payment</h4>
                  <div className={styles.totalsRow}>
                    <span className={styles.totalsLabel}>Method</span>
                    <span className={styles.totalsValue}>{sale.PaymentMethod}</span>
                  </div>
                  <div className={styles.totalsRow}>
                    <span className={styles.totalsLabel}>Amount Paid</span>
                    <span className={styles.totalsValue}>
                      {formatNumber(sale.AmountPaid)} IQD
                    </span>
                  </div>
                  <div className={`${styles.totalsRow} ${styles.totalHighlight}`}>
                    <span className={styles.totalsLabel}>Change</span>
                    <span className={styles.totalsValue}>
                      {formatNumber(sale.Change)} IQD
                    </span>
                  </div>
                </div>
              </div>

              {/* Patient / Cashier info */}
              <div className={styles.infoSection}>
                <div className={styles.infoItem}>
                  <span className={styles.infoLabel}>Patient</span>
                  <span className={styles.infoValue}>
                    {sale.PatientName ?? 'Walk-in'}
                  </span>
                </div>
                <div className={styles.infoItem}>
                  <span className={styles.infoLabel}>Cashier</span>
                  <span className={styles.infoValue}>
                    {sale.CashierName ?? '-'}
                  </span>
                </div>
              </div>

              {/* Customer note */}
              {sale.CustomerNote && (
                <div className={styles.customerNote}>
                  <h4 className={styles.customerNoteTitle}>Customer Note</h4>
                  <p className={styles.customerNoteText}>{sale.CustomerNote}</p>
                </div>
              )}

              {/* Void reason */}
              {isVoided && sale.VoidReason && (
                <div className={styles.voidReason}>
                  <h4 className={styles.voidReasonTitle}>Void Reason</h4>
                  <p className={styles.voidReasonText}>{sale.VoidReason}</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className={styles.modalFooter}>
              {!isVoided && (
                <button
                  className={styles.btnVoid}
                  onClick={() => onVoid(sale.SaleID)}
                  type="button"
                >
                  <i className="fas fa-ban" />
                  Void Sale
                </button>
              )}
              <button
                className={styles.btnClose}
                onClick={onClose}
                type="button"
              >
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default React.memo(SaleDetailModal);
