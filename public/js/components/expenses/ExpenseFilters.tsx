/**
 * ExpenseFilters Component
 * Provides filtering interface for expenses with date range, category, and currency filters
 */
import type { ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useCategories, useSubcategories } from '../../hooks/useExpenses';
import { useLocalizedName } from '../../hooks/useLocalizedName';
import type { ExpenseFilters as ExpenseFiltersType } from '../../hooks/useExpenses';
import styles from '../../routes/Expenses.module.css';

// Re-export for convenience
export type { ExpenseFilters as ExpenseFiltersState } from '../../hooks/useExpenses';

interface ExpenseFiltersProps {
    filters: ExpenseFiltersType;
    onFilterChange: (changes: Partial<ExpenseFiltersType>) => void;
    onApply: () => void;
    onReset: () => void;
}

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

export default function ExpenseFilters({ filters, onFilterChange, onApply, onReset }: ExpenseFiltersProps) {
    const { t } = useTranslation('expenses');
    const localizedName = useLocalizedName();
    const { categories } = useCategories() as { categories: Category[] };
    const { subcategories } = useSubcategories(filters.categoryId) as { subcategories: Subcategory[] };

    // No need to set default dates here - parent component handles initialization

    const handleInputChange = (field: keyof ExpenseFiltersType, value: string) => {
        onFilterChange({ [field]: value });
    };

    const handleCategoryChange = (value: string) => {
        onFilterChange({
            categoryId: value,
            subcategoryId: undefined // Reset subcategory when category changes
        });
    };

    return (
        <div className={styles.modernFilterCard}>
            <div className={styles.filterCardHeader}>
                <div className={styles.filterHeaderContent}>
                    <i className="fas fa-filter"></i>
                    <h3>{t('filters.title')}</h3>
                </div>
                <button
                    type="button"
                    className={styles.btnResetInline}
                    onClick={onReset}
                    title={t('filters.reset')}
                >
                    <i className="fas fa-redo"></i>
                </button>
            </div>

            <div className={styles.modernFilterGrid}>
                <div className={styles.modernFilterGroup}>
                    <label htmlFor="filter-start-date">
                        <i className="fas fa-calendar-alt"></i>
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
                        <i className="fas fa-calendar-alt"></i>
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
                        <i className="fas fa-folder"></i>
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
                        <i className={`fas fa-chevron-down ${styles.selectIcon}`}></i>
                    </div>
                </div>

                <div className={styles.modernFilterGroup}>
                    <label htmlFor="filter-subcategory">
                        <i className="fas fa-tag"></i>
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
                        <i className={`fas fa-chevron-down ${styles.selectIcon}`}></i>
                    </div>
                </div>

                <div className={styles.modernFilterGroup}>
                    <label htmlFor="filter-currency">
                        <i className="fas fa-dollar-sign"></i>
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
                        <i className={`fas fa-chevron-down ${styles.selectIcon}`}></i>
                    </div>
                </div>

                <div className={styles.modernFilterGroup}>
                    <label htmlFor="filter-type">
                        <i className="fas fa-tag"></i>
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
                        <i className={`fas fa-chevron-down ${styles.selectIcon}`}></i>
                    </div>
                </div>

                <div className={styles.modernFilterActions}>
                    <button
                        type="button"
                        className={`${styles.btnModern} ${styles.btnModernPrimary}`}
                        onClick={onApply}
                    >
                        <i className="fas fa-check"></i>
                        {t('filters.apply')}
                    </button>
                </div>
            </div>
        </div>
    );
}
