/**
 * ExpenseFilters Component
 * Provides filtering interface for expenses with date range, category, and currency filters
 */
import React from 'react';
import type { ChangeEvent } from 'react';
import { useCategories, useSubcategories } from '../../hooks/useExpenses';
import type { ExpenseFilters as ExpenseFiltersType } from '../../hooks/useExpenses';

// Re-export for convenience
export type { ExpenseFilters as ExpenseFiltersState } from '../../hooks/useExpenses';

interface ExpenseFiltersProps {
    filters: ExpenseFiltersType;
    onFilterChange: (changes: Partial<ExpenseFiltersType>) => void;
    onApply: () => void;
    onReset: () => void;
}

interface Category {
    CategoryID: number;
    CategoryName: string;
}

interface Subcategory {
    SubcategoryID: number;
    SubcategoryName: string;
}

export default function ExpenseFilters({ filters, onFilterChange, onApply, onReset }: ExpenseFiltersProps) {
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
        <div className="modern-filter-card">
            <div className="filter-card-header">
                <div className="filter-header-content">
                    <i className="fas fa-filter"></i>
                    <h3>Filter Expenses</h3>
                </div>
                <button
                    type="button"
                    className="btn-reset-inline"
                    onClick={onReset}
                    title="Reset all filters"
                >
                    <i className="fas fa-redo"></i>
                </button>
            </div>

            <div className="modern-filter-grid">
                <div className="modern-filter-group">
                    <label htmlFor="filter-start-date">
                        <i className="fas fa-calendar-alt"></i>
                        Start Date
                    </label>
                    <input
                        type="date"
                        id="filter-start-date"
                        className="modern-input"
                        value={filters.startDate || ''}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleInputChange('startDate', e.target.value)}
                    />
                </div>

                <div className="modern-filter-group">
                    <label htmlFor="filter-end-date">
                        <i className="fas fa-calendar-alt"></i>
                        End Date
                    </label>
                    <input
                        type="date"
                        id="filter-end-date"
                        className="modern-input"
                        value={filters.endDate || ''}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleInputChange('endDate', e.target.value)}
                    />
                </div>

                <div className="modern-filter-group">
                    <label htmlFor="filter-category">
                        <i className="fas fa-folder"></i>
                        Category
                    </label>
                    <div className="select-wrapper">
                        <select
                            id="filter-category"
                            className="modern-select"
                            value={String(filters.categoryId || '')}
                            onChange={(e: ChangeEvent<HTMLSelectElement>) => handleCategoryChange(e.target.value)}
                        >
                            <option value="">All Categories</option>
                            {categories.map(cat => (
                                <option key={cat.CategoryID} value={cat.CategoryID}>
                                    {cat.CategoryName}
                                </option>
                            ))}
                        </select>
                        <i className="fas fa-chevron-down select-icon"></i>
                    </div>
                </div>

                <div className="modern-filter-group">
                    <label htmlFor="filter-subcategory">
                        <i className="fas fa-tag"></i>
                        Subcategory
                    </label>
                    <div className="select-wrapper">
                        <select
                            id="filter-subcategory"
                            className="modern-select"
                            value={String(filters.subcategoryId || '')}
                            onChange={(e: ChangeEvent<HTMLSelectElement>) => handleInputChange('subcategoryId', e.target.value)}
                            disabled={!filters.categoryId}
                        >
                            <option value="">All Subcategories</option>
                            {subcategories.map(sub => (
                                <option key={sub.SubcategoryID} value={sub.SubcategoryID}>
                                    {sub.SubcategoryName}
                                </option>
                            ))}
                        </select>
                        <i className="fas fa-chevron-down select-icon"></i>
                    </div>
                </div>

                <div className="modern-filter-group">
                    <label htmlFor="filter-currency">
                        <i className="fas fa-dollar-sign"></i>
                        Currency
                    </label>
                    <div className="select-wrapper">
                        <select
                            id="filter-currency"
                            className="modern-select"
                            value={filters.currency || ''}
                            onChange={(e: ChangeEvent<HTMLSelectElement>) => handleInputChange('currency', e.target.value)}
                        >
                            <option value="">All Currencies</option>
                            <option value="IQD">IQD</option>
                            <option value="USD">USD</option>
                        </select>
                        <i className="fas fa-chevron-down select-icon"></i>
                    </div>
                </div>

                <div className="modern-filter-actions">
                    <button
                        type="button"
                        className="btn-modern btn-modern-primary"
                        onClick={onApply}
                    >
                        <i className="fas fa-check"></i>
                        Apply Filters
                    </button>
                </div>
            </div>
        </div>
    );
}
