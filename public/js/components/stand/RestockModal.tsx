/**
 * RestockModal Component
 * Modal for restocking a stand inventory item with quantity and unit cost
 */
import { useState, useEffect } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import type { StandItem } from '../../hooks/useStand';
import { formatNumber } from '../../utils/formatters';
import Modal from '../react/Modal';
import styles from './RestockModal.module.css';

interface RestockModalProps {
  isOpen: boolean;
  item: StandItem | null;
  onClose: () => void;
  onSave: (quantity: number, unitCost: number) => void | Promise<void>;
}

interface FormErrors {
  quantity?: string | null;
  unitCost?: string | null;
}

export default function RestockModal({ isOpen, item, onClose, onSave }: RestockModalProps) {
  const [quantity, setQuantity] = useState(1);
  const [unitCost, setUnitCost] = useState(0);
  const [displayUnitCost, setDisplayUnitCost] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen && item) {
      setQuantity(1);
      setUnitCost(item.cost_price);
      setDisplayUnitCost(item.cost_price ? formatNumber(item.cost_price) : '');
      setErrors({});
    }
  }, [isOpen, item]);

  const handleUnitCostChange = (rawValue: string) => {
    const digits = rawValue.replace(/[^\d]/g, '');
    const num = parseInt(digits, 10) || 0;
    setDisplayUnitCost(num ? num.toLocaleString('en-US') : '');
    setUnitCost(num);
    if (errors.unitCost) {
      setErrors((prev) => ({ ...prev, unitCost: null }));
    }
  };

  const handleQuantityChange = (e: ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10) || 0;
    setQuantity(val);
    if (errors.quantity) {
      setErrors((prev) => ({ ...prev, quantity: null }));
    }
  };

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};
    if (!quantity || quantity <= 0) {
      newErrors.quantity = 'Quantity must be a positive number';
    }
    if (unitCost < 0) {
      newErrors.unitCost = 'Unit cost cannot be negative';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting || !validateForm()) return;
    setSubmitting(true);
    try {
      await onSave(quantity, unitCost);
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setQuantity(1);
    setUnitCost(0);
    setDisplayUnitCost('');
    setErrors({});
    onClose();
  };

  if (!item) return null;

  const totalCost = quantity * unitCost;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      contentClassName={styles.modalContent}
      ariaLabelledBy="restock-modal-title"
    >
        <div className={styles.modalHeader}>
          <h2 id="restock-modal-title">Restock Item</h2>
          <button className={styles.closeBtn} onClick={handleClose} aria-label="Close modal">
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className={styles.modalBody}>
            <div className={styles.itemInfo}>
              <p>
                <strong>{item.item_name}</strong>
              </p>
              <p>Current Stock: {formatNumber(item.current_stock)}</p>
            </div>

            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label htmlFor="restock-quantity">
                  Quantity <span className={styles.required}>*</span>
                </label>
                <input
                  type="number"
                  id="restock-quantity"
                  className={`${styles.formInput} ${errors.quantity ? styles.inputError : ''}`}
                  value={quantity}
                  onChange={handleQuantityChange}
                  min="1"
                  step="1"
                />
                {errors.quantity && <span className={styles.errorMessage}>{errors.quantity}</span>}
              </div>

              <div className={styles.formGroup}>
                <label htmlFor="restock-unit-cost">
                  Unit Cost (IQD) <span className={styles.required}>*</span>
                </label>
                <input
                  type="text"
                  id="restock-unit-cost"
                  className={`${styles.formInput} ${errors.unitCost ? styles.inputError : ''}`}
                  value={displayUnitCost}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => handleUnitCostChange(e.target.value)}
                  onBlur={() => setDisplayUnitCost(unitCost ? formatNumber(unitCost) : '')}
                  placeholder="0"
                />
                {errors.unitCost && <span className={styles.errorMessage}>{errors.unitCost}</span>}
              </div>
            </div>

            <div className={styles.totalCostDisplay}>
              <span className={styles.totalCostLabel}>Total Cost</span>
              <span className={styles.totalCostValue}>
                {formatNumber(totalCost)} IQD
              </span>
            </div>
          </div>

          <div className={styles.modalFooter}>
            <button type="button" className="btn btn-secondary" onClick={handleClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Restocking…' : 'Restock'}
            </button>
          </div>
        </form>
    </Modal>
  );
}
