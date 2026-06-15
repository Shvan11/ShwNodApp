/**
 * DeleteConfirmModal Component
 * Confirmation modal for deleting expenses
 */
import type { Expense } from '../../hooks/useExpenses';
import Modal from '../react/Modal';
import ModalHeader from '../react/ModalHeader';
import styles from '../../routes/Expenses.module.css';

interface DeleteConfirmModalProps {
    isOpen: boolean;
    expense: Expense | null;
    onConfirm: () => void;
    onCancel: () => void;
}

export default function DeleteConfirmModal({ isOpen, expense, onConfirm, onCancel }: DeleteConfirmModalProps) {
    if (!expense) return null;

    const formatNumber = (num: number | undefined): string => {
        return new Intl.NumberFormat('en-US').format(num || 0);
    };

    const formatDate = (dateString: string | undefined): string => {
        if (!dateString) return '-';
        return new Date(dateString).toLocaleDateString();
    };

    const date = formatDate(expense.expense_date);
    const amount = formatNumber(expense.amount);
    const currency = (expense.currency || '').trim();

    return (
        <Modal
            isOpen={isOpen}
            onClose={onCancel}
            contentClassName={`${styles.modalContent} ${styles.modalSm}`}
            ariaLabelledBy="delete-expense-modal-title"
        >
            <ModalHeader
                variant="danger"
                titleId="delete-expense-modal-title"
                title="Delete Expense"
                onClose={onCancel}
                closeLabel="Close modal"
            />

            <div className={styles.modalBody}>
                <p className={styles.warningText}>
                    Are you sure you want to delete this expense? This action cannot be undone.
                </p>

                <div className={styles.expenseDetails}>
                    <p><strong>Date:</strong> {date}</p>
                    <p><strong>Amount:</strong> {amount} {currency}</p>
                    <p><strong>Category:</strong> {expense.category_name || '-'}</p>
                    {expense.note && <p><strong>Note:</strong> {expense.note}</p>}
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
        </Modal>
    );
}
