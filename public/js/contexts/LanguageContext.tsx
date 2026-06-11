/**
 * Language Context — en / ar, persisted per-device. Structural clone of
 * ThemeContext. Mounted in RootLayout just inside ThemeProvider so every
 * consumer + the #modal-root portal inherit `<html dir>`.
 *
 * The actual `lang`/`dir` attributes are first set before paint by the inline
 * FOUC script in index.html, and i18next initializes from the same stored value
 * (see i18n/index.ts); this provider then keeps React state, the DOM attributes,
 * i18next, and cross-tab storage events in sync. There is no 'auto' mode —
 * language is always an explicit en|ar choice.
 */
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import {
  type Language,
  getStoredLanguagePreference,
  storeLanguagePreference,
  applyLanguageAttributes,
  LANGUAGE_STORAGE_KEY,
} from '../core/language';
import i18n from '../i18n';

export interface LanguageContextValue {
  /** The active language ('en' | 'ar'). */
  language: Language;
  setLanguage: (lang: Language) => void;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

interface LanguageProviderProps {
  children: ReactNode;
}

export function LanguageProvider({ children }: LanguageProviderProps) {
  const [language, setLanguageState] = useState<Language>(getStoredLanguagePreference);

  const setLanguage = useCallback((lang: Language) => {
    storeLanguagePreference(lang);
    applyLanguageAttributes(lang); // sync DOM update — no frame of stale direction
    void i18n.changeLanguage(lang);
    setLanguageState(lang);
  }, []);

  // Reconcile <html lang/dir> + i18next with the stored preference on mount. The
  // FOUC script and i18n.init already used the same stored value, so this is an
  // idempotent no-op on the happy path; it self-heals only if they ever diverge.
  useEffect(() => {
    const stored = getStoredLanguagePreference();
    applyLanguageAttributes(stored);
    if (i18n.language !== stored) void i18n.changeLanguage(stored);
  }, []);

  // Multi-tab sync: a sibling tab changing the stored language updates here.
  // MUST call changeLanguage too — applying only the attributes would flip the
  // layout to RTL while leaving stale (English) strings on screen.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent): void => {
      if (e.key !== LANGUAGE_STORAGE_KEY) return;
      const next = getStoredLanguagePreference();
      applyLanguageAttributes(next);
      void i18n.changeLanguage(next);
      setLanguageState(next);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const value = useMemo<LanguageContextValue>(
    () => ({ language, setLanguage }),
    [language, setLanguage]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

/**
 * Hook to access the current language.
 * Usage: const { language, setLanguage } = useLanguage();
 */
export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within LanguageProvider');
  }
  return context;
}

export default LanguageContext;
