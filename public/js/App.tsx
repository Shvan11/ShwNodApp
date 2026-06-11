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

// Base styles - Design system foundation
// Two-tier design tokens: primitive (fixed) → semantic (light) → theme-dark
// (dark overrides, @media screen). Order matters — dark must follow semantic.
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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GlobalErrorBoundary } from './components/error-boundaries/GlobalErrorBoundary';
import routesConfig from './router/routes.config';

// ===================================
// REACT QUERY (audit M7/M8)
// ===================================
//
// The shared client for component-level server state (the appointments screen
// is the first migrated surface — useAppointments / useAppointmentsSync). It gives
// real cache invalidation (SSE → invalidateQueries, fixing the M7 dead
// cache-key no-op), automatic refetch on key change, request abort, and retry.
// The per-request timeout (M8) lives one layer down in core/http.ts, so it
// covers route loaders and direct fetches too — not just RQ-managed queries.
// Route *loaders* keep using apiLoader/fetchJSON (they run outside React); RQ is
// layered on top for live component data, per the staged session-4 plan.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000, // clinic data changes by the minute, not the second
      gcTime: 5 * 60_000,
      retry: 2, // transient network/5xx retry (idempotent reads)
      refetchOnWindowFocus: false, // refetch is driven by SSE + explicit triggers
    },
  },
});

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
