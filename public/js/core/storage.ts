/**
 * Storage utility - Provides methods for interacting with browser storage
 */

/**
 * Check if local storage is available
 * @returns Whether local storage is available
 */
function isLocalStorageAvailable(): boolean {
  try {
    const test = '__storage_test__';
    localStorage.setItem(test, test);
    localStorage.removeItem(test);
    return true;
  } catch {
    return false;
  }
}

/**
 * In-memory fallback storage when localStorage is not available
 */
const memoryStorage = new Map<string, unknown>();

/**
 * Get an item from storage
 * @param key - Storage key
 * @param defaultValue - Default value if key doesn't exist
 * @returns Stored value or default value
 */
export function getItem<T = unknown>(key: string, defaultValue: T | null = null): T | null {
  if (isLocalStorageAvailable()) {
    const value = localStorage.getItem(key);
    if (value === null) {
      return defaultValue;
    }

    try {
      // Try to parse JSON
      return JSON.parse(value) as T;
    } catch {
      // Return as string if not valid JSON
      return value as unknown as T;
    }
  } else {
    return memoryStorage.has(key) ? (memoryStorage.get(key) as T) : defaultValue;
  }
}

/**
 * Set an item in storage
 * @param key - Storage key
 * @param value - Value to store
 * @returns Success status
 */
export function setItem<T>(key: string, value: T): boolean {
  try {
    const valueToStore = typeof value === 'object' ? JSON.stringify(value) : String(value);

    if (isLocalStorageAvailable()) {
      localStorage.setItem(key, valueToStore);
    } else {
      memoryStorage.set(key, value);
    }

    return true;
  } catch (e) {
    console.error('Error storing data:', e);
    return false;
  }
}

/**
 * Remove an item from storage
 * @param key - Storage key
 * @returns Success status
 */
export function removeItem(key: string): boolean {
  try {
    if (isLocalStorageAvailable()) {
      localStorage.removeItem(key);
    } else {
      memoryStorage.delete(key);
    }

    return true;
  } catch (e) {
    console.error('Error removing data:', e);
    return false;
  }
}

/**
 * Clear all items from storage
 * @returns Success status
 */
export function clear(): boolean {
  try {
    if (isLocalStorageAvailable()) {
      localStorage.clear();
    } else {
      memoryStorage.clear();
    }

    return true;
  } catch (e) {
    console.error('Error clearing storage:', e);
    return false;
  }
}

const CHAIR_ID_KEY = 'chairId';

const CHAIR_ID_PATTERN = /^([1-9]|10)$/;

/**
 * Get the chair ID for this PC.
 *
 * Returns the stored value (string '1'..'10'), or `null` if unset. This is a
 * pure synchronous getter — no prompt. The chair ID is configured via the
 * Settings UI on chair PCs, and left unset on non-chair PCs (admin laptops, etc).
 */
export function chairId(): string | null {
  // getItem runs JSON.parse, so a stored "1" comes back as the number 1.
  // Coerce to string and validate against the 1–10 range.
  const stored = getItem<unknown>(CHAIR_ID_KEY);
  if (stored === null || stored === undefined || stored === '') return null;
  const str = String(stored);
  return CHAIR_ID_PATTERN.test(str) ? str : null;
}

/**
 * Set the chair ID for this PC. Pass an empty string or null to clear it.
 * Validates 1-10. Invalid values are rejected (returns false).
 */
export function setChairId(value: string | number | null | undefined): boolean {
  if (value === null || value === undefined || value === '') {
    return removeItem(CHAIR_ID_KEY);
  }
  const str = String(value).trim();
  if (!CHAIR_ID_PATTERN.test(str)) {
    return false;
  }
  return setItem(CHAIR_ID_KEY, str);
}

export default {
  getItem,
  setItem,
  removeItem,
  clear,
  chairId,
  setChairId,
};
