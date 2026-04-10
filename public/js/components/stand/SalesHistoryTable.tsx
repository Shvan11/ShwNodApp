/**
 * SalesHistoryTable Component
 * Tabular display of sales history with status badges, profit colouring,
 * and View / Void action buttons.
 */
import React from 'react';
import type { StandSale } from '../../hooks/useStand';
import { formatNumber } from '../../utils/formatters';
import styles from './SalesHistoryTable.module.css';

interface SalesHistoryTableProps {
  sales: StandSale[];
  loading: boolean;
  onView: (saleId: number) => void;
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

const SalesHistoryTable: React.FC<SalesHistoryTableProps> = ({
  sales,
  loading,
  onView,
  onVoid,
}) => {
  const isVoided = (sale: StandSale): boolean => sale.VoidedDate != null;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3 className={styles.title}>
          <i className="fas fa-history" />
          Sales History
        </h3>
      </div>

      {loading ? (
        <div className={styles.loadingState}>
          <div className={styles.spinner} />
        </div>
      ) : sales.length === 0 ? (
        <div className={styles.emptyState}>
          <i className="fas fa-receipt" />
          <p>No sales found</p>
        </div>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Sale ID</th>
                <th>Total</th>
                <th>Profit</th>
                <th>Payment</th>
                <th>Patient</th>
                <th>Cashier</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((sale) => {
                const voided = isVoided(sale);
                return (
                  <tr
                    key={sale.SaleID}
                    className={voided ? styles.voidedRow : undefined}
                  >
                    <td>{formatDateTime(sale.SaleDate)}</td>
                    <td>#{sale.SaleID}</td>
                    <td className={styles.amountCell}>
                      {formatNumber(sale.TotalAmount)} IQD
                    </td>
                    <td
                      className={`${styles.amountCell} ${
                        sale.TotalProfit >= 0
                          ? styles.profitPositive
                          : styles.profitNegative
                      }`}
                    >
                      {formatNumber(sale.TotalProfit)} IQD
                    </td>
                    <td>{sale.PaymentMethod}</td>
                    <td>{sale.PatientName ?? '-'}</td>
                    <td>{sale.CashierName ?? '-'}</td>
                    <td>
                      <span
                        className={`${styles.statusBadge} ${
                          voided ? styles.statusVoided : styles.statusCompleted
                        }`}
                      >
                        {voided ? 'Voided' : 'Completed'}
                      </span>
                    </td>
                    <td>
                      <div className={styles.actions}>
                        <button
                          className={styles.btnView}
                          onClick={() => onView(sale.SaleID)}
                          type="button"
                          title="View details"
                        >
                          <i className="fas fa-eye" />
                          View
                        </button>
                        {!voided && (
                          <button
                            className={styles.btnVoid}
                            onClick={() => onVoid(sale.SaleID)}
                            type="button"
                            title="Void sale"
                          >
                            <i className="fas fa-ban" />
                            Void
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default React.memo(SalesHistoryTable);
