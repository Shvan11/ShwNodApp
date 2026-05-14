import React from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import styles from './ErrorBoundary.module.css';

// Extend window interface for custom error logging
declare global {
    interface Window {
        logErrorToService?: (error: Error, errorInfo: ErrorInfo) => void;
    }
}

interface ErrorBoundaryProps {
    children: ReactNode;
    fallback?: ReactNode;
    componentName?: string;
    onReset?: () => void;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
    errorCount: number;
}

/**
 * Error Boundary Component
 * Catches JavaScript errors in child components and displays fallback UI
 * Prevents the entire app from crashing due to component errors
 */
class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = {
            hasError: false,
            error: null,
            errorInfo: null,
            errorCount: 0
        };
    }

    static getDerivedStateFromError(_error: Error): Partial<ErrorBoundaryState> {
        // Update state so the next render will show the fallback UI
        return { hasError: true };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
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
                <div className={styles.fallback}>
                    <h2 className={styles.title}>
                        ⚠️ Something went wrong
                    </h2>
                    <p className={styles.description}>
                        {componentName} encountered an error and couldn't render.
                    </p>

                    {this.state.errorCount > 3 && (
                        <div className={styles.repeatedErrorsNotice}>
                            <strong>⚠️ Multiple errors detected ({this.state.errorCount})</strong>
                            <p className={styles.repeatedErrorsHint}>
                                Consider refreshing the page or contacting support
                            </p>
                        </div>
                    )}

                    <button
                        onClick={this.handleReset}
                        className={`${styles.actionButton} ${styles.actionButtonPrimary}`}
                    >
                        Try Again
                    </button>

                    <button
                        onClick={() => window.location.reload()}
                        className={`${styles.actionButton} ${styles.actionButtonSecondary}`}
                    >
                        Reload Page
                    </button>

                    {import.meta.env.DEV && this.state.error && (
                        <details className={styles.errorDetails}>
                            <summary className={styles.errorDetailsSummary}>
                                Error Details (Development Mode)
                            </summary>
                            <pre className={styles.errorDetailsPre}>
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
