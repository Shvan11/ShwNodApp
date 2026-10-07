/**
 * Root Layout for Data Router
 * Wraps all routes with:
 * - ThemeProvider (light/dark/auto — outermost so every consumer + the
 *   #modal-root portal inherit the documentElement theme vars)
 * - GlobalStateProvider (realtime + patient state)
 * - ToastProvider (notifications)
 * - PrintQueueProvider (multi-batch label printing)
 * - UniversalHeader (persistent header)
 * - PrintQueueIndicator (floating queue UI)
 * - Suspense (lazy loading)
 */
import { Suspense, useState, useCallback, useEffect } from 'react';
import { Outlet, ScrollRestoration, Location, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { applyDirectionForPath, LANGUAGES } from '../core/language';
import { screenHeadingKey } from '../core/routeTitle';
import { GlobalStateProvider } from '../contexts/GlobalStateContext';
import { ThemeProvider } from '../contexts/ThemeContext';
import { LanguageProvider, useLanguage } from '../contexts/LanguageContext';
import { FontProvider } from '../contexts/FontContext';
import { ToastProvider } from '../contexts/ToastContext';
import { PrintQueueProvider, usePrintQueue } from '../contexts/PrintQueueContext';
import { ConfirmProvider } from '../contexts/ConfirmContext';
import UniversalHeader from '../components/react/UniversalHeader';
import PrintQueueIndicator from '../components/react/PrintQueueIndicator';
import { lazyWithPreload } from '../router/lazyWithPreload';
import NavigationProgress from '../components/react/NavigationProgress';

// The label-printing dialog, opened from the floating print queue. Its own chunk:
// imported statically it put 44 kB of dialog (and its stylesheet) into every
// screen's first download, for something only the aligner section queues
// (audit FE-F26-9). The queue indicator warms the chunk the moment it has
// something to print, so the dialog opens without a wait.
const LabelPreviewModal = lazyWithPreload(() => import('../components/react/LabelPreviewModal'));

/**
 * The page-area spinner: the route-level Suspense fallback below, and what a
 * route shows while its first loader runs on a cold load (routes.config.tsx's
 * `hydrateFallbackElement`), so the two look the same.
 */
export function LoadingFallback() {
  return (
    <div className="loading-fallback">
      <div className="loading-fallback-content">
        <div className="loading-spinner"></div>
        <p>Loading...</p>
      </div>
    </div>
  );
}

/**
 * Inner layout component that can use PrintQueue context
 * Manages the queue modal state at the root level
 */
function RootLayoutInner() {
  const [showQueueModal, setShowQueueModal] = useState(false);
  const { queue, clearQueue } = usePrintQueue();
  const location = useLocation();
  const { language } = useLanguage();
  const { t } = useTranslation('common');

  // The header is persistent, always-translated chrome, so its writing direction
  // must follow the LANGUAGE — not the route-scoped `<html dir>` the watcher below
  // applies to the page body. Pinning `dir` on the header wrapper makes it a
  // stable RTL island in Arabic regardless of route; without it the header would
  // flip LTR⇄RTL (buttons jumping) every time you navigate between a translated
  // (RTL) and an untranslated (LTR) screen. postcss-rtlcss `[dir="rtl"] …`
  // descendant rules match via this ancestor, so no CSS change is needed.
  const headerDir = LANGUAGES[language].dir;

  // The screen's one <h1>, for the screens that do not draw their own.
  const headingKey = screenHeadingKey(location.pathname, location.search);

  // Route-scoped RTL: `<html dir>` flips to rtl only on translated routes (and
  // only when the language is RTL). LanguageContext handles language-change /
  // cross-tab updates for the current path; this watcher handles the OTHER axis
  // — navigation — re-applying dir as the user moves between translated (RTL)
  // and not-yet-translated (LTR) screens. Uses the language tracked in
  // core/language.ts, so no dependency on the language here. See RTL_ROUTES.
  useEffect(() => {
    applyDirectionForPath(location.pathname);
  }, [location.pathname]);

  // Something is queued: fetch the dialog now, ahead of the click that opens it.
  const hasQueue = queue.length > 0;
  useEffect(() => {
    if (hasQueue) void LabelPreviewModal.preload();
  }, [hasQueue]);

  const handlePrintAll = useCallback(() => {
    setShowQueueModal(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setShowQueueModal(false);
  }, []);

  const handleQueuePrintSuccess = useCallback(() => {
    clearQueue();
    setShowQueueModal(false);
  }, [clearQueue]);

  return (
    <>
      {/* Top progress bar during route navigation (loader + lazy-chunk wait).
          Data Router keeps the old screen mounted while loading, so this is the
          only "something is happening" cue on a nav click. */}
      <NavigationProgress />

      {/* First tab stop on every page: past the header's own controls, straight to
          the screen. A button-like link (no hash navigation — the router would treat
          `#app-container` as a location change). */}
      <a
        className="skip-link"
        href="#app-container"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('app-container')?.focus();
        }}
      >
        {t('a11y.skipToContent')}
      </a>

      {/* Persistent header - always mounted. `dir` follows the language (not the
          route) so the translated header doesn't flip between screens — see headerDir. */}
      <div id="universal-header-root" dir={headerDir}>
        <UniversalHeader />
      </div>

      {/* Main content - routes render here. THE page's one <main> landmark: 52 of
          55 screens had none, so a screen reader could not jump to the content, and
          every page-level <header> counted as a second banner (audit FE-F25-9).
          Screens must not render their own <main>. tabIndex -1: the skip link's target.

          The hidden <h1> names the screen for a screen reader's heading list (the
          clinic name in the header was every page's <h1> before). Deliberately NOT
          done: on 15 screens the first visible heading under it is still an <h3>
          (axe `heading-order`, a best-practice rule outside WCAG A/AA). Those
          headings are styled through tag selectors (`.dashboardCard h3`, …) in some
          35 rules and their media queries, so re-levelling them is a visual-regression
          risk for no AA gain — recorded as a non-fix under FE-F25-9. */}
      <main id="app-container" tabIndex={-1}>
        {headingKey && <h1 className="sr-only">{t(`titles.${headingKey}`)}</h1>}
        <Suspense fallback={<LoadingFallback />}>
          <Outlet />
        </Suspense>
      </main>

      {/* Print Queue Indicator - floating UI */}
      <PrintQueueIndicator onPrintAll={handlePrintAll} />

      {/* Queue Print Modal - opened from indicator */}
      {showQueueModal && queue.length > 0 && (
        <Suspense fallback={null}>
          <LabelPreviewModal
            queueMode={true}
            queuedItems={queue}
            onClose={handleCloseModal}
            onQueuePrintSuccess={handleQueuePrintSuccess}
          />
        </Suspense>
      )}

      {/* Native scroll restoration for route navigation */}
      <ScrollRestoration
        getKey={(location: Location) => location.pathname + location.search}
      />
    </>
  );
}

export function RootLayout() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <FontProvider>
          <ToastProvider>
            <ConfirmProvider>
              <GlobalStateProvider>
                <PrintQueueProvider>
                  <RootLayoutInner />
                </PrintQueueProvider>
              </GlobalStateProvider>
            </ConfirmProvider>
          </ToastProvider>
        </FontProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}

export default RootLayout;
