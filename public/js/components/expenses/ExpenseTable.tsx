/**
 * ExpenseTable Component
 * Displays expenses in a table with edit and delete actions
 */
import React from 'react';
import type { Expense } from '../../hooks/useExpenses';

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
            <div className="loading-state">
                <div className="loading-spinner"></div>
                <p>Loading expenses...</p>
            </div>
        );
    }

    if (!expenses || expenses.length === 0) {
        return (
            <div className="empty-state">
                <p>No expenses found</p>
            </div>
        );
    }

    return (
        <div className="table-container">
            <table className="expenses-table">
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
                    {expenses.map(expense => {
                        const date = formatDate(expense.ExpenseDate);
                        const amount = formatNumber(expense.Amount);
                        const currency = (expense.Currency || '').trim();
                        const category = expense.CategoryName || '-';
                        const subcategory = expense.SubcategoryName || '-';
                        const note = expense.Description || '-';

                        return (
                            <tr key={expense.ExpenseID} data-expense-id={expense.ExpenseID}>
                                <td>{date}</td>
                                <td className={`amount-cell currency-${currency.toLowerCase()}`}>
                                    {amount}
                                </td>
                                <td>
                                    <span className={`currency-${currency.toLowerCase()}`}>
                                        {currency}
                                    </span>
                                </td>
                                <td>{category}</td>
                                <td>{subcategory}</td>
                                <td className="note-cell" title={note}>
                                    {note}
                                </td>
                                <td>
                                    <div className="action-buttons">
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
