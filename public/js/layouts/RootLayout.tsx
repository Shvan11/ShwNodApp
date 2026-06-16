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
import { applyDirectionForPath, LANGUAGES } from '../core/language';
import { GlobalStateProvider } from '../contexts/GlobalStateContext';
import { ThemeProvider } from '../contexts/ThemeContext';
import { LanguageProvider, useLanguage } from '../contexts/LanguageContext';
import { FontProvider } from '../contexts/FontContext';
import { ToastProvider } from '../contexts/ToastContext';
import { PrintQueueProvider, usePrintQueue } from '../contexts/PrintQueueContext';
import { ConfirmProvider } from '../contexts/ConfirmContext';
import UniversalHeader from '../components/react/UniversalHeader';
import PrintQueueIndicator from '../components/react/PrintQueueIndicator';
import LabelPreviewModal from '../components/react/LabelPreviewModal';
import NavigationProgress from '../components/react/NavigationProgress';

interface QueuedItem {
  id: string;
  batchNumber: number;
  personId: number;
  patientName: string;
  doctorName?: string;
  doctorLogoPath?: string;
  includeLogo?: boolean;
  labels: string[];
  originalLabels?: string[];
}

function LoadingFallback() {
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
  const { queue, clearQueue } = usePrintQueue() as { queue: QueuedItem[]; clearQueue: () => void };
  const location = useLocation();
  const { language } = useLanguage();

  // The header is persistent, always-translated chrome, so its writing direction
  // must follow the LANGUAGE — not the route-scoped `<html dir>` the watcher below
  // applies to the page body. Pinning `dir` on the header wrapper makes it a
  // stable RTL island in Arabic regardless of route; without it the header would
  // flip LTR⇄RTL (buttons jumping) every time you navigate between a translated
  // (RTL) and an untranslated (LTR) screen. postcss-rtlcss `[dir="rtl"] …`
  // descendant rules match via this ancestor, so no CSS change is needed.
  const headerDir = LANGUAGES[language].dir;

  // Route-scoped RTL: `<html dir>` flips to rtl only on translated routes (and
  // only when the language is RTL). LanguageContext handles language-change /
  // cross-tab updates for the current path; this watcher handles the OTHER axis
  // — navigation — re-applying dir as the user moves between translated (RTL)
  // and not-yet-translated (LTR) screens. Uses the language tracked in
  // core/language.ts, so no dependency on the language here. See RTL_ROUTES.
  useEffect(() => {
    applyDirectionForPath(location.pathname);
  }, [location.pathname]);

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

      {/* Persistent header - always mounted. `dir` follows the language (not the
          route) so the translated header doesn't flip between screens — see headerDir. */}
      <div id="universal-header-root" dir={headerDir}>
        <UniversalHeader />
      </div>

      {/* Main content - routes render here */}
      <div id="app-container">
        <Suspense fallback={<LoadingFallback />}>
          <Outlet />
        </Suspense>
      </div>

      {/* Print Queue Indicator - floating UI */}
      <PrintQueueIndicator onPrintAll={handlePrintAll} />

      {/* Queue Print Modal - opened from indicator */}
      {showQueueModal && queue.length > 0 && (
        <LabelPreviewModal
          queueMode={true}
          queuedItems={queue}
          onClose={handleCloseModal}
          onQueuePrintSuccess={handleQueuePrintSuccess}
        />
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
