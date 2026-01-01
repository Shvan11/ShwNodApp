/**
 * ExpenseSummary Component
 * Displays expense summary with totals by currency
 */
import React from 'react';
import { useExpenseSummary } from '../../hooks/useExpenses';
import type { Expense } from '../../hooks/useExpenses';

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
            <div className="summary-container">
                <div className="loading-state">
                    <div className="loading-spinner"></div>
                </div>
            </div>
        );
    }

    return (
        <div className="summary-container">
            <div className="summary-grid">
                <div className="summary-card total-count">
                    <div className="summary-label">Total Expenses</div>
                    <div className="summary-value">{count}</div>
                </div>

                <div className="summary-card currency-iqd">
                    <div className="summary-label">Total IQD</div>
                    <div className="summary-value">
                        {formatNumber(iqd)} <span className="currency-label">IQD</span>
                    </div>
                </div>

                <div className="summary-card currency-usd">
                    <div className="summary-label">Total USD</div>
                    <div className="summary-value">
                        {formatNumber(usd)} <span className="currency-label">USD</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
