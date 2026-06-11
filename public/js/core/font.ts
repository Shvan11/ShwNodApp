/**
 * Arabic-font helpers — pure functions shared by FontContext (inside RootLayout)
 * and any out-of-provider caller. No React (mirrors core/theme.ts + core/language.ts).
 *
 * What this controls: which webfont paints Arabic-script glyphs app-wide. Each
 * font in the registry has a unicode-range-confined @font-face (css/base/fonts.css)
 * so ONLY the selected family is ever downloaded, and only when Arabic glyphs are
 * actually painted — Latin text keeps resolving down the --font-primary stack to
 * system-ui regardless of the choice. The selected family is surfaced to CSS as
 * `--font-arabic` (the leading family in --font-primary), switched by a
 * `:root[data-arabic-font="<id>"]` rule per font.
 *
 * Persistence: per-device localStorage via core/storage, which writes the raw
 * string (`String(value)`, not JSON). That's deliberate — the inline FOUC script
 * in index.html reads it back with a plain `localStorage.getItem()` and no
 * JSON.parse, so the boot value and this module must agree on a raw string.
 *
 * Applied as `data-arabic-font="<id>"` on <html>. Adding a font = one entry in
 * ARABIC_FONTS + its @font-face + `:root[data-arabic-font]` rule in fonts.css +
 * the FOUC whitelist in index.html (three lists kept in sync).
 */
import { getItem, setItem } from './storage';

export type ArabicFont = 'cairo' | 'ibm-plex' | 'almarai';

export interface ArabicFontMeta {
  /**
   * The CSS `font-family` name — must match the @font-face `font-family` in
   * css/base/fonts.css AND the value set on `--font-arabic` by the matching
   * `:root[data-arabic-font]` rule. This is the contract that ties JS ↔ CSS.
   */
  cssFamily: string;
  /** English name for diagnostics / the picker label. */
  label: string;
  /**
   * Own-script sample shown in the picker so the user previews the actual glyph
   * shapes — deliberately NOT translated (you judge a font by its letterforms).
   */
  sample: string;
  /** One-line English description of the font's character (picker helper text). */
  note: string;
}

/**
 * Curated set of modern, popular, self-hosted Arabic webfonts. Order = picker
 * order. The `cssFamily` strings are the JS↔CSS contract (see ArabicFontMeta).
 */
export const ARABIC_FONTS: Record<ArabicFont, ArabicFontMeta> = {
  cairo: {
    cssFamily: 'Cairo',
    label: 'Cairo',
    sample: 'شركة شوان لتقويم الأسنان',
    note: 'Modern, friendly, geometric — the most popular Arabic web font.',
  },
  'ibm-plex': {
    cssFamily: 'IBM Plex Sans Arabic',
    label: 'IBM Plex Sans Arabic',
    sample: 'شركة شوان لتقويم الأسنان',
    note: 'Professional and technical — razor-sharp in dense tables and forms.',
  },
  almarai: {
    cssFamily: 'Almarai',
    label: 'Almarai',
    sample: 'شركة شوان لتقويم الأسنان',
    note: 'Clean and simple — calm, highly legible for UI.',
  },
};

export const ARABIC_FONT_STORAGE_KEY = 'shwan_arabic_font';
// Default is Cairo — a modern, popular upgrade over the neutral Noto baseline.
// Keep in sync with the FOUC fallback in index.html.
export const DEFAULT_ARABIC_FONT: ArabicFont = 'cairo';

const FONT_IDS = Object.keys(ARABIC_FONTS) as readonly ArabicFont[];

export function isArabicFont(value: unknown): value is ArabicFont {
  return typeof value === 'string' && (FONT_IDS as readonly string[]).includes(value);
}

/** Read the stored preference, falling back to the default when unset/invalid. */
export function getStoredArabicFont(): ArabicFont {
  // storage.getItem runs JSON.parse; the font ids aren't valid JSON so they come
  // back verbatim as strings — the whitelist guards anything else.
  const stored = getItem<unknown>(ARABIC_FONT_STORAGE_KEY);
  return isArabicFont(stored) ? stored : DEFAULT_ARABIC_FONT;
}

export function storeArabicFont(font: ArabicFont): void {
  setItem(ARABIC_FONT_STORAGE_KEY, font);
}

/**
 * Write the chosen font to `<html data-arabic-font>`. The matching
 * `:root[data-arabic-font="<id>"]` rule in css/base/fonts.css then points
 * `--font-arabic` (and thus the head of --font-primary) at that family. The FOUC
 * script in index.html already applied the same value before first paint, so the
 * first call from the provider is an idempotent no-op (no font swap flash).
 */
export function applyArabicFont(font: ArabicFont): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-arabic-font', font);
}
