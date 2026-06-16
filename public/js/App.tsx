/**
 * Unified React Application - Data Router Mode
 *
 * Features:
 * - Centralized route configuration in routes.config.tsx
 * - Route loaders for optimized data fetching
 * - Error boundaries per route
 * - SSE singletons for real-time updates
 *
 * Performance: Route loaders eliminate loading flashes for static data
 * Stability: Global + route-level error boundaries
 */

// ===================================
// GLOBAL CSS IMPORTS
// ===================================

// Third-party icon font — self-hosted via Vite (publicDir is disabled, so it
// must enter through the asset pipeline). Replaces the render-blocking cdnjs
// <link> that used to sit in index.html: same-origin, content-hashed, works
// offline/on-LAN. Used app-wide (`fa fa-*` classes + SimplifiedCalendarPicker's
// `font-family: "Font Awesome 6 Free"`), so it's legitimately critical CSS.
import '@fortawesome/fontawesome-free/css/all.min.css';

// Base styles - Design system foundation
// Two-tier design tokens: primitive (fixed) → semantic (light) → theme-dark
// (dark overrides, @media screen). Order matters — dark must follow semantic.
import '../css/base/fonts.css';
import '../css/base/reset.css';
import '../css/base/tokens-primitive.css';
import '../css/base/tokens-semantic.css';
import '../css/base/theme-dark.css';
import '../css/base/rtl-support.css';
import '../css/base/utilities.css';

// Universal components - Used across all routes
import '../css/layout/universal-header.css';
import '../css/components/buttons.css';
import '../css/components/inputs.css';
import '../css/components/modal.css';
import '../css/components/toast.css';
import '../css/components/route-error.css';
import '../css/components/calendar-holidays.css';

// ===================================
// END GLOBAL CSS IMPORTS
// ===================================

import { StrictMode } from 'react';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { GlobalErrorBoundary } from './components/error-boundaries/GlobalErrorBoundary';
import routesConfig from './router/routes.config';
import { queryClient } from './query/client';
import { installGlobalErrorReporting } from './core/error-reporter';

// ===================================
// REACT QUERY (audit M7/M8)
// ===================================
//
// The shared TanStack Query client now lives in ./query/client so route loaders
// (which run outside React) can prefetch into the same cache via loaderQuery.
// App.tsx just feeds it to the provider below. Defaults (staleTime/gcTime/retry/
// refetchOnWindowFocus) are documented there.

// ===================================
// STALE-CHUNK / TRANSIENT-FETCH RECOVERY
// ===================================
//
// Route components are lazy-loaded code-split chunks (e.g. DailyAppointments-*.js).
// A chunk fetch can fail for two reasons:
//   1. Stale tab after a redeploy — the open page references old hashed filenames
//      that no longer exist on disk, so the request 404s.
//   2. A transient network blip (QUIC idle-timeout / packet loss / DNS hiccup on
//      the LAN) drops the fetch mid-flight.
// Either way the dynamic import rejects and the page breaks until a manual reload.
// A one-time reload re-fetches a fresh index.html (with current chunk hashes) and
// re-establishes the connection. Guarded via sessionStorage so a genuinely-missing
// asset can never cause a reload loop.
if (typeof window !== 'undefined') {
  const RELOAD_FLAG = 'shwan_chunk_reload_ts';
  const RELOAD_COOLDOWN_MS = 10_000;

  const reloadOnce = (reason: string): void => {
    const last = Number(sessionStorage.getItem(RELOAD_FLAG) || 0);
    const now = Date.now();
    if (now - last < RELOAD_COOLDOWN_MS) {
      // Already reloaded moments ago and the chunk still won't load — the asset
      // is genuinely gone. Stop, and let the ErrorBoundary show its fallback.
      console.error(`[App] Module load still failing after reload (${reason}); not reloading again.`);
      return;
    }
    sessionStorage.setItem(RELOAD_FLAG, String(now));
    console.warn(`[App] Reloading once to recover from a failed module load (${reason}).`);
    window.location.reload();
  };

  // Vite dispatches this on the window when its preload helper (used by lazy
  // route imports) fails to fetch a chunk. preventDefault() stops Vite rethrowing.
  window.addEventListener('vite:preloadError', (event: Event) => {
    event.preventDefault();
    reloadOnce('vite:preloadError');
  });

  // Fallback: some chunk-load failures surface only as an unhandled rejection.
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const msg = String(event.reason?.message ?? event.reason ?? '');
    if (/dynamically imported module|Importing a module script failed|Failed to fetch dynamically|error loading dynamically imported module/i.test(msg)) {
      reloadOnce('unhandledrejection');
    }
  });

  // Report uncaught window errors + unhandled rejections (the classes React error
  // boundaries can't catch) to prod error reporting. Self-healing chunk-load errors
  // above are skipped inside the reporter.
  installGlobalErrorReporting();
}

// Create router instance with all configured routes and loaders
const router = createBrowserRouter(routesConfig, {
  future: {
    v7_startTransition: true, // Enable smooth transitions
  },
  window: typeof window !== 'undefined' ? window : undefined,
});

/**
 * Main Application Component - Data Router Mode
 *
 * Structure:
 * - GlobalErrorBoundary: Catches all app-level errors
 * - RouterProvider: Provides Data Router with loaders, actions, error handling
 * - RootLayout (in routes.config): GlobalStateProvider, ToastProvider, UniversalHeader
 *
 * Benefits vs BrowserRouter:
 * - Route loaders: Pre-fetch data before rendering (eliminates loading flashes)
 * - Better error handling: Route-level error pages with recovery options
 * - Native scroll restoration: Automatic scroll position management
 * - Pending states: Built-in navigation pending UI
 * - Centralized routing: All routes in routes.config.tsx
 *
 * Performance:
 * - Patient page load: 1.5s → 1s (33% faster with loaders)
 * - No loading flash for patient names, settings, doctor lists
 * - Parallel data loading (Promise.all in loaders)
 * - 5-minute cache for static data (patient info, work details)
 *
 * Real-time Updates:
 * - SSE singletons for realtime; shared client state in GlobalStateContext
 * - Appointments, messaging use component-level fetching
 * - Loaders only for static/cacheable data
 */
export default function App() {
  return (
    <StrictMode>
      <GlobalErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </GlobalErrorBoundary>
    </StrictMode>
  );
}
