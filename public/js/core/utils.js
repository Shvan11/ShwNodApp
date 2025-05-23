// core/utils.js
/**
 * General utility functions
 */

/**
 * Format a date to DD-MM-YYYY
 * @param {string|Date} date - Date to format
 * @returns {string} - Formatted date
 */
export function formatDate(date) {
    if (!date) return '';
    
    const d = date instanceof Date ? date : new Date(date);
    
    if (isNaN(d.getTime())) return '';
    
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    
    return `${day}-${month}-${year}`;
  }
  
  /**
   * Format a date to YYYY-MM-DD (ISO format)
   * @param {string|Date} date - Date to format
   * @returns {string} - Formatted date
   */
  export function formatISODate(date) {
    if (!date) return '';
    
    const d = date instanceof Date ? date : new Date(date);
    
    if (isNaN(d.getTime())) return '';
    
    return d.toISOString().split('T')[0];
  }
  
  /**
   * Debounce a function
   * @param {Function} func - Function to debounce
   * @param {number} wait - Wait time in ms
   * @param {boolean} [immediate=false] - Whether to call immediately
   * @returns {Function} - Debounced function
   */
  export function debounce(func, wait, immediate = false) {
    let timeout;
    
    return function executedFunction(...args) {
      const context = this;
      
      const later = function() {
        timeout = null;
        if (!immediate) func.apply(context, args);
      };
      
      const callNow = immediate && !timeout;
      
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
      
      if (callNow) func.apply(context, args);
    };
  }
  
  /**
   * Throttle a function
   * @param {Function} func - Function to throttle
   * @param {number} limit - Throttle limit in ms
   * @returns {Function} - Throttled function
   */
  export function throttle(func, limit) {
    let inThrottle;
    
    return function executedFunction(...args) {
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
   * @param {number} [length=8] - ID length
   * @returns {string} - Random ID
   */
  export function generateId(length = 8) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let id = '';
    
    for (let i = 0; i < length; i++) {
      id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    return id;
  }
  
  /**
   * Deep clone an object
   * @param {Object} obj - Object to clone
   * @returns {Object} - Cloned object
   */
  export function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }
    
    if (obj instanceof Date) {
      return new Date(obj.getTime());
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => deepClone(item));
    }
    
    const clone = {};
    
    Object.keys(obj).forEach(key => {
      clone[key] = deepClone(obj[key]);
    });
    
    return clone;
  }
  
/**
 * Format a phone number to standard format
 * @param {string} phoneNumber - Raw phone number
 * @param {string} [countryCode='964'] - Country code
 * @returns {string} - Formatted phone number
 */
export function formatPhoneNumber(phoneNumber, countryCode = '964') {
  if (!phoneNumber) return '';
  
  // Remove non-digit characters
  const digits = phoneNumber.replace(/\D/g, '');
  
  // Handle different formats
  if (digits.startsWith('00' + countryCode)) {
    // Remove leading 00 and country code
    return countryCode + digits.substring((countryCode.length + 2));
  } else if (digits.startsWith('+' + countryCode)) {
    // Remove leading + and country code
    return countryCode + digits.substring((countryCode.length + 1));
  } else if (digits.startsWith('0')) {
    // Replace leading 0 with country code
    return countryCode + digits.substring(1);
  } else if (!digits.startsWith(countryCode)) {
    // Add country code if missing
    return countryCode + digits;
  }
  
  return digits;
}


  export default {
    formatPhoneNumber,
    formatDate,
    formatISODate,
    debounce,
    throttle,
    generateId,
    deepClone
  };