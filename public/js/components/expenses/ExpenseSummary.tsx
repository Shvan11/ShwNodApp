/**
 * ExpenseSummary Component
 * Displays expense summary with totals by currency
 */
import React from 'react';
import { useExpenseSummary } from '../../hooks/useExpenses';
import type { Expense } from '../../hooks/useExpenses';
import styles from '../../routes/Expenses.module.css';

// Types
interface SummaryTotal {
    Currency: string;
    TotalAmount: number;
    ExpenseCount?: number;
}

interface SummaryData {
    totals?: SummaryTotal[];
}

interface ExpenseSummaryProps {
    startDate?: string | null;
    endDate?: string | null;
    expenses?: Expense[];
}

interface SummaryResult {
    iqd: number;
    usd: number;
    count: number;
}

export default function ExpenseSummary({ startDate, endDate, expenses }: ExpenseSummaryProps) {
    const { summary, loading } = useExpenseSummary(startDate, endDate) as { summary: SummaryData | null; loading: boolean };

    const formatNumber = (num: number): string => {
        return new Intl.NumberFormat('en-US').format(num || 0);
    };

    // Calculate summary from API or fallback to client-side calculation
    const getSummaryData = (): SummaryResult => {
        if (startDate && endDate && summary) {
            // Use server-side summary when date range is available
            const iqd = summary.totals?.find(t => t.Currency === 'IQD')?.TotalAmount || 0;
            const usd = summary.totals?.find(t => t.Currency === 'USD')?.TotalAmount || 0;
            const count = summary.totals?.reduce((sum, t) => sum + (t.ExpenseCount || 0), 0) || 0;

            return { iqd, usd, count };
        }

        // Fallback to client-side calculation
        if (!expenses || expenses.length === 0) {
            return { iqd: 0, usd: 0, count: 0 };
        }

        const iqd = expenses
            .filter(e => (e.Currency || '').trim() === 'IQD')
            .reduce((sum, e) => sum + (e.Amount ?? 0), 0);

        const usd = expenses
            .filter(e => (e.Currency || '').trim() === 'USD')
            .reduce((sum, e) => sum + (e.Amount ?? 0), 0);

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
                    <div className={styles.summaryLabel}>Total Expenses</div>
                    <div className={styles.summaryValue}>{count}</div>
                </div>

                <div className={`${styles.summaryCard} ${styles.currencyIqd}`}>
                    <div className={styles.summaryLabel}>Total IQD</div>
                    <div className={styles.summaryValue}>
                        {formatNumber(iqd)} <span className={styles.currencyLabel}>IQD</span>
                    </div>
                </div>

                <div className={`${styles.summaryCard} ${styles.currencyUsd}`}>
                    <div className={styles.summaryLabel}>Total USD</div>
                    <div className={styles.summaryValue}>
                        {formatNumber(usd)} <span className={styles.currencyLabel}>USD</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
