/**
 * Money Formatting Utilities
 * Used application-wide for consistent number formatting with thousands separators
 */
import { LANGUAGES, getActiveLanguageMeta, type Language } from '../core/language';
import { parseLocalDate } from './calendarDate';

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
 * A 24-hour "HH:MM[:SS]" wall-clock string as "h:mm" + the language's marker:
 * "15:30" → "3:30 PM" / "3:30 م". Returns the input unchanged when it is not a
 * clock time. Used by the booking picker's slot tiles (which showed a bare
 * 24-hour "15:30" beside the form's "3:30 PM", audit FE-F10-17) and the daily
 * board's cards.
 */
export const formatClockTime = (time24: string | null | undefined, lang: Language): string => {
  if (!time24) return '';
  const [h, m] = time24.split(':');
  const hours = parseInt(h, 10);
  if (Number.isNaN(hours) || m === undefined) return time24;
  const period = hours >= 12 ? MERIDIEM[lang].pm : MERIDIEM[lang].am;
  return `${hours % 12 || 12}:${m.slice(0, 2)} ${period}`;
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

export interface RelativeAgeParts {
  n: number;
  unit: 'minutes' | 'hours' | 'days';
}

/**
 * Whole minutes (at least 1), hours or days between `iso` and `now` — the header
 * bells' "5m / 3h / 2d" age. The caller words it (`common:age.*`). Null for a
 * missing or unparseable stamp.
 */
export const relativeAge = (
  iso: string | null | undefined,
  now: number = Date.now()
): RelativeAgeParts | null => {
  if (!iso) return null;
  const diff = now - new Date(iso).getTime();
  if (Number.isNaN(diff)) return null;
  const day = 86_400_000;
  if (diff < 3_600_000) return { n: Math.max(1, Math.floor(diff / 60_000)), unit: 'minutes' };
  if (diff < day) return { n: Math.floor(diff / 3_600_000), unit: 'hours' };
  return { n: Math.floor(diff / day), unit: 'days' };
};

/**
 * Locale-Pinned Date Formatting
 *
 * `toLocaleDateString()` / `toLocaleDateString(undefined, …)` format in the
 * BROWSER's locale — i.e. the host OS's. On an Arabic-locale Windows box that
 * renders `٢٠٢٦/١٠/٠٣` beside money the app pins to Western digits (audit
 * FE-F3-3). These three always pass an app locale from `LANGUAGES`, so the
 * Arabic entry's `-u-nu-latn` pin holds.
 *
 * `lang` defaults to English: an untranslated screen's chrome is English, so its
 * dates are too, whatever the language setting. A translated screen passes
 * `useLanguage().language` EXPLICITLY (same reason as the weekday helpers above:
 * a visible dependency, so React Compiler re-runs the format on a live toggle).
 *
 * A date-only `'YYYY-MM-DD'` (a PG `date`) is read as a LOCAL day, never UTC
 * midnight. Missing or unparseable input returns `''`, so each caller keeps its
 * own placeholder (`|| '—'`).
 */
export type DateInput = Date | string | number | null | undefined;

const toValidDate = (value: DateInput): Date | null => {
  if (value === null || value === undefined || value === '') return null;
  const d = typeof value === 'number' ? new Date(value) : parseLocalDate(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** A calendar date in an app locale — `toLocaleDateString` with the locale pinned. */
export const formatLocaleDate = (
  value: DateInput,
  options?: Intl.DateTimeFormatOptions,
  lang: Language = 'en'
): string => toValidDate(value)?.toLocaleDateString(LANGUAGES[lang].locale, options) ?? '';

/** A date and time in an app locale — `toLocaleString` with the locale pinned. */
export const formatLocaleDateTime = (
  value: DateInput,
  options?: Intl.DateTimeFormatOptions,
  lang: Language = 'en'
): string => toValidDate(value)?.toLocaleString(LANGUAGES[lang].locale, options) ?? '';

/** A wall-clock time in an app locale — `toLocaleTimeString` with the locale pinned. */
export const formatLocaleTime = (
  value: DateInput,
  options?: Intl.DateTimeFormatOptions,
  lang: Language = 'en'
): string => toValidDate(value)?.toLocaleTimeString(LANGUAGES[lang].locale, options) ?? '';
