/**
 * Arabic-Font Context — selects the webfont used for Arabic-script text,
 * persisted per-device. Structural clone of ThemeContext (no 'auto' mode — the
 * choice is always an explicit font id).
 *
 * Mounted in RootLayout just inside LanguageProvider. The actual
 * `data-arabic-font` attribute is first set before paint by the inline FOUC
 * script in index.html; this provider then keeps it in sync with React state and
 * cross-tab storage events.
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
  type ArabicFont,
  getStoredArabicFont,
  storeArabicFont,
  applyArabicFont,
  ARABIC_FONT_STORAGE_KEY,
} from '../core/font';

export interface FontContextValue {
  /** The active Arabic font id. */
  arabicFont: ArabicFont;
  setArabicFont: (font: ArabicFont) => void;
}

const FontContext = createContext<FontContextValue | null>(null);

interface FontProviderProps {
  children: ReactNode;
}

export function FontProvider({ children }: FontProviderProps) {
  const [arabicFont, setArabicFontState] = useState<ArabicFont>(getStoredArabicFont);

  const setArabicFont = useCallback((font: ArabicFont) => {
    storeArabicFont(font);
    applyArabicFont(font); // sync DOM update — no frame of stale font
    setArabicFontState(font);
  }, []);

  // Reconcile <html data-arabic-font> with the stored preference on mount. The
  // FOUC script already applied the same stored value, so this is an idempotent
  // no-op on the happy path; it self-heals only if they ever diverge.
  useEffect(() => {
    applyArabicFont(getStoredArabicFont());
  }, []);

  // Multi-tab sync: a sibling tab changing the stored font updates here.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent): void => {
      if (e.key !== ARABIC_FONT_STORAGE_KEY) return;
      const next = getStoredArabicFont();
      applyArabicFont(next);
      setArabicFontState(next);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const value = useMemo<FontContextValue>(
    () => ({ arabicFont, setArabicFont }),
    [arabicFont, setArabicFont]
  );

  return <FontContext.Provider value={value}>{children}</FontContext.Provider>;
}

/**
 * Hook to access the current Arabic font.
 * Usage: const { arabicFont, setArabicFont } = useArabicFont();
 */
export function useArabicFont(): FontContextValue {
  const context = useContext(FontContext);
  if (!context) {
    throw new Error('useArabicFont must be used within FontProvider');
  }
  return context;
}

export default FontContext;
