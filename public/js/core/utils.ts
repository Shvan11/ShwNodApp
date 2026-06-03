/**
 * General utility functions
 */

/**
 * Format a date to DD-MM-YYYY
 * @param date - Date to format
 * @returns Formatted date
 */
export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '';

  // A bare YYYY-MM-DD has no time/zone. Rearrange the parts directly instead of going
  // through `new Date(str)` (which parses it as UTC midnight) — that way a browser in a
  // non-clinic timezone (negative UTC offset) can't roll the calendar date back a day.
  if (typeof date === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  }

  const d = date instanceof Date ? date : new Date(date);

  if (isNaN(d.getTime())) return '';

  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();

  return `${day}-${month}-${year}`;
}

/**
 * Format a date to a LOCAL-wall-clock YYYY-MM-DD string (ISO 8601 calendar date).
 *
 * Uses local getters, NOT `toISOString()` — the latter returns the UTC date, which in
 * a positive-offset timezone (this clinic is UTC+3) yields YESTERDAY between local
 * 00:00 and 03:00. Use this for "today" defaults and any date-only value.
 *
 * @param date - Date object, parseable string, or null/undefined (default: now)
 * @returns `YYYY-MM-DD`, or `''` for null/invalid input
 */
export function formatISODate(date: string | Date | null | undefined = new Date()): string {
  if (!date) return '';

  // Already a bare YYYY-MM-DD — return as-is (tz-neutral); avoids the UTC-midnight
  // round-trip that would shift it in a non-clinic (negative-offset) browser.
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
    return date.trim();
  }

  const d = date instanceof Date ? date : new Date(date);

  if (isNaN(d.getTime())) return '';

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Debounce a function
 * @param func - Function to debounce
 * @param wait - Wait time in ms
 * @param immediate - Whether to call immediately
 * @returns Debounced function
 */
export function debounce<T extends (...args: Parameters<T>) => ReturnType<T>>(
  func: T,
  wait: number,
  immediate = false
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return function executedFunction(this: unknown, ...args: Parameters<T>): void {
    const context = this;

    const later = function (): void {
      timeout = null;
      if (!immediate) func.apply(context, args);
    };

    const callNow = immediate && !timeout;

    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(later, wait);

    if (callNow) func.apply(context, args);
  };
}

/**
 * Throttle a function
 * @param func - Function to throttle
 * @param limit - Throttle limit in ms
 * @returns Throttled function
 */
export function throttle<T extends (...args: Parameters<T>) => ReturnType<T>>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;

  return function executedFunction(this: unknown, ...args: Parameters<T>): void {
    const context = this;

    if (!inThrottle) {
      func.apply(context, args);
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
      }, limit);
    }
  };
}

/**
 * Generate a random ID
 * @param length - ID length
 * @returns Random ID
 */
export function generateId(length = 8): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';

  for (let i = 0; i < length; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return id;
}

/**
 * Deep clone an object
 * @param obj - Object to clone
 * @returns Cloned object
 */
export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (obj instanceof Date) {
    return new Date(obj.getTime()) as unknown as T;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => deepClone(item)) as unknown as T;
  }

  const clone = {} as Record<string, unknown>;

  Object.keys(obj as object).forEach((key) => {
    clone[key] = deepClone((obj as Record<string, unknown>)[key]);
  });

  return clone as T;
}

/**
 * Format a phone number to standard format
 * @param phoneNumber - Raw phone number
 * @param countryCode - Country code
 * @returns Formatted phone number
 */
export function formatPhoneNumber(phoneNumber: string | null | undefined, countryCode = '964'): string {
  if (!phoneNumber) return '';

  // Remove non-digit characters
  const digits = phoneNumber.replace(/\D/g, '');

  // Handle different formats
  if (digits.startsWith('00' + countryCode)) {
    // Remove leading 00 and country code
    return countryCode + digits.substring(countryCode.length + 2);
  } else if (digits.startsWith('+' + countryCode)) {
    // Remove leading + and country code
    return countryCode + digits.substring(countryCode.length + 1);
  } else if (digits.startsWith('0')) {
    // Replace leading 0 with country code
    return countryCode + digits.substring(1);
  } else if (!digits.startsWith(countryCode)) {
    // Add country code if missing
    return countryCode + digits;
  }

  return digits;
}

/**
 * Copy text to clipboard with fallback support
 * Tries modern Clipboard API first (works on HTTPS/localhost),
 * then falls back to document.execCommand for HTTP contexts
 *
 * @param text - Text to copy to clipboard
 * @returns True if successful, false otherwise
 *
 * @example
 * const success = await copyToClipboard('Hello World');
 * if (success) {
 *   console.log('Copied successfully');
 * } else {
 *   console.log('Copy failed');
 * }
 */
export async function copyToClipboard(text: string | null | undefined): Promise<boolean> {
  if (!text) {
    console.warn('copyToClipboard: No text provided');
    return false;
  }

  try {
    // Try modern Clipboard API first (HTTPS/localhost only)
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }

    // Fallback for HTTP contexts using execCommand
    const textarea = document.createElement('textarea');
    textarea.value = text;

    // Make textarea invisible and non-interactive
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '-9999px';
    textarea.style.opacity = '0';
    textarea.setAttribute('readonly', '');

    document.body.appendChild(textarea);

    // Select and copy
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);

    const successful = document.execCommand('copy');

    // Clean up
    document.body.removeChild(textarea);

    return successful;
  } catch (error) {
    console.error('Failed to copy to clipboard:', error);
    return false;
  }
}

export default {
  formatPhoneNumber,
  formatDate,
  formatISODate,
  debounce,
  throttle,
  generateId,
  deepClone,
  copyToClipboard,
};
