/**
 * DeleteItemModal Component
 * Confirmation modal for soft-deleting (deactivating) a stand inventory item
 */
import { useState } from 'react';
import type { StandItem } from '../../hooks/useStand';
import { formatNumber } from '../../utils/formatters';
import Modal from '../react/Modal';
import ModalHeader from '../react/ModalHeader';
import styles from './DeleteItemModal.module.css';

interface DeleteItemModalProps {
  isOpen: boolean;
  item: StandItem | null;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export default function DeleteItemModal({ isOpen, item, onConfirm, onCancel }: DeleteItemModalProps) {
  const [submitting, setSubmitting] = useState(false);

  if (!item) return null;

  const handleConfirm = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onConfirm();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      contentClassName={styles.modalContent}
      ariaLabelledBy="delete-item-modal-title"
    >
      <ModalHeader
        title="Delete Item"
        titleId="delete-item-modal-title"
        variant="danger"
        onClose={onCancel}
      />

      <div className={styles.modalBody}>
        <p className={styles.warningText}>
          This will deactivate the item (soft delete). The item will no longer appear in active
          inventory but its history will be preserved.
        </p>

        <div className={styles.itemDetails}>
          <p>
            <strong>Item:</strong> {item.item_name}
          </p>
          <p>
            <strong>Current Stock:</strong> {formatNumber(item.current_stock)}
          </p>
          {item.category_name && (
            <p>
              <strong>Category:</strong> {item.category_name}
            </p>
          )}
          <p>
            <strong>Cost Price:</strong> {formatNumber(item.cost_price)} IQD
          </p>
          <p>
            <strong>Sell Price:</strong> {formatNumber(item.sell_price)} IQD
          </p>
        </div>
      </div>

      <div className={styles.modalFooter}>
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
        <button type="button" className="btn btn-danger" onClick={handleConfirm} disabled={submitting}>
          {submitting ? 'Deleting…' : 'Delete Item'}
        </button>
      </div>
    </Modal>
  );
}
