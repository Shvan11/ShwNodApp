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

/**
 * Get or set the screen ID
 * @param newId - New screen ID to set (optional)
 * @returns Current screen ID
 */
export function screenId(newId?: string): string {
  const SCREEN_ID_KEY = 'screenId';

  // Set new ID if provided
  if (newId) {
    setItem(SCREEN_ID_KEY, newId);
    return newId;
  }

  // Get existing ID
  let existingId = getItem<string>(SCREEN_ID_KEY);

  if (!existingId) {
    // If no ID exists, prompt user to input screen ID
    const userInput = window.prompt('Which screen is this PC connected to?');
    existingId = userInput ? userInput.trim() : 'unknown';

    // Store in storage
    setItem(SCREEN_ID_KEY, existingId);
  }

  return existingId;
}

export default {
  getItem,
  setItem,
  removeItem,
  clear,
  screenId,
};
