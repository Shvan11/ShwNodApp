import { useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { StandItem } from '../../hooks/useStand';
import { formatNumber, formatLocaleDate } from '../../utils/formatters';
import { isExpired, localToday } from '../../utils/expiryDate';
import { standItemsQuery } from '@/query/queries';
import styles from './POSItemSearch.module.css';

interface POSItemSearchProps {
  onSelect: (item: StandItem) => void;
}

/**
 * POSItemSearch Component
 *
 * Typeahead search box that queries the stand items API.
 * Displays matching items in a dropdown with name, price, stock and expiry.
 * Debounces input by 300ms to avoid excessive API calls.
 *
 * Keyboard: the `aria-activedescendant` combobox pattern (as `PatientSearchCombobox`)
 * — focus stays in the box, ArrowUp/Down move the highlight, Enter picks it,
 * Escape closes. The options used to be tab stops with no arrow keys (FE-F19-15).
 */
export default function POSItemSearch({ onSelect }: POSItemSearchProps) {
  const [searchText, setSearchText] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');
  // The dropdown is dismissible (outside click / Escape / select); track that
  // separately so a manual close doesn't reopen on every re-render.
  const [dismissed, setDismissed] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const listboxId = useId();

  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // React Query owns the fetch + out-of-order handling (only the latest key's
  // result is surfaced). Min-length gate (2) lives in `enabled`.
  const enabled = debouncedTerm.length >= 2;
  const { data, isFetching, isSuccess, dataUpdatedAt } = useQuery({
    ...standItemsQuery({ search: debouncedTerm }),
    enabled,
  });

  const results = data ?? [];
  const showDropdown = !dismissed && isSuccess && results.length > 0;
  // Expiry is judged on the day the results were read (no clock read during render).
  const today = localToday(dataUpdatedAt);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setDismissed(true);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  useEffect(() => {
    if (highlight >= 0) {
      document.getElementById(`${listboxId}-opt-${highlight}`)?.scrollIntoView({ block: 'nearest' });
    }
  }, [highlight, listboxId]);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchText(value);
    setDismissed(false);
    setHighlight(-1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedTerm(value), 300);
  };

  const handleSelect = (item: StandItem) => {
    onSelect(item);
    setSearchText('');
    setDebouncedTerm('');
    setDismissed(true);
    setHighlight(-1);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        if (results.length === 0) return;
        e.preventDefault();
        setDismissed(false);
        setHighlight((h) => (showDropdown ? (h + 1) % results.length : 0));
        break;
      case 'ArrowUp':
        if (results.length === 0) return;
        e.preventDefault();
        setDismissed(false);
        setHighlight((h) => (showDropdown && h > 0 ? h - 1 : results.length - 1));
        break;
      case 'Enter':
        if (showDropdown && highlight >= 0 && results[highlight]) {
          e.preventDefault();
          handleSelect(results[highlight]);
        }
        break;
      case 'Escape':
        if (showDropdown) {
          e.preventDefault();
          e.stopPropagation();
          setDismissed(true);
          setHighlight(-1);
        }
        break;
    }
  };

  return (
    <div className={styles.container} ref={containerRef}>
      <div className={styles.inputWrapper}>
        <i className={`fas fa-search ${styles.searchIcon}`} aria-hidden="true" />
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
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={showDropdown && highlight >= 0 ? `${listboxId}-opt-${highlight}` : undefined}
          role="combobox"
        />
        {isFetching && <i className={`fas fa-spinner fa-spin ${styles.spinner}`} aria-hidden="true" />}
      </div>

      {showDropdown && (
        <ul id={listboxId} className={styles.dropdown} role="listbox">
          {results.map((item, i) => {
            const expired = isExpired(item.expiry_date, today);
            return (
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events -- aria-activedescendant combobox: the input's onKeyDown drives the options, which are deliberately not focusable
              <li
                key={item.item_id}
                id={`${listboxId}-opt-${i}`}
                className={`${styles.dropdownItem} ${i === highlight ? styles.dropdownItemActive : ''}`}
                role="option"
                aria-selected={i === highlight}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => handleSelect(item)}
              >
                <div className={styles.itemInfo}>
                  <span className={styles.itemName}>{item.item_name}</span>
                  {item.category_name && <span className={styles.itemCategory}>{item.category_name}</span>}
                </div>
                <div className={styles.itemMeta}>
                  <span className={styles.itemPrice}>{formatNumber(item.sell_price)} IQD</span>
                  <span className={item.current_stock > 0 ? styles.itemStockAvailable : styles.itemStockOut}>
                    {item.current_stock > 0 ? `${item.current_stock} in stock` : 'Out of stock'}
                  </span>
                  {expired && (
                    <span className={styles.itemExpired}>
                      Expired {formatLocaleDate(item.expiry_date)}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
