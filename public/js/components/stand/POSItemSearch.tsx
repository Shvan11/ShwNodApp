import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { StandItem } from '../../hooks/useStand';
import { formatNumber } from '../../utils/formatters';
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
  const [results, setResults] = useState<StandItem[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Monotonic request id — ignore responses that arrive out of order so a
  // slow earlier query can't clobber the results of the latest one.
  const requestSeqRef = useRef(0);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchItems = useCallback(async (query: string) => {
    if (query.length < 2) {
      setResults([]);
      setShowDropdown(false);
      return;
    }

    const seq = ++requestSeqRef.current;
    setLoading(true);
    try {
      const response = await fetch(
        `/api/stand/items?search=${encodeURIComponent(query)}`
      );
      if (!response.ok) {
        throw new Error('Search failed');
      }
      const data = (await response.json()) as StandItem[];
      if (seq !== requestSeqRef.current) return; // a newer query superseded this one
      setResults(data);
      setShowDropdown(data.length > 0);
    } catch {
      if (seq !== requestSeqRef.current) return;
      setResults([]);
      setShowDropdown(false);
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setSearchText(value);

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      debounceRef.current = setTimeout(() => {
        fetchItems(value);
      }, 300);
    },
    [fetchItems]
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
      setResults([]);
      setShowDropdown(false);
    },
    [onSelect]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        setShowDropdown(false);
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
            if (results.length > 0) setShowDropdown(true);
          }}
          placeholder="Search items by name..."
          autoComplete="off"
          aria-label="Search stand items"
          aria-expanded={showDropdown}
          role="combobox"
        />
        {loading && (
          <i className={`fas fa-spinner fa-spin ${styles.spinner}`} />
        )}
      </div>

      {showDropdown && (
        <ul className={styles.dropdown} role="listbox">
          {results.map((item) => (
            <li
              key={item.item_id}
              className={styles.dropdownItem}
              role="option"
              aria-selected={false}
              onClick={() => handleSelect(item)}
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
