/**
 * DeleteConfirmModal Component
 * Confirmation modal for deleting expenses
 */
import { useTranslation } from 'react-i18next';
import type { Expense } from '../../hooks/useExpenses';
import { useLocalizedName } from '../../hooks/useLocalizedName';
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
    const { t } = useTranslation('expenses');
    const localizedName = useLocalizedName();

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
                title={t('delete.title')}
                onClose={onCancel}
                closeLabel={t('delete.close')}
            />

            <div className={styles.modalBody}>
                <p className={styles.warningText}>
                    {t('delete.confirm')}
                </p>

                <div className={styles.expenseDetails}>
                    <p><strong>{t('delete.date')}:</strong> {date}</p>
                    <p><strong>{t('delete.amount')}:</strong> {amount} {currency}</p>
                    <p><strong>{t('delete.category')}:</strong> {localizedName(expense.category_name, expense.category_name_ar) || '-'}</p>
                    {expense.note && <p><strong>{t('delete.note')}:</strong> {expense.note}</p>}
                </div>
            </div>

            <div className={styles.modalFooter}>
                <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={onCancel}
                >
                    {t('delete.cancel')}
                </button>
                <button
                    type="button"
                    className="btn btn-danger"
                    onClick={onConfirm}
                >
                    {t('delete.confirmButton')}
                </button>
            </div>
        </Modal>
    );
}
