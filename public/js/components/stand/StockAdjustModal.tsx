/**
 * StockAdjustModal Component
 * Modal for adjusting stock with a delta value and required reason
 */
import { useState, useEffect } from 'react';
import type { ChangeEvent, FormEvent, MouseEvent } from 'react';
import type { StandItem } from '../../hooks/useStand';
import { formatNumber } from '../../utils/formatters';
import styles from './StockAdjustModal.module.css';

interface StockAdjustModalProps {
  isOpen: boolean;
  item: StandItem | null;
  onClose: () => void;
  onSave: (delta: number, reason: string) => void;
}

interface FormErrors {
  delta?: string | null;
  reason?: string | null;
}

export default function StockAdjustModal({ isOpen, item, onClose, onSave }: StockAdjustModalProps) {
  const [delta, setDelta] = useState(0);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});

  useEffect(() => {
    if (isOpen) {
      setDelta(0);
      setReason('');
      setErrors({});
    }
  }, [isOpen]);

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};
    if (delta === 0) {
      newErrors.delta = 'Delta cannot be zero';
    }
    if (!reason.trim()) {
      newErrors.reason = 'Reason is required';
    }
    if (item && item.CurrentStock + delta < 0) {
      newErrors.delta = 'Resulting stock cannot be negative';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!validateForm()) return;
    onSave(delta, reason.trim());
  };

  const handleClose = () => {
    setDelta(0);
    setReason('');
    setErrors({});
    onClose();
  };

  const handleOverlayClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };

  if (!isOpen || !item) return null;

  const resultingStock = item.CurrentStock + delta;
  const previewClass =
    resultingStock > 0
      ? styles.stockPreviewPositive
      : resultingStock === 0
        ? styles.stockPreviewZero
        : styles.stockPreviewNegative;

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2>Adjust Stock</h2>
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

            <div className={styles.formGroup}>
              <label htmlFor="adjust-delta">
                Adjustment (Delta) <span className={styles.required}>*</span>
              </label>
              <input
                type="number"
                id="adjust-delta"
                className={`${styles.formInput} ${errors.delta ? styles.inputError : ''}`}
                value={delta}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  const val = parseInt(e.target.value, 10) || 0;
                  setDelta(val);
                  if (errors.delta) setErrors((prev) => ({ ...prev, delta: null }));
                }}
                step="1"
              />
              <span className={styles.hintText}>
                Use positive values to add stock, negative to remove
              </span>
              {errors.delta && <span className={styles.errorMessage}>{errors.delta}</span>}

              <div className={styles.stockPreview}>
                <span className={styles.stockPreviewLabel}>Resulting Stock</span>
                <span className={`${styles.stockPreviewValue} ${previewClass}`}>
                  {formatNumber(resultingStock)}
                </span>
              </div>
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="adjust-reason">
                Reason <span className={styles.required}>*</span>
              </label>
              <textarea
                id="adjust-reason"
                rows={3}
                className={`${styles.formInput} ${errors.reason ? styles.inputError : ''}`}
                value={reason}
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
                  setReason(e.target.value);
                  if (errors.reason) setErrors((prev) => ({ ...prev, reason: null }));
                }}
                placeholder="Explain the reason for this adjustment..."
              />
              {errors.reason && <span className={styles.errorMessage}>{errors.reason}</span>}
            </div>
          </div>

          <div className={styles.modalFooter}>
            <button type="button" className="btn btn-secondary" onClick={handleClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Adjust Stock
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
