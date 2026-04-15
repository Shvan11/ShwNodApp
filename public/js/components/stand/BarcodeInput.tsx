import React, { useRef, useEffect, useState, useCallback } from 'react';
import styles from './BarcodeInput.module.css';

interface BarcodeInputProps {
  onScan: (barcode: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * BarcodeInput Component
 *
 * Captures barcode scanner output (USB scanners emulate keyboard input
 * and send Enter at the end). Also supports manual typing.
 * Autofocuses on mount and clears after each scan.
 */
const BarcodeInput: React.FC<BarcodeInputProps> = ({
  onScan,
  placeholder = 'Scan barcode or type manually...',
  disabled = false,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');

  useEffect(() => {
    if (!disabled && inputRef.current) {
      inputRef.current.focus();
    }
  }, [disabled]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const trimmed = value.trim();
        if (trimmed) {
          onScan(trimmed);
          setValue('');
        }
      }
    },
    [value, onScan]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setValue(e.target.value);
    },
    []
  );

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      disabled={disabled}
      autoComplete="off"
      aria-label="Barcode scanner input"
      className={styles.input}
    />
  );
};

export default React.memo(BarcodeInput);
