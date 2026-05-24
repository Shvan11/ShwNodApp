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

/**
 * Time Formatting Utilities
 * 12-hour clock for the calendar, with both AM and PM kept for consistency.
 */

/** 12-hour display parts, used where hour, minute and meridiem are styled separately. */
export interface Time12Parts {
  hour: string;              // "1"–"12"
  minute: string;            // ":00", ":30"
  meridiem: 'AM' | 'PM' | ''; // "" only for invalid input
}

/**
 * Convert a 24-hour "HH:MM" string to 12-hour display parts.
 * @param time24 - Time in 24-hour format (e.g., "14:00", "09:30")
 * @returns hour/minute/meridiem parts ("" fields for invalid input)
 */
export const to12Hour = (time24: string | null | undefined): Time12Parts => {
  if (!time24) return { hour: '', minute: '', meridiem: '' };
  const [h = '', m = '00'] = time24.split(':');
  const hourNum = parseInt(h, 10);
  if (isNaN(hourNum)) return { hour: '', minute: '', meridiem: '' };
  return {
    hour: String(hourNum % 12 || 12),
    minute: `:${m.padStart(2, '0')}`,
    meridiem: hourNum < 12 ? 'AM' : 'PM'
  };
};

/**
 * Format a 24-hour "HH:MM" string as a single 12-hour label.
 * e.g. "14:00" → "2:00 PM", "09:30" → "9:30 AM".
 * @param time24 - Time in 24-hour format
 * @returns Formatted 12-hour label ("" for invalid input)
 */
export const formatTime12 = (time24: string | null | undefined): string => {
  const { hour, minute, meridiem } = to12Hour(time24);
  if (!hour) return '';
  return `${hour}${minute} ${meridiem}`;
};
