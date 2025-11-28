/**
 * Root Layout for Data Router
 * Wraps all routes with:
 * - GlobalStateProvider (WebSocket, patient state)
 * - ToastProvider (notifications)
 * - UniversalHeader (persistent header)
 * - Suspense (lazy loading)
 */
import React, { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
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
  const location = useLocation();
  const scrollPositions = React.useRef({});

  // Disable browser's native scroll restoration
  React.useEffect(() => {
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }
  }, []);

  // Save scroll position on route change
  React.useEffect(() => {
    return () => {
      if (location.pathname === '/appointments') {
        scrollPositions.current['/appointments'] = window.scrollY;
        console.log('[Scroll] Saved scroll position:', window.scrollY);
      }
    };
  }, [location.pathname]);

  // Restore scroll position after route change
  React.useEffect(() => {
    if (location.pathname === '/appointments' && scrollPositions.current['/appointments']) {
      const savedY = scrollPositions.current['/appointments'];
      console.log('[Scroll] Restoring to:', savedY);
      window.scrollTo(0, savedY);
    } else if (location.pathname !== '/appointments') {
      console.log('[Scroll] Scrolling to top');
      window.scrollTo(0, 0);
    }
  }, [location.pathname]);

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
      </GlobalStateProvider>
    </ToastProvider>
  );
}

export default RootLayout;
