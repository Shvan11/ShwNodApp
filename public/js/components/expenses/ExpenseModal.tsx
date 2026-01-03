/**
 * ExpenseModal Component
 * Modal for adding and editing expenses
 */
import React, { useState, useEffect } from 'react';
import type { ChangeEvent, FormEvent, MouseEvent } from 'react';
import { useCategories, useSubcategories } from '../../hooks/useExpenses';
import type { Expense, ExpenseData } from '../../hooks/useExpenses';
import styles from '../../routes/Expenses.module.css';

// Types
interface Category {
    CategoryID: number;
    CategoryName: string;
}

interface Subcategory {
    SubcategoryID: number;
    SubcategoryName: string;
}

interface FormData {
    expenseDate: string;
    amount: string | number;
    currency: string;
    categoryId: string | number;
    subcategoryId: string | number;
    note: string;
}

interface FormErrors {
    expenseDate?: string | null;
    amount?: string | null;
    currency?: string | null;
}

interface ExpenseModalProps {
    isOpen: boolean;
    expense: Expense | null;
    onClose: () => void;
    onSave: (data: ExpenseData) => void;
}

export default function ExpenseModal({ isOpen, expense, onClose, onSave }: ExpenseModalProps) {
    const { categories } = useCategories() as { categories: Category[] };
    const [categoryId, setCategoryId] = useState<string | number>('');
    const { subcategories } = useSubcategories(categoryId) as { subcategories: Subcategory[] };

    const [formData, setFormData] = useState<FormData>({
        expenseDate: '',
        amount: '',
        currency: 'IQD',
        categoryId: '',
        subcategoryId: '',
        note: ''
    });

    const [errors, setErrors] = useState<FormErrors>({});

    // Initialize form when modal opens or expense changes
    useEffect(() => {
        if (isOpen) {
            if (expense) {
                // Edit mode - populate with expense data
                setFormData({
                    expenseDate: expense.ExpenseDate?.split('T')[0] || '',
                    amount: expense.Amount || '',
                    currency: (expense.Currency || '').trim() || 'IQD',
                    categoryId: expense.CategoryID || '',
                    subcategoryId: expense.SubcategoryID || '',
                    note: expense.Description || ''
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

    const handleInputChange = (field: keyof FormData, value: string) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        // Clear error for this field
        if (errors[field as keyof FormErrors]) {
            setErrors(prev => ({ ...prev, [field]: null }));
        }
    };

    const handleCategoryChange = (value: string) => {
        setCategoryId(value);
        setFormData(prev => ({
            ...prev,
            categoryId: value,
            subcategoryId: '' // Reset subcategory when category changes
        }));
    };

    const validateForm = (): boolean => {
        const newErrors: FormErrors = {};

        if (!formData.expenseDate) {
            newErrors.expenseDate = 'Date is required';
        }

        if (!formData.amount || Number(formData.amount) <= 0) {
            newErrors.amount = 'Valid amount is required';
        }

        if (!formData.currency) {
            newErrors.currency = 'Currency is required';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        if (!validateForm()) {
            return;
        }

        const expenseData: ExpenseData = {
            expenseDate: formData.expenseDate,
            amount: parseInt(String(formData.amount)),
            currency: formData.currency,
            note: formData.note,
            categoryId: formData.categoryId ? Number(formData.categoryId) : undefined,
            subcategoryId: formData.subcategoryId ? Number(formData.subcategoryId) : undefined
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

    const handleOverlayClick = (e: MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) {
            handleClose();
        }
    };

    if (!isOpen) return null;

    const isEditMode = !!expense;
    const modalTitle = isEditMode ? 'Edit Expense' : 'Add New Expense';

    return (
        <div className="modal-overlay" onClick={handleOverlayClick}>
            <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
                <div className={styles.modalHeader}>
                    <h2>{modalTitle}</h2>
                    <button className={styles.closeBtn} onClick={handleClose} aria-label="Close modal">
                        &times;
                    </button>
                </div>

                <form onSubmit={handleSubmit}>
                    <div className={styles.modalBody}>
                        <div className={styles.formGroup}>
                            <label htmlFor="expense-date">
                                Date <span className={styles.required}>*</span>
                            </label>
                            <input
                                type="date"
                                id="expense-date"
                                value={formData.expenseDate}
                                onChange={(e: ChangeEvent<HTMLInputElement>) => handleInputChange('expenseDate', e.target.value)}
                                className={`${styles.formInput} ${errors.expenseDate ? styles.inputError : ''}`}
                            />
                            {errors.expenseDate && (
                                <span className={styles.errorMessage}>{errors.expenseDate}</span>
                            )}
                        </div>

                        <div className={styles.formRow}>
                            <div className={styles.formGroup}>
                                <label htmlFor="expense-amount">
                                    Amount <span className={styles.required}>*</span>
                                </label>
                                <input
                                    type="number"
                                    id="expense-amount"
                                    min="0"
                                    step="1"
                                    value={formData.amount}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleInputChange('amount', e.target.value)}
                                    className={`${styles.formInput} ${errors.amount ? styles.inputError : ''}`}
                                />
                                {errors.amount && (
                                    <span className={styles.errorMessage}>{errors.amount}</span>
                                )}
                            </div>

                            <div className={styles.formGroup}>
                                <label htmlFor="expense-currency">
                                    Currency <span className={styles.required}>*</span>
                                </label>
                                <select
                                    id="expense-currency"
                                    value={formData.currency}
                                    onChange={(e: ChangeEvent<HTMLSelectElement>) => handleInputChange('currency', e.target.value)}
                                    className={`${styles.formInput} ${errors.currency ? styles.inputError : ''}`}
                                >
                                    <option value="IQD">IQD</option>
                                    <option value="USD">USD</option>
                                </select>
                                {errors.currency && (
                                    <span className={styles.errorMessage}>{errors.currency}</span>
                                )}
                            </div>
                        </div>

                        <div className={styles.formGroup}>
                            <label htmlFor="expense-category">Category</label>
                            <select
                                id="expense-category"
                                value={String(formData.categoryId)}
                                onChange={(e: ChangeEvent<HTMLSelectElement>) => handleCategoryChange(e.target.value)}
                                className={styles.formInput}
                            >
                                <option value="">Select Category</option>
                                {categories.map(cat => (
                                    <option key={cat.CategoryID} value={cat.CategoryID}>
                                        {cat.CategoryName}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className={styles.formGroup}>
                            <label htmlFor="expense-subcategory">Subcategory</label>
                            <select
                                id="expense-subcategory"
                                value={String(formData.subcategoryId)}
                                onChange={(e: ChangeEvent<HTMLSelectElement>) => handleInputChange('subcategoryId', e.target.value)}
                                disabled={!formData.categoryId}
                                className={styles.formInput}
                            >
                                <option value="">Select Subcategory</option>
                                {subcategories.map(sub => (
                                    <option key={sub.SubcategoryID} value={sub.SubcategoryID}>
                                        {sub.SubcategoryName}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className={styles.formGroup}>
                            <label htmlFor="expense-note">Note</label>
                            <textarea
                                id="expense-note"
                                rows={3}
                                value={formData.note}
                                onChange={(e: ChangeEvent<HTMLTextAreaElement>) => handleInputChange('note', e.target.value)}
                                placeholder="Add any notes about this expense..."
                                className={styles.formInput}
                            />
                        </div>
                    </div>

                    <div className={styles.modalFooter}>
                        <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={handleClose}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="btn btn-primary"
                        >
                            {isEditMode ? 'Update Expense' : 'Add Expense'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
