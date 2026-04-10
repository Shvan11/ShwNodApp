/**
 * DeleteItemModal Component
 * Confirmation modal for soft-deleting (deactivating) a stand inventory item
 */
import type { MouseEvent } from 'react';
import type { StandItem } from '../../hooks/useStand';
import { formatNumber } from '../../utils/formatters';
import styles from './DeleteItemModal.module.css';

interface DeleteItemModalProps {
  isOpen: boolean;
  item: StandItem | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function DeleteItemModal({ isOpen, item, onConfirm, onCancel }: DeleteItemModalProps) {
  if (!isOpen || !item) return null;

  const handleOverlayClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onCancel();
    }
  };

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2>Delete Item</h2>
          <button className={styles.closeBtn} onClick={onCancel} aria-label="Close modal">
            &times;
          </button>
        </div>

        <div className={styles.modalBody}>
          <p className={styles.warningText}>
            This will deactivate the item (soft delete). The item will no longer appear in active
            inventory but its history will be preserved.
          </p>

          <div className={styles.itemDetails}>
            <p>
              <strong>Item:</strong> {item.ItemName}
            </p>
            <p>
              <strong>Current Stock:</strong> {formatNumber(item.CurrentStock)}
            </p>
            {item.CategoryName && (
              <p>
                <strong>Category:</strong> {item.CategoryName}
              </p>
            )}
            <p>
              <strong>Cost Price:</strong> {formatNumber(item.CostPrice)} IQD
            </p>
            <p>
              <strong>Sell Price:</strong> {formatNumber(item.SellPrice)} IQD
            </p>
          </div>
        </div>

        <div className={styles.modalFooter}>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm}>
            Delete Item
          </button>
        </div>
      </div>
    </div>
  );
}
