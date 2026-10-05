import { useEffect, useState, type KeyboardEvent, type RefObject } from 'react';
import styles from './BarcodeInput.module.css';

interface BarcodeInputProps {
  onScan: (barcode: string) => void;
  /** The till refocuses this box after an add and after a sale, so the next scan lands here. */
  inputRef: RefObject<HTMLInputElement | null>;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * BarcodeInput Component
 *
 * Captures barcode scanner output (USB scanners emulate keyboard input
 * and send Enter at the end). Also supports manual typing.
 * Autofocuses on mount and clears after each scan. A scan made while the focus is
 * elsewhere on the till is caught by `useScannerCapture` (FE-F19-6).
 */
export default function BarcodeInput({
  onScan,
  inputRef,
  placeholder = 'Scan barcode or type manually...',
  disabled = false,
}: BarcodeInputProps) {
  const [value, setValue] = useState('');

  useEffect(() => {
    if (!disabled) inputRef.current?.focus();
  }, [disabled, inputRef]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = value.trim();
      if (trimmed) {
        onScan(trimmed);
        setValue('');
      }
    }
  };

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      disabled={disabled}
      autoComplete="off"
      aria-label="Barcode scanner input"
      className={styles.input}
    />
  );
}
