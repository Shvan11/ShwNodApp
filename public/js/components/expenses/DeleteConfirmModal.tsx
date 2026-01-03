/**
 * DeleteConfirmModal Component
 * Confirmation modal for deleting expenses
 */
import React from 'react';
import type { MouseEvent } from 'react';
import type { Expense } from '../../hooks/useExpenses';
import styles from '../../routes/Expenses.module.css';

interface DeleteConfirmModalProps {
    isOpen: boolean;
    expense: Expense | null;
    onConfirm: () => void;
    onCancel: () => void;
}

export default function DeleteConfirmModal({ isOpen, expense, onConfirm, onCancel }: DeleteConfirmModalProps) {
    if (!isOpen || !expense) return null;

    const formatNumber = (num: number | undefined): string => {
        return new Intl.NumberFormat('en-US').format(num || 0);
    };

    const formatDate = (dateString: string | undefined): string => {
        if (!dateString) return '-';
        return new Date(dateString).toLocaleDateString('en-US');
    };

    const handleOverlayClick = (e: MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) {
            onCancel();
        }
    };

    const date = formatDate(expense.ExpenseDate);
    const amount = formatNumber(expense.Amount);
    const currency = (expense.Currency || '').trim();

    return (
        <div className="modal-overlay" onClick={handleOverlayClick}>
            <div className={`${styles.modalContent} ${styles.modalSm}`} onClick={(e) => e.stopPropagation()}>
                <div className={styles.modalHeader}>
                    <h2>Delete Expense</h2>
                    <button className={styles.closeBtn} onClick={onCancel} aria-label="Close modal">
                        &times;
                    </button>
                </div>

                <div className={styles.modalBody}>
                    <p className={styles.warningText}>
                        Are you sure you want to delete this expense? This action cannot be undone.
                    </p>

                    <div className={styles.expenseDetails}>
                        <p><strong>Date:</strong> {date}</p>
                        <p><strong>Amount:</strong> {amount} {currency}</p>
                        <p><strong>Category:</strong> {expense.CategoryName || '-'}</p>
                        {expense.Description && <p><strong>Note:</strong> {expense.Description}</p>}
                    </div>
                </div>

                <div className={styles.modalFooter}>
                    <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={onCancel}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="btn btn-danger"
                        onClick={onConfirm}
                    >
                        Delete Expense
                    </button>
                </div>
            </div>
        </div>
    );
}
