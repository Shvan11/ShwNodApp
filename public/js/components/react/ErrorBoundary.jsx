import React from 'react';

/**
 * Error Boundary Component
 * Catches JavaScript errors in child components and displays fallback UI
 * Prevents the entire app from crashing due to component errors
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorCount: 0
    };
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    // Log the error to console
    console.error('❌ [ErrorBoundary] Caught error:', error, errorInfo);

    // Update state with error details
    this.setState(prevState => ({
      error,
      errorInfo,
      errorCount: prevState.errorCount + 1
    }));

    // Log to monitoring service if available
    if (window.logErrorToService) {
      window.logErrorToService(error, errorInfo);
    }
  }

  handleReset = () => {
    // Reset error state
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null
    });

    // Call custom reset handler if provided
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  render() {
    if (this.state.hasError) {
      // Fallback UI
      const { fallback, componentName = 'Component' } = this.props;

      // Custom fallback if provided
      if (fallback) {
        return fallback;
      }

      // Default fallback UI
      return (
        <div style={{
          padding: 'var(--spacing-xl)',
          textAlign: 'center',
          backgroundColor: 'var(--background-secondary)',
          borderRadius: 'var(--radius-lg)',
          border: '2px solid var(--error-color)',
          margin: 'var(--spacing-md)'
        }}>
          <h2 style={{ color: 'var(--error-color)', marginBottom: 'var(--spacing-md)' }}>
            ⚠️ Something went wrong
          </h2>
          <p style={{ marginBottom: 'var(--spacing-md)', color: 'var(--text-secondary)' }}>
            {componentName} encountered an error and couldn't render.
          </p>

          {this.state.errorCount > 3 && (
            <div style={{
              padding: 'var(--spacing-md)',
              backgroundColor: 'var(--warning-color)',
              borderRadius: 'var(--radius-md)',
              marginBottom: 'var(--spacing-md)',
              color: 'white'
            }}>
              <strong>⚠️ Multiple errors detected ({this.state.errorCount})</strong>
              <p style={{ marginTop: 'var(--spacing-sm)', fontSize: 'var(--font-size-sm)' }}>
                Consider refreshing the page or contacting support
              </p>
            </div>
          )}

          <button
            onClick={this.handleReset}
            style={{
              padding: 'var(--spacing-sm) var(--spacing-lg)',
              backgroundColor: 'var(--primary-color)',
              color: 'white',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
              fontSize: 'var(--font-size-base)',
              marginRight: 'var(--spacing-sm)'
            }}
          >
            Try Again
          </button>

          <button
            onClick={() => window.location.reload()}
            style={{
              padding: 'var(--spacing-sm) var(--spacing-lg)',
              backgroundColor: 'var(--secondary-color)',
              color: 'white',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
              fontSize: 'var(--font-size-base)'
            }}
          >
            Reload Page
          </button>

          {process.env.NODE_ENV === 'development' && this.state.error && (
            <details style={{
              marginTop: 'var(--spacing-lg)',
              textAlign: 'left',
              backgroundColor: 'var(--background-primary)',
              padding: 'var(--spacing-md)',
              borderRadius: 'var(--radius-md)',
              maxHeight: '300px',
              overflow: 'auto'
            }}>
              <summary style={{ cursor: 'pointer', fontWeight: 'bold', marginBottom: 'var(--spacing-sm)' }}>
                Error Details (Development Mode)
              </summary>
              <pre style={{
                fontSize: 'var(--font-size-sm)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word'
              }}>
                <strong>Error:</strong> {this.state.error.toString()}
                {'\n\n'}
                <strong>Component Stack:</strong>
                {this.state.errorInfo?.componentStack}
              </pre>
            </details>
          )}
        </div>
      );
    }

    // No error, render children normally
    return this.props.children;
  }
}

export default ErrorBoundary;
