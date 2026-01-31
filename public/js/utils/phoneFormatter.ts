/**
 * Phone Number Formatting Utilities for Frontend
 * Provides consistent phone display and input formatting across the app
 */

/**
 * Formats phone number for display with mask: 750 123 4567
 * Works with any input format - extracts digits and applies mask
 * @param phone - Raw phone number (any format)
 * @returns Formatted local number (750 123 4567)
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

  // Limit to 10 digits
  localDigits = localDigits.slice(0, 10);

  // Apply mask: 000 000 0000
  if (localDigits.length <= 3) return localDigits;
  if (localDigits.length <= 6) return `${localDigits.slice(0, 3)} ${localDigits.slice(3)}`;
  return `${localDigits.slice(0, 3)} ${localDigits.slice(3, 6)} ${localDigits.slice(6)}`;
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
 * Phone mask pattern for IMaskInput
 */
export const PHONE_MASK = '000 000 0000';

/**
 * Phone placeholder showing expected format
 */
export const PHONE_PLACEHOLDER = '750 123 4567';
