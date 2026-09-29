/**
 * ExpenseModal Component
 * Modal for adding and editing expenses
 */
import { useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '../../contexts/ConfirmContext';
import { ENTRY_DATE_MIN, unusualEntryDate } from '../../utils/entryDate';
import { useCategories, useSubcategories, useLabs, useActiveEmployees } from '../../hooks/useExpenses';
import { useLocalizedName } from '../../hooks/useLocalizedName';
import { useLookupManager } from '../../hooks/useLookupManager';
import { qk } from '@/query/keys';
import type { Expense, ExpenseData } from '../../hooks/useExpenses';
import { EMPLOYEE_EXPENSE_CATEGORY, LAB_EXPENSE_CATEGORY } from '../../config/expenseCategories';
import { formatISODate } from '../../core/utils';
import { formatNumber } from '../../utils/formatters';
import Modal from '../react/Modal';
import ModalHeader from '../react/ModalHeader';
import styles from '../../routes/Expenses.module.css';

// Types
interface FormData {
    expenseDate: string;
    amount: string | number;
    currency: string;
    categoryId: string | number;
    subcategoryId: string | number;
    // Entity sub-levels for the Lab / Employees categories (one is used per category).
    labId: string | number;
    employeeId: string | number;
    note: string;
    isMonthly: boolean;
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
    const confirm = useConfirm();
    const { categories } = useCategories();
    const [categoryId, setCategoryId] = useState<string | number>('');
    const [submitting, setSubmitting] = useState(false);
    const { subcategories } = useSubcategories(categoryId);
    const { labs: activeLabs } = useLabs();
    const { employees: activeEmployees } = useActiveEmployees();
    // The lists hold only ACTIVE labs / employees. An expense booked to a lab since
    // deactivated, or to someone who has since quit, keeps its id — so its own
    // entity is appended rather than showing "Select …" over an id that is still
    // re-sent (FE-F8-12, the fix FE-F7-1 gave the work form's doctor).
    const labs = expense?.lab_id != null && !activeLabs.some(l => l.id === expense.lab_id)
        ? [...activeLabs, { id: expense.lab_id, name: expense.lab_name ?? `#${expense.lab_id}` }]
        : activeLabs;
    const employees = expense?.employee_id != null && !activeEmployees.some(emp => emp.id === expense.employee_id)
        ? [...activeEmployees, { id: expense.employee_id, employee_name: expense.employee_name ?? `#${expense.employee_id}` }]
        : activeEmployees;

    // Right-click the Lab dropdown → "Edit labs" → manage the labs lookup inline
    // (stacks on top of this modal). Edits refresh the shared labs feed.
    const labLookup = useLookupManager({
        tableKey: 'tblLabs',
        title: t('modal.manageLabs'),
        menuLabel: t('modal.editLabs'),
        invalidateKeys: [qk.lookups.labs()],
    });

    // The Lab / Employees categories swap the subcategory dropdown for an entity dropdown.
    const catNum = Number(categoryId);
    const subLevel: 'employee' | 'lab' | 'subcategory' =
        catNum === EMPLOYEE_EXPENSE_CATEGORY ? 'employee'
        : catNum === LAB_EXPENSE_CATEGORY ? 'lab'
        : 'subcategory';

    const [formData, setFormData] = useState<FormData>({
        expenseDate: '',
        amount: '',
        currency: 'IQD',
        categoryId: '',
        subcategoryId: '',
        labId: '',
        employeeId: '',
        note: '',
        isMonthly: false,
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
                    labId: expense.lab_id || '',
                    employeeId: expense.employee_id || '',
                    note: expense.note || '',
                    isMonthly: expense.is_monthly ?? false,
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
                    labId: '',
                    employeeId: '',
                    note: '',
                    isMonthly: false,
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
            // Reset every sub-level when the category changes (only one applies per category).
            subcategoryId: '',
            labId: '',
            employeeId: '',
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

        // A slipped year digit saves silently otherwise, outside every period total
        // (FE-F8-9). Asked only when the date is new — re-saving an old expense
        // unchanged must not nag.
        const originalDate = expense?.expense_date?.split('T')[0];
        const unusualDate = formData.expenseDate !== originalDate
            ? unusualEntryDate(formData.expenseDate, formatISODate())
            : null;
        if (unusualDate) {
            const message = unusualDate === 'future'
                ? t('modal.futureDateMessage', { date: formData.expenseDate })
                : t('modal.oldDateMessage', { date: formData.expenseDate });
            if (!await confirm(message, { title: t('modal.unusualDateTitle'), confirmText: t('modal.unusualDateConfirm') })) return;
        }

        const expenseData: ExpenseData = {
            expense_date: formData.expenseDate,
            amount: parseInt(String(formData.amount), 10),
            currency: formData.currency,
            note: formData.note,
            categoryId: formData.categoryId ? Number(formData.categoryId) : undefined,
            // Only the sub-level that matches the chosen category is sent.
            subcategoryId: subLevel === 'subcategory' && formData.subcategoryId ? Number(formData.subcategoryId) : undefined,
            labId: subLevel === 'lab' && formData.labId ? Number(formData.labId) : undefined,
            employeeId: subLevel === 'employee' && formData.employeeId ? Number(formData.employeeId) : undefined,
            isMonthly: formData.isMonthly,
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
            labId: '',
            employeeId: '',
            note: '',
            isMonthly: false,
        });
        setDisplayAmount('');
        setCategoryId('');
        setErrors({});
        onClose();
    };

    const isEditMode = !!expense;
    const modalTitle = isEditMode ? t('modal.editTitle') : t('modal.addTitle');

    return (
        <>
        <Modal
            isOpen={isOpen}
            onClose={handleClose}
            contentClassName={styles.modalContent}
            ariaLabelledBy="expense-modal-title"
            // The form is seeded during render (the row in edit mode, today's date
            // in add mode); programmatic writes dispatch no input event, so only a
            // real edit arms the guard.
            unsavedGuard={{ watchInput: true }}
        >
            {(dismiss) => (<>
                <ModalHeader
                    titleId="expense-modal-title"
                    title={modalTitle}
                    onClose={dismiss}
                    closeLabel={t('modal.close')}
                />

                <form onSubmit={handleSubmit}>
                    <div className={styles.modalBody}>
                        <div className={styles.monthlyToggle}>
                            <label className={styles.monthlyToggleLabel}>
                                <input
                                    type="checkbox"
                                    checked={formData.isMonthly}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                                        setFormData(prev => ({ ...prev, isMonthly: e.target.checked }))
                                    }
                                    className={styles.monthlyCheckbox}
                                />
                                <span>{t('modal.isMonthly')}</span>
                            </label>
                            {formData.isMonthly && (
                                <p className={styles.monthlyHint}>{t('modal.isMonthlyHint')}</p>
                            )}
                        </div>

                        <div className={styles.formGroup}>
                            <label htmlFor="expense-date">
                                {t('modal.date')} <span className={styles.required}>*</span>
                            </label>
                            <input
                                type="date"
                                id="expense-date"
                                min={ENTRY_DATE_MIN}
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

                        {subLevel === 'employee' ? (
                            <div className={styles.formGroup}>
                                <label htmlFor="expense-employee">{t('modal.employee')}</label>
                                <select
                                    id="expense-employee"
                                    value={String(formData.employeeId)}
                                    onChange={(e: ChangeEvent<HTMLSelectElement>) => handleInputChange('employeeId', e.target.value)}
                                    className={styles.formInput}
                                >
                                    <option value="">{t('modal.selectEmployee')}</option>
                                    {employees.map(emp => (
                                        <option key={emp.id} value={emp.id}>{emp.employee_name}</option>
                                    ))}
                                </select>
                            </div>
                        ) : subLevel === 'lab' ? (
                            <div className={styles.formGroup}>
                                <label htmlFor="expense-lab">{t('modal.lab')}</label>
                                <select
                                    id="expense-lab"
                                    value={String(formData.labId)}
                                    onChange={(e: ChangeEvent<HTMLSelectElement>) => handleInputChange('labId', e.target.value)}
                                    onContextMenu={labLookup.onContextMenu}
                                    title={t('modal.editLabsHint')}
                                    className={styles.formInput}
                                >
                                    <option value="">{t('modal.selectLab')}</option>
                                    {labs.map(lab => (
                                        <option key={lab.id} value={lab.id}>{lab.name}</option>
                                    ))}
                                </select>
                            </div>
                        ) : (
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
                        )}

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
                            onClick={dismiss}
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
            </>)}
        </Modal>
        {labLookup.overlay}
        </>
    );
}
