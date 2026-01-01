/**
 * Phone Number Formatting Utility
 * Provides consistent phone number formatting across all messaging services
 * Default country code: Iraq (+964)
 */

const DEFAULT_COUNTRY_CODE = '964';

/**
 * Normalizes phone number to standard format: {countryCode}{localNumber}
 * Handles various input formats and converts to consistent internal format
 * @param phone - Raw phone number
 * @param countryCode - Country code (default: 964)
 * @returns Normalized phone number (9647XXXXXXXX)
 */
function normalizePhoneNumber(phone: string, countryCode: string = DEFAULT_COUNTRY_CODE): string {
  if (!phone) return '';

  // Remove all non-digit characters except +
  let cleaned = phone.replace(/[^\d+]/g, '');

  // Handle different input formats
  if (cleaned.startsWith('+' + countryCode)) {
    // +9647XXXXXXXX -> 9647XXXXXXXX
    return cleaned.substring(1);
  } else if (cleaned.startsWith('00' + countryCode)) {
    // 009647XXXXXXXX -> 9647XXXXXXXX
    return cleaned.substring(2);
  } else if (cleaned.startsWith(countryCode)) {
    // Already in correct format: 9647XXXXXXXX
    return cleaned;
  } else if (cleaned.startsWith('0')) {
    // 07XXXXXXXX -> 9647XXXXXXXX (for Iraqi numbers)
    if (countryCode === '964') {
      return countryCode + cleaned.substring(1);
    } else {
      // For other countries, remove leading 0
      return countryCode + cleaned.substring(1);
    }
  } else if (countryCode === '964' && cleaned.startsWith('7')) {
    // 7XXXXXXXX -> 9647XXXXXXXX (Iraqi mobile)
    return countryCode + cleaned;
  } else if (cleaned.startsWith('+')) {
    // +XXXXXXXXXXXX -> XXXXXXXXXXXX (keep as is, might be international)
    return cleaned.substring(1);
  } else {
    // Assume it needs country code
    return countryCode + cleaned;
  }
}

/**
 * Formats phone number for WhatsApp
 * WhatsApp requires international format WITH + prefix: +9647XXXXXXXX
 * @param phone - Raw phone number
 * @param countryCode - Country code (default: 964)
 * @returns Formatted phone number for WhatsApp
 */
export function formatForWhatsApp(phone: string, countryCode: string = DEFAULT_COUNTRY_CODE): string {
  if (!phone) return '';

  const normalized = normalizePhoneNumber(phone, countryCode);

  // WhatsApp needs international format with + prefix
  return '+' + normalized;
}

/**
 * Formats phone number for Telegram
 * Telegram requires international format: +9647XXXXXXXX
 * @param phone - Raw phone number
 * @param countryCode - Country code (default: 964)
 * @returns Formatted phone number for Telegram
 */
export function formatForTelegram(phone: string, countryCode: string = DEFAULT_COUNTRY_CODE): string {
  if (!phone) return '';

  const normalized = normalizePhoneNumber(phone, countryCode);

  // Telegram needs international format with + prefix
  return '+' + normalized;
}

/**
 * Formats phone number for SMS
 * SMS typically requires international format: +9647XXXXXXXX
 * @param phone - Raw phone number
 * @param countryCode - Country code (default: 964)
 * @returns Formatted phone number for SMS
 */
export function formatForSMS(phone: string, countryCode: string = DEFAULT_COUNTRY_CODE): string {
  if (!phone) return '';

  const normalized = normalizePhoneNumber(phone, countryCode);

  // SMS needs international format with + prefix
  return '+' + normalized;
}

/**
 * Formats phone number for database storage
 * Database stores in format: 9647XXXXXXXX (without + prefix)
 * @param phone - Raw phone number
 * @param countryCode - Country code (default: 964)
 * @returns Formatted phone number for database
 */
export function formatForDatabase(phone: string, countryCode: string = DEFAULT_COUNTRY_CODE): string {
  if (!phone) return '';

  return normalizePhoneNumber(phone, countryCode);
}

/**
 * Formats phone number for display
 * Display format: +964 7XX XXX XXXX
 * @param phone - Raw phone number
 * @param countryCode - Country code (default: 964)
 * @returns Formatted phone number for display
 */
export function formatForDisplay(phone: string, countryCode: string = DEFAULT_COUNTRY_CODE): string {
  if (!phone) return '';

  const normalized = normalizePhoneNumber(phone, countryCode);
  const localNumber = normalized.substring(countryCode.length);

  // Format based on country code
  if (countryCode === '964' && localNumber.length >= 10) {
    // Iraqi format: +964 7XX XXX XXXX
    return `+964 ${localNumber.substring(0, 3)} ${localNumber.substring(3, 6)} ${localNumber.substring(6)}`;
  } else {
    // Generic international format: +XXX XXXXXXXXXX
    return '+' + countryCode + ' ' + localNumber;
  }
}

/**
 * Validates if phone number is valid for the given country
 * @param phone - Phone number to validate
 * @param countryCode - Country code (default: 964)
 * @returns True if valid phone number
 */
export function isValidPhoneNumber(phone: string, countryCode: string = DEFAULT_COUNTRY_CODE): boolean {
  if (!phone) return false;

  const normalized = normalizePhoneNumber(phone, countryCode);

  if (countryCode === '964') {
    // Iraqi mobile numbers: 964 + 7XX + XXXXXXX (10 digits after 964)
    const iraqiMobilePattern = /^964(75[01]|77[0-9]|78[0-4]|79[0-5])\d{7}$/;
    return iraqiMobilePattern.test(normalized);
  } else {
    // Generic validation: country code + at least 7 digits
    const genericPattern = new RegExp(`^${countryCode}\\d{7,15}$`);
    return genericPattern.test(normalized);
  }
}

/**
 * Gets the local part of a phone number (without country code)
 * @param phone - Phone number
 * @param countryCode - Country code (default: 964)
 * @returns Local part (7XXXXXXXX for Iraq)
 */
export function getLocalNumber(phone: string, countryCode: string = DEFAULT_COUNTRY_CODE): string {
  if (!phone) return '';

  const normalized = normalizePhoneNumber(phone, countryCode);

  if (normalized.startsWith(countryCode)) {
    return normalized.substring(countryCode.length);
  }

  return normalized;
}

/**
 * Extracts country code from international phone number
 * @param phone - Phone number
 * @returns Country code or default (964)
 */
export function extractCountryCode(phone: string): string {
  if (!phone) return DEFAULT_COUNTRY_CODE;

  const cleaned = phone.replace(/[^\d+]/g, '');

  // Common country codes to check (ordered by likelihood)
  const countryCodes = ['964', '1', '44', '49', '33', '39', '34', '7', '86', '81', '91'];

  for (const code of countryCodes) {
    if (cleaned.startsWith('+' + code) || cleaned.startsWith('00' + code) || cleaned.startsWith(code)) {
      return code;
    }
  }

  return DEFAULT_COUNTRY_CODE;
}

/**
 * Utility object with all formatting functions
 */
export const PhoneFormatter = {
  forWhatsApp: formatForWhatsApp,
  forTelegram: formatForTelegram,
  forSMS: formatForSMS,
  forDatabase: formatForDatabase,
  forDisplay: formatForDisplay,
  normalize: normalizePhoneNumber,
  isValid: isValidPhoneNumber,
  getLocal: getLocalNumber,
  extractCountryCode: extractCountryCode
};

export default PhoneFormatter;
