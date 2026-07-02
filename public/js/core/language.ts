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
 * Applied as `<html lang>` (always the chosen language — for the Arabic webfont
 * + a11y) + `<html dir>` (ROUTE-SCOPED: RTL only on translated routes, see
 * RTL_ROUTES). postcss-rtlcss (override mode) then flips physical CSS wherever
 * `dir="rtl"` is present; nothing here touches CSS directly. Adding a language =
 * one entry in LANGUAGES + a locales/<code>/ catalog + the FOUC whitelist in
 * index.html.
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

/**
 * Routes whose content is translated and therefore allowed to flip to RTL.
 * RTL is **opt-in per route**, never opt-out: postcss-rtlcss emits
 * `[dir="rtl"] .x` descendant selectors that match via ANY rtl ancestor, so a
 * nested `dir="ltr"` can't cancel a document-level `dir="rtl"`. The base
 * therefore stays LTR and each translated screen opts in here — the
 * layout-direction sibling of the eslint i18next ratchet's file list. When you
 * translate a screen, add its path (and keep the FOUC route check in
 * `public/index.html` in sync). An entry matches the path exactly OR as a path
 * prefix (`<entry>/…`); the root `/` renders the Dashboard so it's matched in
 * `isRtlRoute`. Currently: Dashboard + Expenses + Appointments + the patient
 * Works page.
 */
export const RTL_ROUTES: readonly string[] = ['/dashboard', '/expenses', '/appointments'];

/**
 * Translated routes whose path carries a dynamic segment, so they can't be
 * expressed as a static prefix in RTL_ROUTES. Each is matched precisely (NOT the
 * whole `/patient/:id/*` subtree) so untranslated sibling patient pages
 * (visits/diagnosis/…) stay LTR English. Keep in sync with the FOUC check in
 * `public/index.html`. Currently:
 *   - the patient Works page (`/patient/:id/works`)
 *   - the appointment-booking workflow: the appointments list
 *     (`/patient/:id/appointments`), the new-appointment form
 *     (`/patient/:id/new-appointment`) and the edit-appointment form
 *     (`/patient/:id/edit-appointment/:appointmentId`).
 *   - the patient demographics screens: the read-only info page
 *     (`/patient/:id/patient-info`), the edit-patient form
 *     (`/patient/:id/edit-patient`) and the add-patient form
 *     (`/patient/new/add`).
 */
const RTL_ROUTE_PATTERNS: readonly RegExp[] = [
  /^\/patient\/[^/]+\/works\/?$/,
  /^\/patient\/[^/]+\/appointments\/?$/,
  /^\/patient\/[^/]+\/new-appointment\/?$/,
  /^\/patient\/[^/]+\/edit-appointment(\/.*)?$/,
  /^\/patient\/[^/]+\/patient-info\/?$/,
  /^\/patient\/[^/]+\/edit-patient\/?$/,
  /^\/patient\/[^/]+\/add\/?$/,
];

/** True if `path` is a translated route that may render RTL. */
export function isRtlRoute(path: string): boolean {
  if (path === '/') return true; // root route renders the Dashboard
  if (RTL_ROUTES.some((route) => path === route || path.startsWith(route + '/'))) return true;
  return RTL_ROUTE_PATTERNS.some((re) => re.test(path));
}

/** Direction to apply: RTL only when the language is RTL AND the route is translated. */
export function resolveDirection(lang: Language, path: string): 'ltr' | 'rtl' {
  return LANGUAGES[lang].dir === 'rtl' && isRtlRoute(path) ? 'rtl' : 'ltr';
}

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
 * Write `lang` (always the chosen language) + `dir` (route-scoped via
 * resolveDirection) to <html>, and track the active language for the formatters.
 * When `path` is omitted the current URL path is used — correct for the
 * language-change / cross-tab / mount callers in LanguageContext. The FOUC
 * script in index.html already applied the same values before first paint, so
 * the first call from the provider is an idempotent no-op (no layout flash).
 */
export function applyLanguageAttributes(lang: Language, path?: string): void {
  activeLanguage = lang;
  if (typeof document === 'undefined') return;
  const currentPath = path ?? window.location.pathname;
  document.documentElement.setAttribute('lang', lang);
  document.documentElement.setAttribute('dir', resolveDirection(lang, currentPath));
}

/**
 * Re-apply ONLY `dir` for a new route (language unchanged), using the tracked
 * active language. Called by the RootLayout route watcher on navigation so that
 * moving between a translated route (RTL) and an untranslated one (LTR) updates
 * the document direction without re-running the full language apply.
 */
export function applyDirectionForPath(path: string): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('dir', resolveDirection(activeLanguage, path));
}

/** Metadata for the currently-applied language — read by the formatters. */
export function getActiveLanguageMeta(): LanguageMeta {
  return LANGUAGES[activeLanguage];
}
