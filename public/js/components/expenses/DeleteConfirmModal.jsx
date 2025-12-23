/**
 * DeleteConfirmModal Component
 * Confirmation modal for deleting expenses
 */
import React from 'react';

export default function DeleteConfirmModal({ isOpen, expense, onConfirm, onCancel }) {
    if (!isOpen || !expense) return null;

    const formatNumber = (num) => {
        return new Intl.NumberFormat('en-US').format(num || 0);
    };

    const formatDate = (dateString) => {
        return new Date(dateString).toLocaleDateString('en-US');
    };

    const date = formatDate(expense.expenseDate);
    const amount = formatNumber(expense.Amount);
    const currency = (expense.Currency || '').trim();

    return (
        <div className="modal-overlay" onClick={onCancel}>
            <div className="modal-content modal-sm" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Delete Expense</h2>
                    <button className="close" onClick={onCancel} aria-label="Close modal">
                        &times;
                    </button>
                </div>

                <div className="modal-body">
                    <p className="warning-text">
                        Are you sure you want to delete this expense? This action cannot be undone.
                    </p>

                    <div className="expense-details">
                        <p><strong>Date:</strong> {date}</p>
                        <p><strong>Amount:</strong> {amount} {currency}</p>
                        <p><strong>Category:</strong> {expense.CategoryName || '-'}</p>
                        {expense.Note && <p><strong>Note:</strong> {expense.Note}</p>}
                    </div>
                </div>

                <div className="modal-footer">
                    <button
                        type="button"
                        className="btn-action btn-secondary cancel-btn"
                        onClick={onCancel}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="btn-action btn-danger"
                        onClick={onConfirm}
                    >
                        Delete Expense
                    </button>
                </div>
            </div>
        </div>
    );
}
