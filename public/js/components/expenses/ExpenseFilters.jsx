/**
 * ExpenseFilters Component
 * Provides filtering interface for expenses with date range, category, and currency filters
 */
import React, { useEffect } from 'react';
import { useCategories, useSubcategories } from '../../hooks/useExpenses.js';

export default function ExpenseFilters({ filters, onFilterChange, onApply, onReset }) {
    const { categories } = useCategories();
    const { subcategories } = useSubcategories(filters.categoryId);

    // Set default date range to current month on mount
    useEffect(() => {
        const now = new Date();
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

        onFilterChange({
            startDate: formatDateString(firstDay),
            endDate: formatDateString(lastDay)
        });
    }, []);

    const handleInputChange = (field, value) => {
        onFilterChange({ [field]: value });
    };

    const handleCategoryChange = (value) => {
        onFilterChange({
            categoryId: value,
            subcategoryId: null // Reset subcategory when category changes
        });
    };

    const formatDateString = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    return (
        <div className="patient-filter-box">
            <div className="filter-row">
                <div className="filter-group">
                    <label htmlFor="filter-start-date">Start Date</label>
                    <input
                        type="date"
                        id="filter-start-date"
                        value={filters.startDate || ''}
                        onChange={(e) => handleInputChange('startDate', e.target.value)}
                    />
                </div>

                <div className="filter-group">
                    <label htmlFor="filter-end-date">End Date</label>
                    <input
                        type="date"
                        id="filter-end-date"
                        value={filters.endDate || ''}
                        onChange={(e) => handleInputChange('endDate', e.target.value)}
                    />
                </div>

                <div className="filter-group">
                    <label htmlFor="filter-category">Category</label>
                    <select
                        id="filter-category"
                        value={filters.categoryId || ''}
                        onChange={(e) => handleCategoryChange(e.target.value)}
                    >
                        <option value="">All Categories</option>
                        {categories.map(cat => (
                            <option key={cat.CategoryID} value={cat.CategoryID}>
                                {cat.CategoryName}
                            </option>
                        ))}
                    </select>
                </div>

                <div className="filter-group">
                    <label htmlFor="filter-subcategory">Subcategory</label>
                    <select
                        id="filter-subcategory"
                        value={filters.subcategoryId || ''}
                        onChange={(e) => handleInputChange('subcategoryId', e.target.value)}
                        disabled={!filters.categoryId}
                    >
                        <option value="">All Subcategories</option>
                        {subcategories.map(sub => (
                            <option key={sub.SubcategoryID} value={sub.SubcategoryID}>
                                {sub.SubcategoryName}
                            </option>
                        ))}
                    </select>
                </div>

                <div className="filter-group">
                    <label htmlFor="filter-currency">Currency</label>
                    <select
                        id="filter-currency"
                        value={filters.currency || ''}
                        onChange={(e) => handleInputChange('currency', e.target.value)}
                    >
                        <option value="">All Currencies</option>
                        <option value="IQD">IQD</option>
                        <option value="USD">USD</option>
                    </select>
                </div>
            </div>

            <div className="action-buttons">
                <button
                    type="button"
                    className="btn-action btn-secondary"
                    onClick={onReset}
                >
                    Reset Filters
                </button>
                <button
                    type="button"
                    className="btn-action btn-primary"
                    onClick={onApply}
                >
                    Apply Filters
                </button>
            </div>
        </div>
    );
}
