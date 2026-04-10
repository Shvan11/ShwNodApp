/**
 * RestockModal Component
 * Modal for restocking a stand inventory item with quantity and unit cost
 */
import { useState, useEffect } from 'react';
import type { ChangeEvent, FormEvent, MouseEvent } from 'react';
import type { StandItem } from '../../hooks/useStand';
import { formatNumber } from '../../utils/formatters';
import styles from './RestockModal.module.css';

interface RestockModalProps {
  isOpen: boolean;
  item: StandItem | null;
  onClose: () => void;
  onSave: (quantity: number, unitCost: number) => void;
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

  useEffect(() => {
    if (isOpen && item) {
      setQuantity(1);
      setUnitCost(item.CostPrice);
      setDisplayUnitCost(item.CostPrice ? formatNumber(item.CostPrice) : '');
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

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!validateForm()) return;
    onSave(quantity, unitCost);
  };

  const handleClose = () => {
    setQuantity(1);
    setUnitCost(0);
    setDisplayUnitCost('');
    setErrors({});
    onClose();
  };

  const handleOverlayClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };

  if (!isOpen || !item) return null;

  const totalCost = quantity * unitCost;

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2>Restock Item</h2>
          <button className={styles.closeBtn} onClick={handleClose} aria-label="Close modal">
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className={styles.modalBody}>
            <div className={styles.itemInfo}>
              <p>
                <strong>{item.ItemName}</strong>
              </p>
              <p>Current Stock: {formatNumber(item.CurrentStock)}</p>
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
            <button type="button" className="btn btn-secondary" onClick={handleClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Restock
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
