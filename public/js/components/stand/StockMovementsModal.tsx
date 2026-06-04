/**
 * StockMovementsModal Component
 * Displays a timeline/table of stock movements for a specific inventory item
 */
import type { StandItem, StandStockMovement } from '../../hooks/useStand';
import { useStockMovements } from '../../hooks/useStand';
import { formatNumber } from '../../utils/formatters';
import Modal from '../react/Modal';
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
            const qtyClass = mov.quantity >= 0 ? styles.quantityPositive : styles.quantityNegative;
            const qtyDisplay = mov.quantity > 0 ? `+${formatNumber(mov.quantity)}` : formatNumber(mov.quantity);

            return (
              <tr key={mov.movement_id}>
                <td>{formatDate(mov.movement_date)}</td>
                <td>
                  <span className={`${styles.typeBadge} ${getTypeBadgeClass(mov.movement_type)}`}>
                    {mov.movement_type}
                  </span>
                </td>
                <td className={qtyClass}>{qtyDisplay}</td>
                <td>{mov.total_cost != null ? formatNumber(mov.total_cost) : '-'}</td>
                <td>{mov.related_sale_id != null ? `#${mov.related_sale_id}` : '-'}</td>
                <td className={styles.reasonCell} title={mov.reason || undefined}>
                  {mov.reason || '-'}
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
  const { movements, loading, error } = useStockMovements(isOpen && item ? item.item_id : null);

  if (!item) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      contentClassName={styles.modalContent}
      ariaLabelledBy="stock-movements-modal-title"
    >
        <div className={styles.modalHeader}>
          <h2 id="stock-movements-modal-title">Stock Movements</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close modal">
            &times;
          </button>
        </div>

        <div className={styles.modalBody}>
          <div className={styles.itemInfo}>
            <p>
              <strong>{item.item_name}</strong>
            </p>
            <p>Current Stock: {formatNumber(item.current_stock)}</p>
          </div>

          {loading ? (
            <div className={styles.loadingState}>
              <div className={styles.loadingSpinner}></div>
              <p>Loading movements...</p>
            </div>
          ) : error ? (
            <div className={styles.emptyState}>
              <p>{error}</p>
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
    </Modal>
  );
}
