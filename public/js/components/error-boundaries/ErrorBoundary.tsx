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
import React, { Component, ErrorInfo, ReactNode } from 'react';
import { useNavigate, NavigateFunction } from 'react-router-dom';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  showDetails?: boolean;
  onReset?: () => void;
  navigate?: NavigateFunction;
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

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log error details for debugging
    console.error('[ErrorBoundary] Caught error:', error);
    console.error('[ErrorBoundary] Error info:', errorInfo);

    // Store error details in state
    this.setState({
      error,
      errorInfo,
    });

    // You can also log to an error reporting service here
    // Example: logErrorToService(error, errorInfo);
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
        <div className="error-boundary-fallback">
          <div className="error-boundary-content">
            <div className="error-icon">⚠️</div>
            <h2>Something went wrong</h2>
            <p>An error occurred while rendering this component.</p>

            {this.props.showDetails && this.state.error && (
              <details className="error-details">
                <summary>Error details (for developers)</summary>
                <pre className="error-message">
                  {this.state.error.toString()}
                </pre>
                {this.state.errorInfo && (
                  <pre className="error-stack">
                    {this.state.errorInfo.componentStack}
                  </pre>
                )}
              </details>
            )}

            <div className="error-actions">
              <button onClick={this.handleReset} className="retry-btn">
                Try Again
              </button>
              <button onClick={() => window.location.reload()} className="reload-btn">
                Reload Page
              </button>
              <button onClick={() => this.props.navigate?.('/')} className="home-btn">
                Go to Dashboard
              </button>
            </div>
          </div>

          <style>{`
            .error-boundary-fallback {
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 400px;
              padding: 40px 20px;
              background-color: #f8f9fa;
            }

            .error-boundary-content {
              max-width: 600px;
              text-align: center;
              background: white;
              padding: 40px;
              border-radius: 8px;
              box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            }

            .error-icon {
              font-size: 64px;
              margin-bottom: 20px;
            }

            .error-boundary-content h2 {
              color: #dc3545;
              margin-bottom: 10px;
              font-size: 24px;
            }

            .error-boundary-content p {
              color: #666;
              margin-bottom: 20px;
              font-size: 16px;
            }

            .error-details {
              margin: 20px 0;
              text-align: left;
              background: #f8f9fa;
              padding: 15px;
              border-radius: 4px;
              border: 1px solid #dee2e6;
            }

            .error-details summary {
              cursor: pointer;
              font-weight: 600;
              color: #495057;
              margin-bottom: 10px;
            }

            .error-message,
            .error-stack {
              background: #fff;
              padding: 10px;
              border-radius: 4px;
              border: 1px solid #dee2e6;
              overflow-x: auto;
              font-size: 12px;
              font-family: 'Courier New', monospace;
              color: #dc3545;
              margin: 10px 0;
            }

            .error-actions {
              display: flex;
              gap: 10px;
              justify-content: center;
              flex-wrap: wrap;
            }

            .error-actions button {
              padding: 10px 20px;
              border: none;
              border-radius: 4px;
              cursor: pointer;
              font-size: 14px;
              font-weight: 500;
              transition: all 0.2s;
            }

            .retry-btn {
              background-color: #007bff;
              color: white;
            }

            .retry-btn:hover {
              background-color: #0056b3;
            }

            .reload-btn {
              background-color: #6c757d;
              color: white;
            }

            .reload-btn:hover {
              background-color: #545b62;
            }

            .home-btn {
              background-color: #28a745;
              color: white;
            }

            .home-btn:hover {
              background-color: #218838;
            }
          `}</style>
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
  return <ErrorBoundary {...props} navigate={navigate} />;
}

export default ErrorBoundaryWithNavigate;
