/**
 * Root Layout for Data Router
 * Wraps all routes with:
 * - GlobalStateProvider (WebSocket, patient state)
 * - ToastProvider (notifications)
 * - UniversalHeader (persistent header)
 * - Suspense (lazy loading)
 */
import { Suspense } from 'react';
import { Outlet, ScrollRestoration } from 'react-router-dom';
import { GlobalStateProvider } from '../contexts/GlobalStateContext.jsx';
import { ToastProvider } from '../contexts/ToastContext.jsx';
import UniversalHeader from '../components/react/UniversalHeader.jsx';

const LoadingFallback = () => (
  <div className="loading-fallback">
    <div className="loading-fallback-content">
      <div className="loading-spinner"></div>
      <p>Loading...</p>
    </div>
  </div>
);

export function RootLayout() {
  return (
    <ToastProvider>
      <GlobalStateProvider>
        {/* Persistent header - always mounted */}
        <div id="universal-header-root">
          <UniversalHeader />
        </div>

        {/* Main content - routes render here */}
        <div id="app-container">
          <Suspense fallback={<LoadingFallback />}>
            <Outlet />
          </Suspense>
        </div>

        {/* Native scroll restoration for route navigation */}
        <ScrollRestoration
          getKey={(location) => location.pathname + location.search}
        />
      </GlobalStateProvider>
    </ToastProvider>
  );
}

export default RootLayout;
