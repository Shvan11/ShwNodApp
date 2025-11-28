/**
 * Global Error Boundary
 *
 * Top-level error boundary that wraps the entire application.
 * Catches any unhandled errors and provides a user-friendly error screen.
 */
import React from 'react';
import { ErrorBoundary } from './ErrorBoundary.jsx';

const GlobalErrorFallback = () => (
  <div className="global-error-screen">
    <div className="global-error-content">
      <div className="error-icon">🚨</div>
      <h1>Application Error</h1>
      <p>We're sorry, but something went wrong with the application.</p>
      <p>The error has been logged and our team will look into it.</p>

      <div className="error-actions">
        <button
          onClick={() => window.location.reload()}
          className="primary-btn"
        >
          Reload Application
        </button>
        <button
          onClick={() => {
            // Clear local storage and reload
            localStorage.clear();
            window.location.reload();
          }}
          className="secondary-btn"
        >
          Reset and Reload
        </button>
      </div>

      <div className="help-text">
        <p>
          <small>
            If this problem persists, please contact support or try clearing
            your browser cache.
          </small>
        </p>
      </div>
    </div>

    <style jsx>{`
      .global-error-screen {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        padding: 20px;
      }

      .global-error-content {
        max-width: 500px;
        text-align: center;
        background: white;
        padding: 60px 40px;
        border-radius: 12px;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
      }

      .error-icon {
        font-size: 80px;
        margin-bottom: 20px;
        animation: pulse 2s ease-in-out infinite;
      }

      @keyframes pulse {
        0%,
        100% {
          transform: scale(1);
        }
        50% {
          transform: scale(1.1);
        }
      }

      .global-error-content h1 {
        color: #dc3545;
        margin-bottom: 15px;
        font-size: 32px;
        font-weight: 700;
      }

      .global-error-content p {
        color: #666;
        margin-bottom: 15px;
        font-size: 16px;
        line-height: 1.6;
      }

      .error-actions {
        display: flex;
        gap: 15px;
        justify-content: center;
        margin: 30px 0 20px;
        flex-wrap: wrap;
      }

      .error-actions button {
        padding: 12px 30px;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 16px;
        font-weight: 600;
        transition: all 0.3s;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .primary-btn {
        background-color: #007bff;
        color: white;
      }

      .primary-btn:hover {
        background-color: #0056b3;
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 123, 255, 0.3);
      }

      .secondary-btn {
        background-color: #6c757d;
        color: white;
      }

      .secondary-btn:hover {
        background-color: #545b62;
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(108, 117, 125, 0.3);
      }

      .help-text {
        margin-top: 20px;
        padding-top: 20px;
        border-top: 1px solid #dee2e6;
      }

      .help-text p small {
        color: #999;
        font-size: 14px;
      }
    `}</style>
  </div>
);

export function GlobalErrorBoundary({ children }) {
  return (
    <ErrorBoundary fallback={<GlobalErrorFallback />} showDetails={false}>
      {children}
    </ErrorBoundary>
  );
}

export default GlobalErrorBoundary;
