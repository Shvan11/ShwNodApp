/**
 * ExpenseModal Component
 * Modal for adding and editing expenses
 */
import React, { useState, useEffect } from 'react';
import { useCategories, useSubcategories } from '../../hooks/useExpenses.js';

export default function ExpenseModal({ isOpen, expense, onClose, onSave }) {
    const { categories } = useCategories();
    const [categoryId, setCategoryId] = useState('');
    const { subcategories } = useSubcategories(categoryId);

    const [formData, setFormData] = useState({
        expenseDate: '',
        amount: '',
        currency: 'IQD',
        categoryId: '',
        subcategoryId: '',
        note: ''
    });

    const [errors, setErrors] = useState({});

    // Initialize form when modal opens or expense changes
    useEffect(() => {
        if (isOpen) {
            if (expense) {
                // Edit mode - populate with expense data
                setFormData({
                    expenseDate: expense.expenseDate?.split('T')[0] || '',
                    amount: expense.Amount || '',
                    currency: (expense.Currency || '').trim() || 'IQD',
                    categoryId: expense.CategoryID || '',
                    subcategoryId: expense.SubcategoryID || '',
                    note: expense.Note || ''
                });
                setCategoryId(expense.CategoryID || '');
            } else {
                // Add mode - set default date to today
                const today = new Date().toISOString().split('T')[0];
                setFormData({
                    expenseDate: today,
                    amount: '',
                    currency: 'IQD',
                    categoryId: '',
                    subcategoryId: '',
                    note: ''
                });
                setCategoryId('');
            }
            setErrors({});
        }
    }, [isOpen, expense]);

    const handleInputChange = (field, value) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        // Clear error for this field
        if (errors[field]) {
            setErrors(prev => ({ ...prev, [field]: null }));
        }
    };

    const handleCategoryChange = (value) => {
        setCategoryId(value);
        setFormData(prev => ({
            ...prev,
            categoryId: value,
            subcategoryId: '' // Reset subcategory when category changes
        }));
    };

    const validateForm = () => {
        const newErrors = {};

        if (!formData.expenseDate) {
            newErrors.expenseDate = 'Date is required';
        }

        if (!formData.amount || formData.amount <= 0) {
            newErrors.amount = 'Valid amount is required';
        }

        if (!formData.currency) {
            newErrors.currency = 'Currency is required';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = (e) => {
        e.preventDefault();

        if (!validateForm()) {
            return;
        }

        const expenseData = {
            expenseDate: formData.expenseDate,
            amount: parseInt(formData.amount),
            currency: formData.currency,
            note: formData.note,
            categoryId: formData.categoryId || null,
            subcategoryId: formData.subcategoryId || null
        };

        onSave(expenseData);
    };

    const handleClose = () => {
        setFormData({
            expenseDate: '',
            amount: '',
            currency: 'IQD',
            categoryId: '',
            subcategoryId: '',
            note: ''
        });
        setCategoryId('');
        setErrors({});
        onClose();
    };

    if (!isOpen) return null;

    const isEditMode = !!expense;
    const modalTitle = isEditMode ? 'Edit Expense' : 'Add New Expense';

    return (
        <div className="modal-overlay" onClick={handleClose}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{modalTitle}</h2>
                    <button className="close" onClick={handleClose} aria-label="Close modal">
                        &times;
                    </button>
                </div>

                <form onSubmit={handleSubmit}>
                    <div className="modal-body">
                        <div className="form-group">
                            <label htmlFor="expense-date">
                                Date <span className="required">*</span>
                            </label>
                            <input
                                type="date"
                                id="expense-date"
                                value={formData.expenseDate}
                                onChange={(e) => handleInputChange('expenseDate', e.target.value)}
                                className={errors.expenseDate ? 'error' : ''}
                            />
                            {errors.expenseDate && (
                                <span className="error-message">{errors.expenseDate}</span>
                            )}
                        </div>

                        <div className="form-row">
                            <div className="form-group">
                                <label htmlFor="expense-amount">
                                    Amount <span className="required">*</span>
                                </label>
                                <input
                                    type="number"
                                    id="expense-amount"
                                    min="0"
                                    step="1"
                                    value={formData.amount}
                                    onChange={(e) => handleInputChange('amount', e.target.value)}
                                    className={errors.amount ? 'error' : ''}
                                />
                                {errors.amount && (
                                    <span className="error-message">{errors.amount}</span>
                                )}
                            </div>

                            <div className="form-group">
                                <label htmlFor="expense-currency">
                                    Currency <span className="required">*</span>
                                </label>
                                <select
                                    id="expense-currency"
                                    value={formData.currency}
                                    onChange={(e) => handleInputChange('currency', e.target.value)}
                                    className={errors.currency ? 'error' : ''}
                                >
                                    <option value="IQD">IQD</option>
                                    <option value="USD">USD</option>
                                </select>
                                {errors.currency && (
                                    <span className="error-message">{errors.currency}</span>
                                )}
                            </div>
                        </div>

                        <div className="form-group">
                            <label htmlFor="expense-category">Category</label>
                            <select
                                id="expense-category"
                                value={formData.categoryId}
                                onChange={(e) => handleCategoryChange(e.target.value)}
                            >
                                <option value="">Select Category</option>
                                {categories.map(cat => (
                                    <option key={cat.CategoryID} value={cat.CategoryID}>
                                        {cat.CategoryName}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="form-group">
                            <label htmlFor="expense-subcategory">Subcategory</label>
                            <select
                                id="expense-subcategory"
                                value={formData.subcategoryId}
                                onChange={(e) => handleInputChange('subcategoryId', e.target.value)}
                                disabled={!formData.categoryId}
                            >
                                <option value="">Select Subcategory</option>
                                {subcategories.map(sub => (
                                    <option key={sub.SubcategoryID} value={sub.SubcategoryID}>
                                        {sub.SubcategoryName}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="form-group">
                            <label htmlFor="expense-note">Note</label>
                            <textarea
                                id="expense-note"
                                rows="3"
                                value={formData.note}
                                onChange={(e) => handleInputChange('note', e.target.value)}
                                placeholder="Add any notes about this expense..."
                            />
                        </div>
                    </div>

                    <div className="modal-footer">
                        <button
                            type="button"
                            className="btn-action btn-secondary cancel-btn"
                            onClick={handleClose}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="btn-action btn-primary"
                        >
                            {isEditMode ? 'Update Expense' : 'Add Expense'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
