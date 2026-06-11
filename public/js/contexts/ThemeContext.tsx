/**
 * Theme Context — light / dark / auto, persisted per-device.
 *
 * Follows the ToastContext provider+hook shape. Mounted OUTERMOST in
 * RootLayout (wraps ToastProvider). The actual `data-theme` attribute is first
 * set before paint by the inline FOUC script in index.html; this provider then
 * keeps it in sync with React state, live OS changes (when preference is
 * 'auto'), and cross-tab storage events.
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
  type ThemePreference,
  type ResolvedTheme,
  getStoredThemePreference,
  storeThemePreference,
  resolveTheme,
  applyResolvedTheme,
  systemPrefersDark,
  DARK_MEDIA_QUERY,
  THEME_STORAGE_KEY,
} from '../core/theme';

export interface ThemeContextValue {
  /** The user's stored choice (may be 'auto'). */
  preference: ThemePreference;
  /** The concrete theme currently applied ('light' | 'dark'). */
  resolvedTheme: ResolvedTheme;
  setPreference: (pref: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [preference, setPreferenceState] = useState<ThemePreference>(getStoredThemePreference);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveTheme(getStoredThemePreference())
  );

  const setPreference = useCallback((pref: ThemePreference) => {
    storeThemePreference(pref);
    setPreferenceState(pref);
    setResolvedTheme(resolveTheme(pref));
  }, []);

  // Apply the resolved theme to <html> whenever it changes. The FOUC script
  // already applied the initial value before first paint, so the first run is
  // an idempotent no-op (no flash).
  useEffect(() => {
    applyResolvedTheme(resolvedTheme);
  }, [resolvedTheme]);

  // When the preference is 'auto', follow the OS setting live — DevTools
  // emulation or an OS toggle updates the app without a reload.
  useEffect(() => {
    if (preference !== 'auto') return;
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(DARK_MEDIA_QUERY);
    const onChange = (): void => setResolvedTheme(systemPrefersDark() ? 'dark' : 'light');
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [preference]);

  // Multi-tab sync: a sibling tab changing the stored preference updates here.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent): void => {
      if (e.key !== THEME_STORAGE_KEY) return;
      const next = getStoredThemePreference();
      setPreferenceState(next);
      setResolvedTheme(resolveTheme(next));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolvedTheme, setPreference }),
    [preference, resolvedTheme, setPreference]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Hook to access the current theme.
 * Usage: const { preference, resolvedTheme, setPreference } = useTheme();
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}

export default ThemeContext;
