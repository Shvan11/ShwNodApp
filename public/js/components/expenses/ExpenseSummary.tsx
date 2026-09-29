/**
 * ExpenseSummary Component
 * Displays expense summary with totals by currency
 */
import { useTranslation } from 'react-i18next';
import type { Expense } from '../../hooks/useExpenses';
import styles from '../../routes/Expenses.module.css';
import { formatNumber } from '../../utils/formatters';

interface ExpenseSummaryProps {
    /** The rows the table shows — every filter already applied (the list is never paginated). */
    expenses: Expense[];
    loading: boolean;
}

interface SummaryResult {
    iqd: number;
    usd: number;
    count: number;
}

export default function ExpenseSummary({ expenses, loading }: ExpenseSummaryProps) {
    const { t } = useTranslation('expenses');

    // Totals of exactly the rows on screen. This used to prefer GET /api/expenses/summary,
    // which filters by date only, so a category/lab/employee/currency/type filter narrowed
    // the table while the cards kept the whole range's totals (FE-F8-1).
    // `expenses.currency` is citext, so match case-insensitively as the server's filter does.
    const getSummaryData = (): SummaryResult => {
        const iqd = expenses
            .filter(e => (e.currency || '').trim().toUpperCase() === 'IQD')
            .reduce((sum, e) => sum + (e.amount ?? 0), 0);

        const usd = expenses
            .filter(e => (e.currency || '').trim().toUpperCase() === 'USD')
            .reduce((sum, e) => sum + (e.amount ?? 0), 0);

        return { iqd, usd, count: expenses.length };
    };

    const { iqd, usd, count } = getSummaryData();

    if (loading) {
        return (
            <div className={styles.summaryContainer}>
                <div className={styles.loadingState}>
                    <div className={styles.loadingSpinner}></div>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.summaryContainer}>
            <div className={styles.summaryGrid}>
                <div className={`${styles.summaryCard} ${styles.totalCount}`}>
                    <div className={styles.summaryLabel}>{t('summary.totalExpenses')}</div>
                    <div className={styles.summaryValue}>{count}</div>
                </div>

                <div className={`${styles.summaryCard} ${styles.currencyIqd}`}>
                    <div className={styles.summaryLabel}>{t('summary.totalIqd')}</div>
                    <div className={styles.summaryValue}>
                        {formatNumber(iqd)} <span className={styles.currencyLabel}>IQD</span>
                    </div>
                </div>

                <div className={`${styles.summaryCard} ${styles.currencyUsd}`}>
                    <div className={styles.summaryLabel}>{t('summary.totalUsd')}</div>
                    <div className={styles.summaryValue}>
                        {formatNumber(usd)} <span className={styles.currencyLabel}>USD</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
