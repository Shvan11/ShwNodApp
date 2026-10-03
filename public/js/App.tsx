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
import '../css/components/react-select.css';
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
import { installChunkSelfHealing } from './core/chunk-reload';

// ===================================
// REACT QUERY (audit M7/M8)
// ===================================
//
// The shared TanStack Query client now lives in ./query/client so route loaders
// (which run outside React) can prefetch into the same cache via loaderQuery.
// App.tsx just feeds it to the provider below. Defaults (staleTime/gcTime/retry/
// refetchOnWindowFocus) are documented there.

// ===================================
// STALE-CHUNK RECOVERY + ERROR REPORTING
// ===================================
//
// Chunk-load self-healing (the guarded one-time reload on failed lazy imports)
// lives in core/chunk-reload.ts — the error boundaries call into the same
// module for the render-path failures the window listeners can never see
// (React.lazy re-throws the import failure during render). Everything else
// browser-side that breaks is reported via core/error-reporter.ts, which skips
// only the fetch-type chunk messages the self-heal owns.
if (typeof window !== 'undefined') {
  installChunkSelfHealing();
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
 * - QueryClientProvider: the shared `queryClient` (query/client.ts)
 * - RouterProvider: Provides Data Router with loaders, actions, error handling
 * - RootLayout (in routes.config): GlobalStateProvider, ToastProvider, UniversalHeader
 *
 * Server state — React Query owns all of it (query/):
 * - Defaults in query/client.ts: staleTime 30 s, gcTime 5 min, no refetch on
 *   window focus, retry only transient failures.
 * - Route loaders are PREFETCHERS: they `ensureQueryData` the same `queryOptions`
 *   factories (query/queries.ts) the screens then `useQuery`, so first paint
 *   doesn't flash empty.
 * - A write invalidates the `qk` keys it changed. `query/useApiMutation.ts` is the
 *   standard for new mutations: the keys sit next to the write (an `invalidate`
 *   option, not a separate statement to forget) and are awaited before the
 *   caller's onSuccess runs.
 *
 * Real-time:
 * - SSE singletons (services/sse-*.ts) push hints that invalidate the daily
 *   appointments and WhatsApp keys; GlobalStateContext carries the auth user and
 *   the WhatsApp client status.
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
