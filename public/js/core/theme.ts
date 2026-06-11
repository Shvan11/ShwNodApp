/**
 * Theme helpers — pure functions shared by ThemeContext (inside RootLayout)
 * and the ChairDisplay light-pin (outside RootLayout, no providers). No React.
 *
 * Persistence: per-device localStorage via core/storage, which writes the raw
 * string (`String(value)`, not JSON). That's deliberate — the inline FOUC
 * script in index.html reads it back with a plain `localStorage.getItem()` and
 * no JSON.parse, so the boot value and this module must agree on a raw string.
 *
 * Applied as `data-theme="light|dark"` on <html>; tokens-semantic.css is the
 * light base and theme-dark.css overrides under `:root[data-theme="dark"]`.
 */
import { getItem, setItem } from './storage';

export type ThemePreference = 'light' | 'dark' | 'auto';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'shwan_theme';
// Default follows the device's system setting (light/dark) until the user picks
// an explicit theme — via the header Light⇄Dark toggle or Settings → General.
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'auto';

/** The OS-preference media query, shared so the listener and reader agree. */
export const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

const PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'auto'];

/** Value for <meta name="theme-color"> (mobile browser chrome). */
const THEME_COLOR_META: Record<ResolvedTheme, string> = {
  light: '#667eea', // header purple-light
  dark: '#11151c',  // night page background (--palette-night-900)
};

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (PREFERENCES as readonly string[]).includes(value);
}

/** Read the stored preference, falling back to the default when unset/invalid. */
export function getStoredThemePreference(): ThemePreference {
  // storage.getItem runs JSON.parse; 'light'|'dark'|'auto' aren't valid JSON so
  // they come back verbatim as strings — the whitelist guards anything else.
  const stored = getItem<unknown>(THEME_STORAGE_KEY);
  return isThemePreference(stored) ? stored : DEFAULT_THEME_PREFERENCE;
}

export function storeThemePreference(pref: ThemePreference): void {
  setItem(THEME_STORAGE_KEY, pref);
}

export function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(DARK_MEDIA_QUERY).matches
  );
}

/** Collapse a preference (incl. 'auto') to a concrete light|dark theme. */
export function resolveTheme(pref: ThemePreference): ResolvedTheme {
  if (pref === 'auto') return systemPrefersDark() ? 'dark' : 'light';
  return pref;
}

/** Write the resolved theme to <html data-theme> and the theme-color meta. */
export function applyResolvedTheme(theme: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLOR_META[theme]);
}
