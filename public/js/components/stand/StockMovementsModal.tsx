/**
 * StockMovementsModal Component
 * Displays a timeline/table of stock movements for a specific inventory item
 */
import type { StandItem, StandStockMovement } from '../../hooks/useStand';
import { useStockMovements } from '../../hooks/useStand';
import { formatNumber } from '../../utils/formatters';
import { formatStandDateTime } from './standFormat';
import Modal from '../react/Modal';
import ModalHeader from '../react/ModalHeader';
import styles from './StockMovementsModal.module.css';

interface StockMovementsModalProps {
  isOpen: boolean;
  item: StandItem | null;
  onClose: () => void;
}


/**
 * The ledger's movement types (`stand-queries.ts`): `initial` (opening stock),
 * `restock`, `sale`, `void` (a voided sale's stock coming back), `adjustment` (a
 * manual increase) and `waste` (ANY manual decrease, mistakes included — so it is
 * shown as "Removed"). The map used to style two types that don't exist and leave
 * `void` and `waste` grey (FE-F19-15).
 */
const MOVEMENT_TYPES: Record<string, { label: string; className: string }> = {
  initial: { label: 'Opening stock', className: styles.typePurchase },
  restock: { label: 'Restock', className: styles.typeRestock },
  sale: { label: 'Sale', className: styles.typeSale },
  void: { label: 'Sale voided', className: styles.typeReturn },
  adjustment: { label: 'Added', className: styles.typeAdjustment },
  waste: { label: 'Removed', className: styles.typeRemoved },
};

function movementType(type: string): { label: string; className: string } {
  return MOVEMENT_TYPES[type.toLowerCase()] ?? { label: type, className: styles.typeDefault };
}

function MovementsTable({ movements }: { movements: StandStockMovement[] }) {
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a region that scrolls must be focusable, or a keyboard user cannot read a long history inside the dialog
    <div className={styles.tableWrapper} tabIndex={0} role="region" aria-label="Stock movements">
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
            const type = movementType(mov.movement_type);

            return (
              <tr key={mov.movement_id}>
                <td>{formatStandDateTime(mov.movement_date) || '-'}</td>
                <td>
                  <span className={`${styles.typeBadge} ${type.className}`}>{type.label}</span>
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
        <ModalHeader
          title="Stock Movements"
          titleId="stock-movements-modal-title"
          onClose={onClose}
        />

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
