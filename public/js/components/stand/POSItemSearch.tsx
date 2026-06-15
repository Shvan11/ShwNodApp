import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { StandItem } from '../../hooks/useStand';
import { formatNumber } from '../../utils/formatters';
import { standItemsQuery } from '@/query/queries';
import styles from './POSItemSearch.module.css';

interface POSItemSearchProps {
  onSelect: (item: StandItem) => void;
}

/**
 * POSItemSearch Component
 *
 * Typeahead search box that queries the stand items API.
 * Displays matching items in a dropdown with name, price, and stock.
 * Debounces input by 300ms to avoid excessive API calls.
 */
const POSItemSearch: React.FC<POSItemSearchProps> = ({ onSelect }) => {
  const [searchText, setSearchText] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');
  // The dropdown is dismissible (outside click / Escape / select); track that
  // separately so a manual close doesn't reopen on every re-render.
  const [dismissed, setDismissed] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // React Query owns the fetch + out-of-order handling (only the latest key's
  // result is surfaced). Min-length gate (2) lives in `enabled`.
  const enabled = debouncedTerm.length >= 2;
  const { data, isFetching, isSuccess } = useQuery({
    ...standItemsQuery({ search: debouncedTerm }),
    enabled,
  });

  const results = (data as StandItem[] | undefined) ?? [];
  const loading = isFetching;
  const showDropdown = !dismissed && isSuccess && results.length > 0;

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setDismissed(true);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setSearchText(value);
      setDismissed(false);

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      debounceRef.current = setTimeout(() => {
        setDebouncedTerm(value);
      }, 300);
    },
    []
  );

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const handleSelect = useCallback(
    (item: StandItem) => {
      onSelect(item);
      setSearchText('');
      setDebouncedTerm('');
      setDismissed(true);
    },
    [onSelect]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        setDismissed(true);
      }
    },
    []
  );

  return (
    <div className={styles.container} ref={containerRef}>
      <div className={styles.inputWrapper}>
        <i className={`fas fa-search ${styles.searchIcon}`} />
        <input
          type="text"
          className={styles.searchInput}
          value={searchText}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (results.length > 0) setDismissed(false);
          }}
          placeholder="Search items by name..."
          autoComplete="off"
          aria-label="Search stand items"
          aria-expanded={showDropdown}
          aria-controls="pos-item-search-listbox"
          role="combobox"
        />
        {loading && (
          <i className={`fas fa-spinner fa-spin ${styles.spinner}`} />
        )}
      </div>

      {showDropdown && (
        <ul id="pos-item-search-listbox" className={styles.dropdown} role="listbox">
          {results.map((item) => (
            <li
              key={item.item_id}
              className={styles.dropdownItem}
              role="option"
              aria-selected={false}
              tabIndex={0}
              onClick={() => handleSelect(item)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelect(item); } }}
            >
              <div className={styles.itemInfo}>
                <span className={styles.itemName}>{item.item_name}</span>
                {item.category_name && (
                  <span className={styles.itemCategory}>
                    {item.category_name}
                  </span>
                )}
              </div>
              <div className={styles.itemMeta}>
                <span className={styles.itemPrice}>
                  {formatNumber(item.sell_price)} IQD
                </span>
                <span
                  className={
                    item.current_stock > 0
                      ? styles.itemStockAvailable
                      : styles.itemStockOut
                  }
                >
                  {item.current_stock > 0
                    ? `${item.current_stock} in stock`
                    : 'Out of stock'}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default React.memo(POSItemSearch);
