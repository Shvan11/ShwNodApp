// core/storage.js
/**
 * Storage utility - Provides methods for interacting with browser storage
 */

/**
 * Check if local storage is available
 * @returns {boolean} - Whether local storage is available
 * @private
 */
function isLocalStorageAvailable() {
    try {
      const test = '__storage_test__';
      localStorage.setItem(test, test);
      localStorage.removeItem(test);
      return true;
    } catch (e) {
      return false;
    }
  }
  
  /**
   * In-memory fallback storage when localStorage is not available
   * @private
   */
  const memoryStorage = new Map();
  
  /**
   * Get an item from storage
   * @param {string} key - Storage key
   * @param {*} [defaultValue=null] - Default value if key doesn't exist
   * @returns {*} - Stored value or default value
   */
  export function getItem(key, defaultValue = null) {
    if (isLocalStorageAvailable()) {
      const value = localStorage.getItem(key);
      if (value === null) {
        return defaultValue;
      }
      
      try {
        // Try to parse JSON
        return JSON.parse(value);
      } catch (e) {
        // Return as string if not valid JSON
        return value;
      }
    } else {
      return memoryStorage.has(key) ? memoryStorage.get(key) : defaultValue;
    }
  }
  
  /**
   * Set an item in storage
   * @param {string} key - Storage key
   * @param {*} value - Value to store
   * @returns {boolean} - Success status
   */
  export function setItem(key, value) {
    try {
      const valueToStore = typeof value === 'object' ? JSON.stringify(value) : value;
      
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
   * @param {string} key - Storage key
   * @returns {boolean} - Success status
   */
  export function removeItem(key) {
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
   * @returns {boolean} - Success status
   */
  export function clear() {
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
   * @param {string} [newId] - New screen ID to set (optional)
   * @returns {string} - Current screen ID
   */
  export function screenId(newId) {
    const SCREEN_ID_KEY = 'screenId';
    
    // Set new ID if provided
    if (newId) {
      setItem(SCREEN_ID_KEY, newId);
      return newId;
    }
    
    // Get existing ID
    let existingId = getItem(SCREEN_ID_KEY);
    
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
    screenId
  };