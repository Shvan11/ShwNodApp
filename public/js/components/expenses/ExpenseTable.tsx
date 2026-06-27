/**
 * ExpenseTable Component
 * Displays expenses in a table with edit and delete actions
 */
import { useTranslation } from 'react-i18next';
import type { Expense } from '../../hooks/useExpenses';
import { useLocalizedName } from '../../hooks/useLocalizedName';
import styles from '../../routes/Expenses.module.css';

// Re-export the Expense type for convenience
export type { Expense } from '../../hooks/useExpenses';

interface ExpenseTableProps {
    expenses: Expense[];
    loading: boolean;
    onEdit: (id: number) => void;
    onDelete: (id: number) => void;
    /** Edit/delete actions hide when false — clinical role sees expenses read-only. */
    writeFinance?: boolean;
}

export default function ExpenseTable({ expenses, loading, onEdit, onDelete, writeFinance = true }: ExpenseTableProps) {
    const { t } = useTranslation('expenses');
    const localizedName = useLocalizedName();

    const formatNumber = (num: number | undefined): string => {
        return new Intl.NumberFormat('en-US').format(num || 0);
    };

    const formatDate = (dateString: string | undefined): string => {
        if (!dateString) return '-';
        return new Date(dateString).toLocaleDateString();
    };

    if (loading) {
        return (
            <div className={styles.loadingState}>
                <div className={styles.loadingSpinner}></div>
                <p>{t('table.loading')}</p>
            </div>
        );
    }

    if (!expenses || expenses.length === 0) {
        return (
            <div className={styles.emptyState}>
                <p>{t('table.empty')}</p>
            </div>
        );
    }

    // Get currency style class
    const getCurrencyClass = (currency: string): string => {
        if (currency === 'iqd') return styles.tableCurrencyIqd;
        if (currency === 'usd') return styles.tableCurrencyUsd;
        return '';
    };

    return (
        <div className={styles.tableScrollWrapper}>
            <div className={styles.tableContainer}>
                <table className={styles.expensesTable}>
                <thead>
                    <tr>
                        <th>{t('table.date')}</th>
                        <th>{t('table.amount')}</th>
                        <th>{t('table.currency')}</th>
                        <th>{t('table.type')}</th>
                        <th>{t('table.category')}</th>
                        <th>{t('table.subcategory')}</th>
                        <th>{t('table.note')}</th>
                        {writeFinance && <th>{t('table.actions')}</th>}
                    </tr>
                </thead>
                <tbody>
                    {expenses.map((expense, index) => {
                        const date = formatDate(expense.expense_date);
                        const amount = formatNumber(expense.amount);
                        const currency = (expense.currency || '').trim();
                        const currencyLower = currency.toLowerCase();
                        const category = localizedName(expense.category_name, expense.category_name_ar) || '-';
                        // Sub-level: subcategory for normal categories; the entity name for Lab/Employees expenses.
                        const subcategory = localizedName(expense.subcategory_name, expense.subcategory_name_ar)
                            || expense.lab_name || expense.employee_name || '-';
                        const note = expense.note || '-';

                        return (
                            <tr key={expense.id ?? `expense-${index}`} data-expense-id={expense.id}>
                                <td>{date}</td>
                                <td className={`${styles.amountCell} ${getCurrencyClass(currencyLower)}`}>
                                    {amount}
                                </td>
                                <td>
                                    <span className={getCurrencyClass(currencyLower)}>
                                        {currency}
                                    </span>
                                </td>
                                <td>
                                    {expense.is_monthly && (
                                        <span className={styles.monthlyBadge}>{t('table.monthly')}</span>
                                    )}
                                </td>
                                <td>{category}</td>
                                <td>{subcategory}</td>
                                <td className={styles.noteCell} title={note}>
                                    {note}
                                </td>
                                {writeFinance && (
                                    <td>
                                        <div className={styles.actionButtons}>
                                            <button
                                                className="btn-edit"
                                                onClick={() => onEdit(expense.id)}
                                                aria-label={t('table.editAria')}
                                            >
                                                {t('table.edit')}
                                            </button>
                                            <button
                                                className="btn-delete"
                                                onClick={() => onDelete(expense.id)}
                                                aria-label={t('table.deleteAria')}
                                            >
                                                {t('table.delete')}
                                            </button>
                                        </div>
                                    </td>
                                )}
                            </tr>
                        );
                    })}
                </tbody>
                </table>
            </div>
        </div>
    );
}
