/**
 * ItemFilters Component
 * Provides filtering interface for stand items with search, category, stock status, and inactive toggle
 */
import type { ChangeEvent } from 'react';
import type { StandItemFilters } from '../../hooks/useStand';
import { useStandCategories } from '../../hooks/useStand';
import styles from './ItemFilters.module.css';

interface ItemFiltersProps {
  filters: StandItemFilters;
  onFilterChange: (updates: Partial<StandItemFilters>) => void;
  onApply: () => void;
  onReset: () => void;
}

export default function ItemFilters({ filters, onFilterChange, onApply, onReset }: ItemFiltersProps) {
  const { categories } = useStandCategories();

  const handleSearchChange = (e: ChangeEvent<HTMLInputElement>) => {
    onFilterChange({ search: e.target.value });
  };

  const handleCategoryChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    onFilterChange({ categoryId: value ? Number(value) : undefined });
  };

  const handleStockStatusChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value as StandItemFilters['stockStatus'] | '';
    onFilterChange({ stockStatus: value || undefined });
  };

  const handleInactiveToggle = (e: ChangeEvent<HTMLInputElement>) => {
    onFilterChange({ includeInactive: e.target.checked });
  };

  return (
    <div className={styles.filterCard}>
      <div className={styles.filterHeader}>
        <div className={styles.filterHeaderContent}>
          <i className="fas fa-filter"></i>
          <h3>Filter Items</h3>
        </div>
        <button
          type="button"
          className={styles.btnResetInline}
          onClick={onReset}
          title="Reset all filters"
        >
          <i className="fas fa-redo"></i>
        </button>
      </div>

      <div className={styles.filterGrid}>
        <div className={styles.filterGroup}>
          <label htmlFor="filter-search">
            <i className="fas fa-search"></i>
            Search
          </label>
          <input
            type="text"
            id="filter-search"
            className={styles.filterInput}
            value={filters.search || ''}
            onChange={handleSearchChange}
            placeholder="Name, SKU, or barcode..."
          />
        </div>

        <div className={styles.filterGroup}>
          <label htmlFor="filter-category">
            <i className="fas fa-folder"></i>
            Category
          </label>
          <div className={styles.selectWrapper}>
            <select
              id="filter-category"
              className={styles.filterSelect}
              value={filters.categoryId ?? ''}
              onChange={handleCategoryChange}
            >
              <option value="">All Categories</option>
              {categories.map((cat) => (
                <option key={cat.CategoryID} value={cat.CategoryID}>
                  {cat.CategoryName}
                </option>
              ))}
            </select>
            <i className={`fas fa-chevron-down ${styles.selectIcon}`}></i>
          </div>
        </div>

        <div className={styles.filterGroup}>
          <label htmlFor="filter-stock-status">
            <i className="fas fa-boxes"></i>
            Stock Status
          </label>
          <div className={styles.selectWrapper}>
            <select
              id="filter-stock-status"
              className={styles.filterSelect}
              value={filters.stockStatus || ''}
              onChange={handleStockStatusChange}
            >
              <option value="">All</option>
              <option value="in-stock">In Stock</option>
              <option value="low-stock">Low Stock</option>
              <option value="out-of-stock">Out of Stock</option>
            </select>
            <i className={`fas fa-chevron-down ${styles.selectIcon}`}></i>
          </div>
        </div>

        <div className={styles.filterGroup}>
          <label>
            <i className="fas fa-eye"></i>
            Visibility
          </label>
          <div className={styles.checkboxGroup}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                className={styles.checkboxInput}
                checked={filters.includeInactive || false}
                onChange={handleInactiveToggle}
              />
              Show inactive items
            </label>
          </div>
        </div>

        <div className={styles.filterActions}>
          <button
            type="button"
            className={styles.btnApply}
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
