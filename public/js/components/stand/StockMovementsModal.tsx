/**
 * StockMovementsModal Component
 * Displays a timeline/table of stock movements for a specific inventory item
 */
import type { MouseEvent } from 'react';
import type { StandItem, StandStockMovement } from '../../hooks/useStand';
import { useStockMovements } from '../../hooks/useStand';
import { formatNumber } from '../../utils/formatters';
import styles from './StockMovementsModal.module.css';

interface StockMovementsModalProps {
  isOpen: boolean;
  item: StandItem | null;
  onClose: () => void;
}

function formatDate(dateString: string | null): string {
  if (!dateString) return '-';
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getTypeBadgeClass(type: string): string {
  const lower = type.toLowerCase();
  if (lower === 'purchase' || lower === 'initial') return styles.typePurchase;
  if (lower === 'sale') return styles.typeSale;
  if (lower === 'adjustment') return styles.typeAdjustment;
  if (lower === 'return') return styles.typeReturn;
  if (lower === 'restock') return styles.typeRestock;
  return styles.typeDefault;
}

function MovementsTable({ movements }: { movements: StandStockMovement[] }) {
  return (
    <div className={styles.tableWrapper}>
      <table className={styles.movementsTable}>
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th>Quantity</th>
            <th>Cost</th>
            <th>Related Sale</th>
            <th>Reason</th>
            <th>Performed By</th>
          </tr>
        </thead>
        <tbody>
          {movements.map((mov) => {
            const qtyClass = mov.Quantity >= 0 ? styles.quantityPositive : styles.quantityNegative;
            const qtyDisplay = mov.Quantity > 0 ? `+${formatNumber(mov.Quantity)}` : formatNumber(mov.Quantity);

            return (
              <tr key={mov.MovementID}>
                <td>{formatDate(mov.MovementDate)}</td>
                <td>
                  <span className={`${styles.typeBadge} ${getTypeBadgeClass(mov.MovementType)}`}>
                    {mov.MovementType}
                  </span>
                </td>
                <td className={qtyClass}>{qtyDisplay}</td>
                <td>{mov.TotalCost != null ? formatNumber(mov.TotalCost) : '-'}</td>
                <td>{mov.RelatedSaleID != null ? `#${mov.RelatedSaleID}` : '-'}</td>
                <td className={styles.reasonCell} title={mov.Reason || undefined}>
                  {mov.Reason || '-'}
                </td>
                <td>{mov.PerformedByName || '-'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function StockMovementsModal({ isOpen, item, onClose }: StockMovementsModalProps) {
  const { movements, loading } = useStockMovements(isOpen && item ? item.ItemID : null);

  const handleOverlayClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen || !item) return null;

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2>Stock Movements</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close modal">
            &times;
          </button>
        </div>

        <div className={styles.modalBody}>
          <div className={styles.itemInfo}>
            <p>
              <strong>{item.ItemName}</strong>
            </p>
            <p>Current Stock: {formatNumber(item.CurrentStock)}</p>
          </div>

          {loading ? (
            <div className={styles.loadingState}>
              <div className={styles.loadingSpinner}></div>
              <p>Loading movements...</p>
            </div>
          ) : movements.length === 0 ? (
            <div className={styles.emptyState}>
              <p>No stock movements found for this item</p>
            </div>
          ) : (
            <MovementsTable movements={movements} />
          )}
        </div>

        <div className={styles.modalFooter}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
