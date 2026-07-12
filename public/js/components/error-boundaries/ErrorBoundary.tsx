/**
 * Reusable Error Boundary Component
 *
 * Catches JavaScript errors anywhere in the child component tree and
 * displays a fallback UI instead of crashing the entire app.
 *
 * Usage:
 * <ErrorBoundary fallback={<CustomErrorUI />}>
 *   <YourComponent />
 * </ErrorBoundary>
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useNavigate, useLocation, type NavigateFunction } from 'react-router-dom';
import { reportClientError } from '../../core/error-reporter';
import { selfHealChunkError } from '../../core/chunk-reload';
import styles from './ErrorBoundary.module.css';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  showDetails?: boolean;
  onReset?: () => void;
  navigate?: NavigateFunction;
  /** When this value changes, a caught error is cleared (e.g. route pathname). */
  resetKey?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(_error: Error): Partial<ErrorBoundaryState> {
    // Update state so next render shows fallback UI
    return { hasError: true };
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    // Auto-clear the error when the route (resetKey) changes, so navigating
    // away from a crashed screen doesn't leave the user stuck on the fallback.
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null, errorInfo: null });
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log error details for debugging
    console.error('[ErrorBoundary] Caught error:', error);
    console.error('[ErrorBoundary] Error info:', errorInfo);

    // Store error details in state
    this.setState({
      error,
      errorInfo,
    });

    // Failed lazy-chunk imports land HERE, not in the window listeners — React
    // captures the import rejection and re-throws it during render. One guarded
    // reload self-heals a stale tab; when the reload is already spent, fall
    // through and report: a chunk that still fails after reloading is an
    // incident (bad deploy, asset-route regression), not deploy noise.
    if (selfHealChunkError(String(error?.message ?? ''), 'render-boundary') === 'reloading') {
      return;
    }

    // Ship to prod error reporting so a render crash lands in the server logs
    // instead of dying in this user's console (fire-and-forget; never throws).
    reportClientError({
      source: 'react-render',
      message: error?.message ?? 'Render error',
      stack: error?.stack,
      componentStack: errorInfo?.componentStack ?? undefined,
    });
  }

  handleReset = (): void => {
    // Reset error state
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });

    // Call custom reset handler if provided
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // Custom fallback UI provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default fallback UI
      return (
        <div className={styles.errorBoundaryFallback}>
          <div className={styles.errorBoundaryContent}>
            <div className={styles.errorIcon}>⚠️</div>
            <h2>Something went wrong</h2>
            <p>An error occurred while rendering this component.</p>

            {this.props.showDetails && this.state.error && (
              <details className={styles.errorDetails}>
                <summary>Error details (for developers)</summary>
                <pre className={styles.errorMessage}>
                  {this.state.error.toString()}
                </pre>
                {this.state.errorInfo && (
                  <pre className={styles.errorStack}>
                    {this.state.errorInfo.componentStack}
                  </pre>
                )}
              </details>
            )}

            <div className={styles.errorActions}>
              <button onClick={this.handleReset} className={styles.retryBtn}>
                Try Again
              </button>
              <button onClick={() => { this.handleReset(); this.props.navigate?.('/'); }} className={styles.reloadBtn}>
                Return to Dashboard
              </button>
              <button onClick={() => this.props.navigate?.('/')} className={styles.homeBtn}>
                Go to Dashboard
              </button>
            </div>
          </div>
        </div>
      );
    }

    // No error - render children normally
    return this.props.children;
  }
}

// Props interface for the wrapper component
interface ErrorBoundaryWithNavigateProps {
  children: ReactNode;
  fallback?: ReactNode;
  showDetails?: boolean;
  onReset?: () => void;
}

// Wrapper component to provide navigate function via hooks
function ErrorBoundaryWithNavigate(props: ErrorBoundaryWithNavigateProps) {
  const navigate = useNavigate();
  const location = useLocation();
  return <ErrorBoundary {...props} navigate={navigate} resetKey={location.pathname} />;
}

export default ErrorBoundaryWithNavigate;
