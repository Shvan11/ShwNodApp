/**
 * Money Formatting Utilities
 * Used application-wide for consistent number formatting with thousands separators
 */
import { LANGUAGES, getActiveLanguageMeta, type Language } from '../core/language';

/**
 * Format a number with thousands separators
 * @param value - The numeric value to format
 * @returns Formatted string (e.g., "1,234,567")
 */
export const formatNumber = (value: number | string | null | undefined): string => {
  if (value === null || value === undefined || value === '') return '';
  const num = parseFloat(String(value));
  if (isNaN(num)) return '';
  // numberLocale is 'en-US' for BOTH languages (Latin digits + ',' grouping), so
  // this is behavior-identical today — but the registry is now the single point
  // to flip number formatting per-language in future without touching call sites.
  return Math.round(num).toLocaleString(getActiveLanguageMeta().numberLocale);
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

/**
 * Localized Date / Weekday Formatting Utilities
 *
 * Used by the appointment-booking workflow (calendar picker, new/edit forms,
 * patient appointment list). Western digits are kept in BOTH languages (the
 * money round-trip + product decision — see core/language), so only the weekday
 * and meridiem words localize; day/month/year stay numeric Latin.
 *
 * Arabic weekday names are SHORT forms WITHOUT the "ال" prefix (سبت / أحد), a
 * product decision: Intl can't produce these (toLocaleDateString yields the
 * "ال"-prefixed "السبت"), so they're mapped by hand here. English keeps Intl.
 *
 * The active language is passed in EXPLICITLY (not read from module state like
 * formatNumber does) so it's a visible reactive dependency: with React Compiler
 * on, a call keyed only on the Date would otherwise cache and serve a stale
 * (English) string across a live language toggle. Callers pass `language` from
 * useLanguage(); cf. AppointmentsHeader, which ties its date format to `t`.
 */

// Indexed by Date.getDay(): 0 = Sunday … 6 = Saturday.
const ARABIC_WEEKDAYS = ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'] as const;

// AM/PM markers as locale data (so the formatters stay free of react-i18next).
const MERIDIEM: Record<Language, { am: string; pm: string }> = {
  en: { am: 'AM', pm: 'PM' },
  ar: { am: 'ص', pm: 'م' },
};

/** Localized SHORT weekday for a date (Arabic سبت-style, English via Intl). */
export const formatWeekdayShort = (date: Date, lang: Language): string =>
  lang === 'ar'
    ? ARABIC_WEEKDAYS[date.getDay()]
    : date.toLocaleDateString(LANGUAGES[lang].locale, { weekday: 'short' });

/** Localized LONG weekday (Arabic reuses the same سبت-style short form — there is no "ال"-less long form). */
export const formatWeekdayLong = (date: Date, lang: Language): string =>
  lang === 'ar'
    ? ARABIC_WEEKDAYS[date.getDay()]
    : date.toLocaleDateString(LANGUAGES[lang].locale, { weekday: 'long' });

/** Full month name in the given language (e.g. "December" / "كانون الأول"). */
export const formatMonthName = (date: Date, lang: Language): string =>
  date.toLocaleDateString(LANGUAGES[lang].locale, { month: 'long' });

/**
 * Calendar column headers, Saturday-first with Friday omitted (6 entries) to
 * match the booking calendar grid. English keeps its single-letter headers.
 */
export const calendarWeekdayHeaders = (lang: Language): readonly string[] =>
  lang === 'ar'
    ? ['سبت', 'أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس']
    : ['S', 'S', 'M', 'T', 'W', 'T'];

// 12-hour "h:mm AM/PM" with localized meridiem, Western digits in both languages.
const formatClock12 = (date: Date, lang: Language): string => {
  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const period = hours >= 12 ? MERIDIEM[lang].pm : MERIDIEM[lang].am;
  hours = hours % 12 || 12;
  return `${hours}:${minutes} ${period}`;
};

/**
 * Compact date+time for the "Selected Time" readout on the booking forms.
 * en: "Sat, Dec 25, 2:30 PM" (Intl) · ar: "سبت 25/12 2:30 م".
 */
export const formatAppointmentDateTime = (date: Date, lang: Language): string => {
  if (lang === 'ar') {
    return `${formatWeekdayShort(date, lang)} ${date.getDate()}/${date.getMonth() + 1} ${formatClock12(date, lang)}`;
  }
  return date.toLocaleString(LANGUAGES[lang].locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

/**
 * Day-prefixed full date+time for the patient appointment list.
 * en: "Mon 25/12/2024 2:30 PM" · ar: "سبت 25/12/2026 2:30 م".
 */
export const formatAppointmentListDateTime = (date: Date, lang: Language): string => {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${formatWeekdayShort(date, lang)} ${day}/${month}/${year} ${formatClock12(date, lang)}`;
};

/**
 * Heading for the day-schedule column in the booking calendar.
 * en: "Saturday, Dec 25" (Intl) · ar: "سبت 25/12".
 */
export const formatScheduleDate = (date: Date, lang: Language): string => {
  if (lang === 'ar') {
    return `${formatWeekdayLong(date, lang)} ${date.getDate()}/${date.getMonth() + 1}`;
  }
  return date.toLocaleDateString(LANGUAGES[lang].locale, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
};
