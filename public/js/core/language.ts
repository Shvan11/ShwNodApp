/**
 * Language helpers — pure functions shared by LanguageContext (inside RootLayout)
 * and the ChairDisplay LTR-pin (outside RootLayout, no providers). No React,
 * no i18next — this is the deterministic, framework-free core (mirrors core/theme.ts).
 *
 * Persistence: per-device localStorage via core/storage, which writes the raw
 * string (`String(value)`, not JSON). That's deliberate — the inline FOUC script
 * in index.html reads it back with a plain `localStorage.getItem()` and no
 * JSON.parse, so the boot value and this module must agree on a raw string.
 *
 * Applied as `<html lang>` + `<html dir>`. postcss-rtlcss (override mode) then
 * flips physical CSS automatically once `dir="rtl"` is present; nothing here
 * touches CSS directly. Adding a language = one entry in LANGUAGES + a
 * locales/<code>/ catalog + the FOUC whitelist in index.html.
 */
import { getItem, setItem } from './storage';

export type Language = 'en' | 'ar'; // add 'ku' here later — one entry + catalogs + FOUC whitelist

export interface LanguageMeta {
  /** Writing direction — drives `<html dir>` and (via that) postcss-rtlcss overrides. */
  dir: 'ltr' | 'rtl';
  /** Intl locale for future date/text formatting. `-u-nu-latn` pins Arabic to Latin digits. */
  locale: string;
  /**
   * Locale used for number grouping. 'en-US' for BOTH languages on purpose:
   * Latin digits + ',' grouping keeps the money parse round-trip intact
   * (formatNumber → ',' grouping; parseFormattedNumber strips /,/g). An Arabic
   * numberLocale would emit Arabic-Indic digits + different separators and break it.
   */
  numberLocale: string;
  /** English name (for diagnostics / non-localized contexts). */
  label: string;
  /** Own-script name shown in the picker — deliberately NOT translated. */
  nativeLabel: string;
}

export const LANGUAGES: Record<Language, LanguageMeta> = {
  en: {
    dir: 'ltr',
    locale: 'en-US',
    numberLocale: 'en-US',
    label: 'English',
    nativeLabel: 'English',
  },
  ar: {
    dir: 'rtl',
    locale: 'ar-IQ-u-nu-latn', // Iraq Arabic, Latin digits (Western 0-9 — user decision)
    numberLocale: 'en-US',
    label: 'Arabic',
    nativeLabel: 'العربية',
  },
};

export const LANGUAGE_STORAGE_KEY = 'shwan_language';
export const DEFAULT_LANGUAGE: Language = 'en';

const LANGUAGE_CODES = Object.keys(LANGUAGES) as readonly Language[];

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGE_CODES as readonly string[]).includes(value);
}

/** Read the stored preference, falling back to the default when unset/invalid. */
export function getStoredLanguagePreference(): Language {
  // storage.getItem runs JSON.parse; 'en'|'ar' aren't valid JSON so they come
  // back verbatim as strings — the whitelist guards anything else.
  const stored = getItem<unknown>(LANGUAGE_STORAGE_KEY);
  return isLanguage(stored) ? stored : DEFAULT_LANGUAGE;
}

export function storeLanguagePreference(lang: Language): void {
  setItem(LANGUAGE_STORAGE_KEY, lang);
}

// The active language, tracked at module scope so the pure formatters in
// utils/formatters.ts can read the locale without importing React/i18next.
// Initialized from storage so a read before the provider mounts is still correct.
let activeLanguage: Language = getStoredLanguagePreference();

/**
 * Write `lang` + `dir` to <html> and update the module-level active language.
 * The FOUC script in index.html already applied these before first paint, so
 * the first call from the provider is an idempotent no-op (no layout flash).
 */
export function applyLanguageAttributes(lang: Language): void {
  activeLanguage = lang;
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('lang', lang);
  document.documentElement.setAttribute('dir', LANGUAGES[lang].dir);
}

/** Metadata for the currently-applied language — read by the formatters. */
export function getActiveLanguageMeta(): LanguageMeta {
  return LANGUAGES[activeLanguage];
}
