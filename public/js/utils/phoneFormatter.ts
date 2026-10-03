/**
 * Phone Number Formatting Utilities for Frontend
 * Provides consistent phone display and input formatting across the app
 */

/**
 * Formats phone number for display with mask: 750 123 4567
 * Works with any input format - extracts digits and applies mask
 * @param phone - Raw phone number (any format)
 * @returns Formatted local number (750 123 4567; digits past the 10th as a fourth group)
 */
export function formatPhoneForDisplay(phone: string | null | undefined): string {
  if (!phone) return '';

  // Extract only digits
  const digits = phone.toString().replace(/[^\d]/g, '');

  // Handle numbers that start with country code (964)
  let localDigits = digits;
  if (digits.startsWith('964') && digits.length > 10) {
    localDigits = digits.substring(3);
  }

  // Apply mask: 000 000 0000, with anything past the 10th digit as a fourth group
  // (an international number) — never dropped, so the screen shows what is stored.
  if (localDigits.length <= 3) return localDigits;
  if (localDigits.length <= 6) return `${localDigits.slice(0, 3)} ${localDigits.slice(3)}`;
  if (localDigits.length <= 10) return `${localDigits.slice(0, 3)} ${localDigits.slice(3, 6)} ${localDigits.slice(6)}`;
  return `${localDigits.slice(0, 3)} ${localDigits.slice(3, 6)} ${localDigits.slice(6, 10)} ${localDigits.slice(10)}`;
}

/**
 * Strips all non-digit characters from phone number
 * Use when storing phone to database
 * @param phone - Phone with any formatting
 * @returns Clean digits only (7501234567)
 */
export function cleanPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  return phone.toString().replace(/[^\d]/g, '');
}

/**
 * Phone mask pattern for IMaskInput: the local 10-digit grouping, plus up to five
 * more digits for an international number (E.164 caps a number at 15). A strict
 * 10-digit mask truncated a longer stored number the moment the edit form showed
 * it, and the next save wrote the truncated value back (audit FE-F6-4).
 */
export const PHONE_MASK = '000 000 0000[ 00000]';

/**
 * Phone placeholder showing expected format
 */
export const PHONE_PLACEHOLDER = '750 123 4567';
