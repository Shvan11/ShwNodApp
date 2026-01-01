/**
 * Money Formatting Utilities
 * Used application-wide for consistent number formatting with thousands separators
 */

/**
 * Format a number with thousands separators
 * @param value - The numeric value to format
 * @returns Formatted string (e.g., "1,234,567")
 */
export const formatNumber = (value: number | string | null | undefined): string => {
  if (value === null || value === undefined || value === '') return '';
  const num = parseFloat(String(value));
  if (isNaN(num)) return '';
  return Math.round(num).toLocaleString('en-US');
};

/**
 * Parse a formatted number string back to numeric value
 * @param value - The formatted string or number
 * @returns Numeric value or empty string
 */
export const parseFormattedNumber = (
  value: string | number | null | undefined
): number | '' => {
  if (!value && value !== 0) return '';
  const stringValue = String(value).replace(/,/g, '');
  const parsed = parseFloat(stringValue);
  return isNaN(parsed) ? '' : parsed;
};

/**
 * Format currency with amount and currency code
 * @param amount - The amount to format
 * @param currency - Currency code (USD, IQD, EUR)
 * @returns Formatted currency string (e.g., "1,234,567 IQD")
 */
export const formatCurrency = (
  amount: number | null | undefined,
  currency: string
): string => {
  if (amount === null || amount === undefined || isNaN(amount)) {
    return `0 ${currency}`;
  }
  return `${formatNumber(amount)} ${currency}`;
};

/**
 * Format money input value for display (handles both input and display contexts)
 * @param value - The value to format
 * @returns Formatted string suitable for input or display
 */
export const formatMoneyInput = (value: number | string | null | undefined): string => {
  return formatNumber(value);
};

/**
 * Parse money input value for calculations
 * @param value - The formatted or unformatted value
 * @returns Numeric value for calculations
 */
export const parseMoneyInput = (value: string | number | null | undefined): number => {
  const parsed = parseFormattedNumber(value);
  return parsed === '' ? 0 : parsed;
};
