/**
 * ExpenseModal Component
 * Modal for adding and editing expenses
 */
import { useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useCategories, useSubcategories } from '../../hooks/useExpenses';
import { useLocalizedName } from '../../hooks/useLocalizedName';
import type { Expense, ExpenseData } from '../../hooks/useExpenses';
import { formatISODate } from '../../core/utils';
import { formatNumber } from '../../utils/formatters';
import Modal from '../react/Modal';
import ModalHeader from '../react/ModalHeader';
import styles from '../../routes/Expenses.module.css';

// Types
interface Category {
    category_id: number;
    category_name: string;
    category_name_ar?: string | null;
}

interface Subcategory {
    subcategory_id: number;
    subcategory_name: string;
    subcategory_name_ar?: string | null;
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
    onSave: (data: ExpenseData) => void | Promise<void>;
}

export default function ExpenseModal({ isOpen, expense, onClose, onSave }: ExpenseModalProps) {
    const { t } = useTranslation('expenses');
    const localizedName = useLocalizedName();
    const { categories } = useCategories() as { categories: Category[] };
    const [categoryId, setCategoryId] = useState<string | number>('');
    const [submitting, setSubmitting] = useState(false);
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
    const [displayAmount, setDisplayAmount] = useState('');

    // Initialize the form when the modal opens or the edit target changes. Done
    // during render (keyed on open + expense identity) rather than in an effect, so
    // the React Compiler can optimize and there's no extra post-paint render.
    const initKey = isOpen ? String(expense?.id ?? 'new') : '';
    const [initializedKey, setInitializedKey] = useState('');
    if (initKey !== initializedKey) {
        setInitializedKey(initKey);
        if (isOpen) {
            if (expense) {
                // Edit mode - populate with expense data
                setFormData({
                    expenseDate: expense.expense_date?.split('T')[0] || '',
                    amount: expense.amount || 0,
                    currency: (expense.currency || '').trim() || 'IQD',
                    categoryId: expense.category_id || '',
                    subcategoryId: expense.subcategory_id || '',
                    note: expense.note || ''
                });
                setDisplayAmount(expense.amount ? formatNumber(expense.amount) : '');
                setCategoryId(expense.category_id || '');
            } else {
                // Add mode - set default date to today
                const today = formatISODate();
                setFormData({
                    expenseDate: today,
                    amount: 0,
                    currency: 'IQD',
                    categoryId: '',
                    subcategoryId: '',
                    note: ''
                });
                setDisplayAmount('');
                setCategoryId('');
            }
            setErrors({});
        }
    }

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

    // Handle amount input with formatting as you type
    const handleAmountChange = (value: string) => {
        const digits = value.replace(/[^\d]/g, '');
        const num = parseInt(digits, 10) || 0;
        setDisplayAmount(num ? num.toLocaleString('en-US') : '');
        setFormData(prev => ({ ...prev, amount: num }));
        if (errors.amount) {
            setErrors(prev => ({ ...prev, amount: null }));
        }
    };

    const validateForm = (): boolean => {
        const newErrors: FormErrors = {};

        if (!formData.expenseDate) {
            newErrors.expenseDate = t('modal.errorDateRequired');
        }

        if (!formData.amount || Number(formData.amount) <= 0) {
            newErrors.amount = t('modal.errorAmountRequired');
        }

        if (!formData.currency) {
            newErrors.currency = t('modal.errorCurrencyRequired');
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        if (submitting || !validateForm()) {
            return;
        }

        const expenseData: ExpenseData = {
            expense_date: formData.expenseDate,
            amount: parseInt(String(formData.amount), 10),
            currency: formData.currency,
            note: formData.note,
            categoryId: formData.categoryId ? Number(formData.categoryId) : undefined,
            subcategoryId: formData.subcategoryId ? Number(formData.subcategoryId) : undefined
        };

        setSubmitting(true);
        try {
            await onSave(expenseData);
        } finally {
            setSubmitting(false);
        }
    };

    const handleClose = () => {
        setFormData({
            expenseDate: '',
            amount: 0,
            currency: 'IQD',
            categoryId: '',
            subcategoryId: '',
            note: ''
        });
        setDisplayAmount('');
        setCategoryId('');
        setErrors({});
        onClose();
    };

    const isEditMode = !!expense;
    const modalTitle = isEditMode ? t('modal.editTitle') : t('modal.addTitle');

    return (
        <Modal
            isOpen={isOpen}
            onClose={handleClose}
            contentClassName={styles.modalContent}
            ariaLabelledBy="expense-modal-title"
        >
                <ModalHeader
                    titleId="expense-modal-title"
                    title={modalTitle}
                    onClose={handleClose}
                    closeLabel={t('modal.close')}
                />

                <form onSubmit={handleSubmit}>
                    <div className={styles.modalBody}>
                        <div className={styles.formGroup}>
                            <label htmlFor="expense-date">
                                {t('modal.date')} <span className={styles.required}>*</span>
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
                                    {t('modal.amount')} <span className={styles.required}>*</span>
                                </label>
                                <input
                                    type="text"
                                    id="expense-amount"
                                    value={displayAmount}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleAmountChange(e.target.value)}
                                    onBlur={() => setDisplayAmount(formData.amount ? formatNumber(formData.amount) : '')}
                                    placeholder={t('modal.amountPlaceholder')}
                                    className={`${styles.formInput} ${errors.amount ? styles.inputError : ''}`}
                                />
                                {errors.amount && (
                                    <span className={styles.errorMessage}>{errors.amount}</span>
                                )}
                            </div>

                            <div className={styles.formGroup}>
                                <label htmlFor="expense-currency">
                                    {t('modal.currency')} <span className={styles.required}>*</span>
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
                            <label htmlFor="expense-category">{t('modal.category')}</label>
                            <select
                                id="expense-category"
                                value={String(formData.categoryId)}
                                onChange={(e: ChangeEvent<HTMLSelectElement>) => handleCategoryChange(e.target.value)}
                                className={styles.formInput}
                            >
                                <option value="">{t('modal.selectCategory')}</option>
                                {categories.map(cat => (
                                    <option key={cat.category_id} value={cat.category_id}>
                                        {localizedName(cat.category_name, cat.category_name_ar)}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className={styles.formGroup}>
                            <label htmlFor="expense-subcategory">{t('modal.subcategory')}</label>
                            <select
                                id="expense-subcategory"
                                value={String(formData.subcategoryId)}
                                onChange={(e: ChangeEvent<HTMLSelectElement>) => handleInputChange('subcategoryId', e.target.value)}
                                disabled={!formData.categoryId}
                                className={styles.formInput}
                            >
                                <option value="">{t('modal.selectSubcategory')}</option>
                                {subcategories.map(sub => (
                                    <option key={sub.subcategory_id} value={sub.subcategory_id}>
                                        {localizedName(sub.subcategory_name, sub.subcategory_name_ar)}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className={styles.formGroup}>
                            <label htmlFor="expense-note">{t('modal.note')}</label>
                            <textarea
                                id="expense-note"
                                rows={3}
                                value={formData.note}
                                onChange={(e: ChangeEvent<HTMLTextAreaElement>) => handleInputChange('note', e.target.value)}
                                placeholder={t('modal.notePlaceholder')}
                                className={styles.formInput}
                            />
                        </div>
                    </div>

                    <div className={styles.modalFooter}>
                        <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={handleClose}
                            disabled={submitting}
                        >
                            {t('modal.cancel')}
                        </button>
                        <button
                            type="submit"
                            className="btn btn-primary"
                            disabled={submitting}
                        >
                            {submitting ? t('modal.saving') : isEditMode ? t('modal.update') : t('modal.add')}
                        </button>
                    </div>
                </form>
        </Modal>
    );
}
