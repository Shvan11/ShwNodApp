/**
 * Phone Number Formatting Utility
 * Provides consistent phone number formatting across all messaging services.
 * Default country code: Iraq (+964)
 *
 * Scope note: this is the SERVER-side helper (WhatsApp / Telegram / SMS / 3Shape).
 * The browser has its own `public/js/utils/phoneFormatter.ts` for input masking
 * and display — the two are deliberately separate and share no code.
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
  const cleaned = phone.replace(/[^\d+]/g, '');

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
    // National trunk prefix: 07XXXXXXXX -> 9647XXXXXXXX. Dropping the leading 0
    // is right for every country that uses one, so there is no per-country branch.
    return countryCode + cleaned.substring(1);
  } else if (countryCode === '964' && cleaned.startsWith('7')) {
    // 7XXXXXXXX -> 9647XXXXXXXX (Iraqi mobile typed without the trunk 0)
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
 * Formats a phone number in international form WITH the `+` prefix
 * (`+9647XXXXXXXXX`) — what WhatsApp, Telegram and SMS gateways all expect.
 * There used to be one function per channel with byte-identical bodies.
 * @param phone - Raw phone number
 * @param countryCode - Country code (default: 964)
 * @returns Formatted international number, or '' for empty input
 */
export function formatInternational(phone: string, countryCode: string = DEFAULT_COUNTRY_CODE): string {
  if (!phone) return '';

  return '+' + normalizePhoneNumber(phone, countryCode);
}

/**
 * Formats a phone number as strict E.164 (e.g. +9647XXXXXXXXX).
 * Returns '' when the input isn't a valid number for the country, so callers
 * can safely omit it. Use for APIs that reject non-E.164 input — e.g. the
 * 3Shape Unite Web Service (`initiate-workflow` 400s on a bad PhoneNumber).
 * @param phone - Raw phone number
 * @param countryCode - Country code (default: 964)
 * @returns E.164 number with + prefix, or '' if invalid/empty
 */
export function formatForE164(phone: string, countryCode: string = DEFAULT_COUNTRY_CODE): string {
  if (!phone) return '';
  if (!isValidPhoneNumber(phone, countryCode)) return '';

  return '+' + normalizePhoneNumber(phone, countryCode);
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
    // Iraqi mobile numbers: 964 + 7 + 9 more digits (10 national digits, all
    // mobile ranges beginning 7).
    //
    // This used to be a carrier-block ALLOWLIST — `75[01]|77[0-9]|78[0-4]|79[0-5]`
    // — i.e. a snapshot of which prefixes Asiacell/Zain/Korek had been assigned
    // at the time it was written. Every prefix outside it was reported "invalid
    // number" and the WhatsApp/Telegram/SMS send was refused, so the day a
    // carrier is allocated a new block (752, 785, 796 …) the clinic simply cannot
    // message those patients, with no error a user could act on. For a product
    // sold to many centers that is a hard blocker, and the allowlist was never
    // buying anything the structural rule does not: a 10-digit national number
    // starting with 7 is the actual Iraqi mobile shape.
    const iraqiMobilePattern = /^9647\d{9}$/;
    return iraqiMobilePattern.test(normalized);
  } else {
    // Generic validation: country code + at least 7 digits
    const genericPattern = new RegExp(`^${countryCode}\\d{7,15}$`);
    return genericPattern.test(normalized);
  }
}

/**
 * Utility object with all formatting functions.
 * `forWhatsApp`/`forTelegram` are the same formatter under the two names the
 * call sites read best; every channel wants the same `+<country><local>` form.
 */
export const PhoneFormatter = {
  forWhatsApp: formatInternational,
  forTelegram: formatInternational,
  forE164: formatForE164,
  normalize: normalizePhoneNumber,
  isValid: isValidPhoneNumber,
};

export default PhoneFormatter;
