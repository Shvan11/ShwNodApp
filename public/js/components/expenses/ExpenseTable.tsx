/**
 * ExpenseTable Component
 * Displays expenses in a table with edit and delete actions
 */
import React from 'react';
import type { Expense } from '../../hooks/useExpenses';
import styles from '../../routes/Expenses.module.css';

// Re-export the Expense type for convenience
export type { Expense } from '../../hooks/useExpenses';

interface ExpenseTableProps {
    expenses: Expense[];
    loading: boolean;
    onEdit: (id: number) => void;
    onDelete: (id: number) => void;
}

export default function ExpenseTable({ expenses, loading, onEdit, onDelete }: ExpenseTableProps) {
    const formatNumber = (num: number | undefined): string => {
        return new Intl.NumberFormat('en-US').format(num || 0);
    };

    const formatDate = (dateString: string | undefined): string => {
        if (!dateString) return '-';
        return new Date(dateString).toLocaleDateString('en-US');
    };

    if (loading) {
        return (
            <div className={styles.loadingState}>
                <div className={styles.loadingSpinner}></div>
                <p>Loading expenses...</p>
            </div>
        );
    }

    if (!expenses || expenses.length === 0) {
        return (
            <div className={styles.emptyState}>
                <p>No expenses found</p>
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
        <div className={styles.tableContainer}>
            <table className={styles.expensesTable}>
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Amount</th>
                        <th>Currency</th>
                        <th>Category</th>
                        <th>Subcategory</th>
                        <th>Note</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {expenses.map((expense, index) => {
                        const date = formatDate(expense.ExpenseDate);
                        const amount = formatNumber(expense.Amount);
                        const currency = (expense.Currency || '').trim();
                        const currencyLower = currency.toLowerCase();
                        const category = expense.CategoryName || '-';
                        const subcategory = expense.SubcategoryName || '-';
                        const note = expense.Description || '-';

                        return (
                            <tr key={expense.ExpenseID ?? `expense-${index}`} data-expense-id={expense.ExpenseID}>
                                <td>{date}</td>
                                <td className={`${styles.amountCell} ${getCurrencyClass(currencyLower)}`}>
                                    {amount}
                                </td>
                                <td>
                                    <span className={getCurrencyClass(currencyLower)}>
                                        {currency}
                                    </span>
                                </td>
                                <td>{category}</td>
                                <td>{subcategory}</td>
                                <td className={styles.noteCell} title={note}>
                                    {note}
                                </td>
                                <td>
                                    <div className={styles.actionButtons}>
                                        <button
                                            className="btn-edit"
                                            onClick={() => onEdit(expense.ExpenseID)}
                                            aria-label="Edit expense"
                                        >
                                            Edit
                                        </button>
                                        <button
                                            className="btn-delete"
                                            onClick={() => onDelete(expense.ExpenseID)}
                                            aria-label="Delete expense"
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
