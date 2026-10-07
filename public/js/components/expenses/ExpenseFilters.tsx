/**
 * ExpenseFilters Component
 * Provides filtering interface for expenses with date range, category, and currency filters
 */
import type { ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useCategories, useSubcategories, useLabs, useAllEmployees } from '../../hooks/useExpenses';
import { useLocalizedName } from '../../hooks/useLocalizedName';
import type { ExpenseFilters as ExpenseFiltersType } from '../../hooks/useExpenses';
import { EMPLOYEE_EXPENSE_CATEGORY, LAB_EXPENSE_CATEGORY } from '../../config/expenseCategories';
import styles from '../../routes/Expenses.module.css';

// Re-export for convenience
export type { ExpenseFilters as ExpenseFiltersState } from '../../hooks/useExpenses';

interface ExpenseFiltersProps {
    filters: ExpenseFiltersType;
    onFilterChange: (changes: Partial<ExpenseFiltersType>) => void;
    onApply: () => void;
    onReset: () => void;
}

export default function ExpenseFilters({ filters, onFilterChange, onApply, onReset }: ExpenseFiltersProps) {
    const { t } = useTranslation('expenses');
    const localizedName = useLocalizedName();
    const { categories } = useCategories();
    const { subcategories } = useSubcategories(filters.categoryId);
    const { labs } = useLabs();
    // Quit employees too: their salary history must stay filterable (FE-F8-12).
    const { employees } = useAllEmployees();

    // The Lab / Employees categories filter by entity instead of subcategory.
    const catNum = Number(filters.categoryId);
    const subLevel: 'employee' | 'lab' | 'subcategory' =
        catNum === EMPLOYEE_EXPENSE_CATEGORY ? 'employee'
        : catNum === LAB_EXPENSE_CATEGORY ? 'lab'
        : 'subcategory';

    // No need to set default dates here - parent component handles initialization

    const handleInputChange = (field: keyof ExpenseFiltersType, value: string) => {
        onFilterChange({ [field]: value });
    };

    const handleCategoryChange = (value: string) => {
        onFilterChange({
            categoryId: value,
            // Reset every sub-level filter when the category changes.
            subcategoryId: undefined,
            labId: undefined,
            employeeId: undefined,
        });
    };

    return (
        <div className={styles.modernFilterCard}>
            <div className={styles.filterCardHeader}>
                <div className={styles.filterHeaderContent}>
                    <i className="fas fa-filter" aria-hidden="true"></i>
                    <h3>{t('filters.title')}</h3>
                </div>
                <button
                    type="button"
                    className={styles.btnResetInline}
                    onClick={onReset}
                    title={t('filters.reset')}
                >
                    <i className="fas fa-redo" aria-hidden="true"></i>
                </button>
            </div>

            <div className={styles.modernFilterGrid}>
                <div className={styles.modernFilterGroup}>
                    <label htmlFor="filter-start-date">
                        <i className="fas fa-calendar-alt" aria-hidden="true"></i>
                        {t('filters.startDate')}
                    </label>
                    <input
                        type="date"
                        id="filter-start-date"
                        className={styles.modernInput}
                        value={filters.startDate || ''}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleInputChange('startDate', e.target.value)}
                    />
                </div>

                <div className={styles.modernFilterGroup}>
                    <label htmlFor="filter-end-date">
                        <i className="fas fa-calendar-alt" aria-hidden="true"></i>
                        {t('filters.endDate')}
                    </label>
                    <input
                        type="date"
                        id="filter-end-date"
                        className={styles.modernInput}
                        value={filters.endDate || ''}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleInputChange('endDate', e.target.value)}
                    />
                </div>

                <div className={styles.modernFilterGroup}>
                    <label htmlFor="filter-category">
                        <i className="fas fa-folder" aria-hidden="true"></i>
                        {t('filters.category')}
                    </label>
                    <div className={styles.selectWrapper}>
                        <select
                            id="filter-category"
                            className={styles.modernSelect}
                            value={String(filters.categoryId || '')}
                            onChange={(e: ChangeEvent<HTMLSelectElement>) => handleCategoryChange(e.target.value)}
                        >
                            <option value="">{t('filters.allCategories')}</option>
                            {categories.map(cat => (
                                <option key={cat.category_id} value={cat.category_id}>
                                    {localizedName(cat.category_name, cat.category_name_ar)}
                                </option>
                            ))}
                        </select>
                        <i className={`fas fa-chevron-down ${styles.selectIcon}`} aria-hidden="true"></i>
                    </div>
                </div>

                {subLevel === 'employee' ? (
                    <div className={styles.modernFilterGroup}>
                        <label htmlFor="filter-employee">
                            <i className="fas fa-user" aria-hidden="true"></i>
                            {t('filters.employee')}
                        </label>
                        <div className={styles.selectWrapper}>
                            <select
                                id="filter-employee"
                                className={styles.modernSelect}
                                value={String(filters.employeeId || '')}
                                onChange={(e: ChangeEvent<HTMLSelectElement>) => handleInputChange('employeeId', e.target.value)}
                            >
                                <option value="">{t('filters.allEmployees')}</option>
                                {employees.map(emp => (
                                    <option key={emp.id} value={emp.id}>
                                        {emp.is_active ? emp.employee_name : t('filters.formerEmployee', { name: emp.employee_name })}
                                    </option>
                                ))}
                            </select>
                            <i className={`fas fa-chevron-down ${styles.selectIcon}`} aria-hidden="true"></i>
                        </div>
                    </div>
                ) : subLevel === 'lab' ? (
                    <div className={styles.modernFilterGroup}>
                        <label htmlFor="filter-lab">
                            <i className="fas fa-flask" aria-hidden="true"></i>
                            {t('filters.lab')}
                        </label>
                        <div className={styles.selectWrapper}>
                            <select
                                id="filter-lab"
                                className={styles.modernSelect}
                                value={String(filters.labId || '')}
                                onChange={(e: ChangeEvent<HTMLSelectElement>) => handleInputChange('labId', e.target.value)}
                            >
                                <option value="">{t('filters.allLabs')}</option>
                                {labs.map(lab => (
                                    <option key={lab.id} value={lab.id}>{lab.name}</option>
                                ))}
                            </select>
                            <i className={`fas fa-chevron-down ${styles.selectIcon}`} aria-hidden="true"></i>
                        </div>
                    </div>
                ) : (
                    <div className={styles.modernFilterGroup}>
                        <label htmlFor="filter-subcategory">
                            <i className="fas fa-tag" aria-hidden="true"></i>
                            {t('filters.subcategory')}
                        </label>
                        <div className={styles.selectWrapper}>
                            <select
                                id="filter-subcategory"
                                className={styles.modernSelect}
                                value={String(filters.subcategoryId || '')}
                                onChange={(e: ChangeEvent<HTMLSelectElement>) => handleInputChange('subcategoryId', e.target.value)}
                                disabled={!filters.categoryId}
                            >
                                <option value="">{t('filters.allSubcategories')}</option>
                                {subcategories.map(sub => (
                                    <option key={sub.subcategory_id} value={sub.subcategory_id}>
                                        {localizedName(sub.subcategory_name, sub.subcategory_name_ar)}
                                    </option>
                                ))}
                            </select>
                            <i className={`fas fa-chevron-down ${styles.selectIcon}`} aria-hidden="true"></i>
                        </div>
                    </div>
                )}

                <div className={styles.modernFilterGroup}>
                    <label htmlFor="filter-currency">
                        <i className="fas fa-dollar-sign" aria-hidden="true"></i>
                        {t('filters.currency')}
                    </label>
                    <div className={styles.selectWrapper}>
                        <select
                            id="filter-currency"
                            className={styles.modernSelect}
                            value={filters.currency || ''}
                            onChange={(e: ChangeEvent<HTMLSelectElement>) => handleInputChange('currency', e.target.value)}
                        >
                            <option value="">{t('filters.allCurrencies')}</option>
                            <option value="IQD">IQD</option>
                            <option value="USD">USD</option>
                        </select>
                        <i className={`fas fa-chevron-down ${styles.selectIcon}`} aria-hidden="true"></i>
                    </div>
                </div>

                <div className={styles.modernFilterGroup}>
                    <label htmlFor="filter-type">
                        <i className="fas fa-tag" aria-hidden="true"></i>
                        {t('filters.type')}
                    </label>
                    <div className={styles.selectWrapper}>
                        <select
                            id="filter-type"
                            className={styles.modernSelect}
                            value={filters.isMonthly || ''}
                            onChange={(e: ChangeEvent<HTMLSelectElement>) => handleInputChange('isMonthly', e.target.value)}
                        >
                            <option value="">{t('filters.allTypes')}</option>
                            {/* eslint-disable-next-line i18next/no-literal-string */}
                            <option value="false">{t('filters.dailyOnly')}</option>
                            {/* eslint-disable-next-line i18next/no-literal-string */}
                            <option value="true">{t('filters.monthlyOnly')}</option>
                        </select>
                        <i className={`fas fa-chevron-down ${styles.selectIcon}`} aria-hidden="true"></i>
                    </div>
                </div>

                <div className={styles.modernFilterActions}>
                    <button
                        type="button"
                        className={`${styles.btnModern} ${styles.btnModernPrimary}`}
                        onClick={onApply}
                    >
                        <i className="fas fa-check" aria-hidden="true"></i>
                        {t('filters.apply')}
                    </button>
                </div>
            </div>
        </div>
    );
}
