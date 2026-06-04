/**
 * Route Error Boundary
 *
 * Mid-level error boundary for route components.
 * Catches errors within a specific route without crashing the entire app.
 * Allows users to navigate to other routes even if one route fails.
 */
import { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import ErrorBoundary from './ErrorBoundary';
import styles from './RouteErrorBoundary.module.css';

interface RouteErrorFallbackProps {
  routeName?: string;
}

function RouteErrorFallback({ routeName }: RouteErrorFallbackProps) {
  const navigate = useNavigate();

  return (
    <div className={styles.routeErrorScreen}>
      <div className={styles.routeErrorContent}>
        <div className={styles.errorIcon}>⚠️</div>
        <h2>Page Error</h2>
        <p>
          An error occurred while loading{' '}
          {routeName ? `the ${routeName} page` : 'this page'}.
        </p>
        <p>
          The rest of the application is still working. You can navigate to
          other pages.
        </p>

        <div className={styles.errorActions}>
          <button onClick={() => window.location.reload()} className={styles.primaryBtn}>
            Reload Page
          </button>
          <button onClick={() => navigate('/')} className={styles.secondaryBtn}>
            Go to Dashboard
          </button>
          <button onClick={() => navigate(-1)} className={styles.tertiaryBtn}>
            Go Back
          </button>
        </div>
      </div>
    </div>
  );
}

interface RouteErrorBoundaryProps {
  children: ReactNode;
  routeName?: string;
}

export function RouteErrorBoundary({ children, routeName }: RouteErrorBoundaryProps) {
  return (
    <ErrorBoundary fallback={<RouteErrorFallback routeName={routeName} />}>
      {children}
    </ErrorBoundary>
  );
}

export default RouteErrorBoundary;
