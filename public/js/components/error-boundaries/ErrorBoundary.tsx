/**
 * Reusable Error Boundary Component
 *
 * Catches JavaScript errors anywhere in the child component tree and renders
 * `fallback` instead of crashing the whole app. It is a CLASS on purpose: a
 * failed `React.lazy` chunk import is re-thrown during render and only a class
 * boundary can see it (a function boundary cannot).
 *
 * `fallback` is REQUIRED — the class used to carry its own default UI with
 * retry/home buttons, but both wrappers (GlobalErrorBoundary, RouteErrorBoundary)
 * always passed one, so the default, its `showDetails`/`onReset`/`navigate` props
 * and 109 lines of ErrorBoundary.module.css were unreachable and were removed in
 * the F3 audit. Use one of those two wrappers rather than this class directly.
 *
 * Usage:
 * <ErrorBoundary fallback={<CustomErrorUI />}>
 *   <YourComponent />
 * </ErrorBoundary>
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { reportClientError } from '../../core/error-reporter';
import { selfHealChunkError } from '../../core/chunk-reload';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Rendered in place of `children` once an error is caught. */
  fallback: ReactNode;
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

  render(): ReactNode {
    if (this.state.hasError) {
      return this.props.fallback;
    }

    // No error - render children normally
    return this.props.children;
  }
}

interface ErrorBoundaryWithResetProps {
  children: ReactNode;
  fallback: ReactNode;
}

/**
 * Router-aware wrapper: feeds the class the current pathname as its `resetKey`,
 * so navigating away from a crashed screen clears the error instead of leaving
 * the user stuck on the fallback. Must be rendered inside the router.
 */
function ErrorBoundaryWithReset(props: ErrorBoundaryWithResetProps) {
  const location = useLocation();
  return <ErrorBoundary {...props} resetKey={location.pathname} />;
}

export default ErrorBoundaryWithReset;
