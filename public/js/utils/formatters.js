/**
 * Money Formatting Utilities
 * Used application-wide for consistent number formatting with thousands separators
 */

/**
 * Format a number with thousands separators
 * @param {number|string} value - The numeric value to format
 * @returns {string} Formatted string (e.g., "1,234,567")
 */
export const formatNumber = (value) => {
    if (!value && value !== 0) return '';
    const num = parseFloat(value);
    if (isNaN(num)) return '';
    return Math.round(num).toLocaleString('en-US');
};

/**
 * Parse a formatted number string back to numeric value
 * @param {string|number} value - The formatted string or number
 * @returns {number|string} Numeric value or empty string
 */
export const parseFormattedNumber = (value) => {
    if (!value) return '';
    const stringValue = String(value).replace(/,/g, '');
    const parsed = parseFloat(stringValue);
    return isNaN(parsed) ? '' : parsed;
};

/**
 * Format currency with amount and currency code
 * @param {number} amount - The amount to format
 * @param {string} currency - Currency code (USD, IQD, EUR)
 * @returns {string} Formatted currency string (e.g., "1,234,567 IQD")
 */
export const formatCurrency = (amount, currency) => {
    if (amount === null || amount === undefined || isNaN(amount)) {
        return `0 ${currency}`;
    }
    return `${formatNumber(amount)} ${currency}`;
};

/**
 * Format money input value for display (handles both input and display contexts)
 * @param {number|string} value - The value to format
 * @returns {string} Formatted string suitable for input or display
 */
export const formatMoneyInput = (value) => {
    return formatNumber(value);
};

/**
 * Parse money input value for calculations
 * @param {string|number} value - The formatted or unformatted value
 * @returns {number} Numeric value for calculations
 */
export const parseMoneyInput = (value) => {
    const parsed = parseFormattedNumber(value);
    return parsed === '' ? 0 : parsed;
};
