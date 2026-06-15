/**
 * SaleDetailModal Component
 * Full-detail modal for a single sale, including line items table,
 * financial totals, patient/cashier info, and a void action.
 */
import React from 'react';
import type { StandSaleWithItems } from '../../hooks/useStand';
import { formatNumber } from '../../utils/formatters';
import Modal from '../react/Modal';
import ModalHeader from '../react/ModalHeader';
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
  const isVoided = sale?.voided_date != null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      contentClassName={styles.modal}
      ariaLabelledBy="sale-detail-modal-title"
    >
        {/* Header */}
        <ModalHeader
          titleId="sale-detail-modal-title"
          icon={<i className="fas fa-receipt" />}
          title={`Sale #${sale?.sale_id ?? '...'}`}
          subtitle={
            sale ? (
              <span className={styles.headerMeta}>
                <span>{formatDateTime(sale.sale_date)}</span>
                <span
                  className={`${styles.statusBadge} ${
                    isVoided ? styles.statusVoided : styles.statusCompleted
                  }`}
                >
                  {isVoided ? 'Voided' : 'Completed'}
                </span>
              </span>
            ) : undefined
          }
          onClose={onClose}
        />

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
                    <tr key={lineItem.sale_item_id}>
                      <td>{lineItem.item_name}</td>
                      <td className={styles.numericCell}>{lineItem.quantity}</td>
                      <td className={styles.numericCell}>
                        {formatNumber(lineItem.unit_price)} IQD
                      </td>
                      <td className={styles.numericCell}>
                        {formatNumber(lineItem.line_total)} IQD
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
                      {formatNumber(sale.total_amount)} IQD
                    </span>
                  </div>
                  <div className={styles.totalsRow}>
                    <span className={styles.totalsLabel}>Cost</span>
                    <span className={styles.totalsValue}>
                      {formatNumber(sale.total_cost)} IQD
                    </span>
                  </div>
                  <div className={`${styles.totalsRow} ${styles.totalHighlight}`}>
                    <span className={styles.totalsLabel}>Profit</span>
                    <span className={`${styles.totalsValue} ${styles.profitValue}`}>
                      {formatNumber(sale.total_profit)} IQD
                    </span>
                  </div>
                </div>

                {/* Payment totals */}
                <div className={styles.totalsCard}>
                  <h4 className={styles.totalsCardTitle}>Payment</h4>
                  <div className={styles.totalsRow}>
                    <span className={styles.totalsLabel}>Method</span>
                    <span className={styles.totalsValue}>{sale.payment_method}</span>
                  </div>
                  <div className={styles.totalsRow}>
                    <span className={styles.totalsLabel}>Amount Paid</span>
                    <span className={styles.totalsValue}>
                      {formatNumber(sale.amount_paid)} IQD
                    </span>
                  </div>
                  <div className={`${styles.totalsRow} ${styles.totalHighlight}`}>
                    <span className={styles.totalsLabel}>Change</span>
                    <span className={styles.totalsValue}>
                      {formatNumber(sale.change)} IQD
                    </span>
                  </div>
                </div>
              </div>

              {/* Patient / Cashier info */}
              <div className={styles.infoSection}>
                <div className={styles.infoItem}>
                  <span className={styles.infoLabel}>Patient</span>
                  <span className={styles.infoValue}>
                    {sale.patient_name ?? 'Walk-in'}
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
              {sale.customer_note && (
                <div className={styles.customerNote}>
                  <h4 className={styles.customerNoteTitle}>Customer Note</h4>
                  <p className={styles.customerNoteText}>{sale.customer_note}</p>
                </div>
              )}

              {/* Void reason */}
              {isVoided && sale.void_reason && (
                <div className={styles.voidReason}>
                  <h4 className={styles.voidReasonTitle}>Void Reason</h4>
                  <p className={styles.voidReasonText}>{sale.void_reason}</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className={styles.modalFooter}>
              {!isVoided && (
                <button
                  className={styles.btnVoid}
                  onClick={() => onVoid(sale.sale_id)}
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
    </Modal>
  );
};

export default React.memo(SaleDetailModal);
