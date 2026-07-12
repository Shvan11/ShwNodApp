/**
 * Route Error Component for Data Router
 * Displays user-friendly error messages for loader/action failures.
 *
 * Also a chunk-recovery catch point: routes NOT wrapped in <RouteErrorBoundary>
 * (chair-display — the unattended kiosk — and RootLayout-level failures) land
 * here when a lazy chunk fails, so this component runs the same self-heal the
 * class ErrorBoundary does.
 */
import { useEffect } from 'react';
import { useRouteError, useNavigate, Link } from 'react-router-dom';
import { selfHealChunkError } from '../../core/chunk-reload';
import { reportClientError } from '../../core/error-reporter';

interface RouteErrorData {
  status?: number;
  statusText?: string;
  message?: string;
  data?: string;
  stack?: string;
}

interface ErrorDisplay {
  title: string;
  message: string;
  icon: string;
}

export function RouteError() {
  const error = useRouteError() as RouteErrorData;
  const navigate = useNavigate();

  console.error('[RouteError] Route error occurred:', error);

  // Chunk self-heal (side effect — must stay out of render). Loader failures
  // (401/404 Responses) have no chunk signature and fall straight through;
  // general route errors keep their existing no-report behavior here.
  useEffect(() => {
    const message = String(error?.message ?? '');
    if (selfHealChunkError(message, 'route-error-element') === 'reload-exhausted') {
      // Persisted past the reload — an incident (bad deploy, asset-route
      // regression), and this boundary is its only witness. Report it.
      reportClientError({ source: 'react-render', message, stack: error?.stack });
    }
  }, [error]);

  const getErrorMessage = (): ErrorDisplay => {
    if (error.status === 404) {
      return {
        title: 'Page Not Found',
        message: 'The page you are looking for does not exist.',
        icon: 'fas fa-search'
      };
    }

    if (error.status === 401) {
      return {
        title: 'Unauthorized',
        message: 'You need to log in to access this page.',
        icon: 'fas fa-lock'
      };
    }

    if (error.status === 500) {
      return {
        title: 'Server Error',
        message: error.data || 'An unexpected error occurred on the server.',
        icon: 'fas fa-exclamation-triangle'
      };
    }

    return {
      title: 'Error',
      message: error.statusText || error.message || 'An unexpected error occurred.',
      icon: 'fas fa-exclamation-circle'
    };
  };

  const { title, message, icon } = getErrorMessage();

  return (
    <div className="route-error-container">
      <div className="route-error-content">
        <i className={`${icon} route-error-icon`}></i>
        <h1>{title}</h1>
        <p>{message}</p>
        <div className="route-error-actions">
          <button
            className="btn btn-primary"
            onClick={() => navigate(-1)}
          >
            <i className="fas fa-arrow-left"></i>
            Go Back
          </button>
          <Link to="/" className="btn btn-secondary">
            <i className="fas fa-home"></i>
            Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

export default RouteError;
