/**
 * useLocalizedName — pick a lookup row's display name for the active UI language.
 *
 * Lookup VALUES (expense category names, etc.) are clinic-owned data edited per
 * deployment via the Lookups admin, NOT build-time i18n catalog strings — so each
 * row carries an optional `*_name_ar` beside its base `*_name` (see CLAUDE.md
 * i18n / RTL → "DB-stored lookup values", and docs/i18n-translation-playbook.md).
 *
 * Both columns are fetched together in one query; this hook only chooses which to
 * render — Arabic when the UI language is Arabic AND a non-empty `name_ar` exists,
 * otherwise the base name (so untranslated rows, and proper nouns left blank by
 * design, fall back cleanly). Resolving CLIENT-SIDE keeps the server language-
 * agnostic: no per-language queries, no React-Query cache split, and an instant
 * re-label on language switch with no refetch. Reusable across every lookup module.
 */
import { useLanguage } from '../contexts/LanguageContext';

export function useLocalizedName(): (
  base: string | null | undefined,
  arabic: string | null | undefined
) => string {
  const { language } = useLanguage();
  return (base, arabic) => (language === 'ar' && arabic ? arabic : base) ?? '';
}
