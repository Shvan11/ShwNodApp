/**
 * Route Error Boundary
 *
 * Mid-level error boundary for route components.
 * Catches errors within a specific route without crashing the entire app.
 * Allows users to navigate to other routes even if one route fails.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import ErrorBoundary from './ErrorBoundary.jsx';

const RouteErrorFallback = ({ routeName }) => {
  const navigate = useNavigate();

  return (
    <div className="route-error-screen">
      <div className="route-error-content">
        <div className="error-icon">⚠️</div>
        <h2>Page Error</h2>
        <p>
          An error occurred while loading{' '}
          {routeName ? `the ${routeName} page` : 'this page'}.
        </p>
        <p>
          The rest of the application is still working. You can navigate to
          other pages.
        </p>

        <div className="error-actions">
          <button onClick={() => window.location.reload()} className="primary-btn">
            Reload Page
          </button>
          <button onClick={() => navigate('/')} className="secondary-btn">
            Go to Dashboard
          </button>
          <button onClick={() => navigate(-1)} className="tertiary-btn">
            Go Back
          </button>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{__html: `
        .route-error-screen {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: calc(100vh - 50px);
          padding: 40px 20px;
          background-color: #f8f9fa;
        }

        .route-error-content {
          max-width: 500px;
          text-align: center;
          background: white;
          padding: 50px 40px;
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }

        .error-icon {
          font-size: 72px;
          margin-bottom: 20px;
        }

        .route-error-content h2 {
          color: #dc3545;
          margin-bottom: 15px;
          font-size: 28px;
          font-weight: 600;
        }

        .route-error-content p {
          color: #666;
          margin-bottom: 15px;
          font-size: 16px;
          line-height: 1.6;
        }

        .error-actions {
          display: flex;
          gap: 12px;
          justify-content: center;
          margin-top: 30px;
          flex-wrap: wrap;
        }

        .error-actions button {
          padding: 12px 24px;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 15px;
          font-weight: 500;
          transition: all 0.2s;
        }

        .primary-btn {
          background-color: #007bff;
          color: white;
        }

        .primary-btn:hover {
          background-color: #0056b3;
          transform: translateY(-1px);
        }

        .secondary-btn {
          background-color: #28a745;
          color: white;
        }

        .secondary-btn:hover {
          background-color: #218838;
          transform: translateY(-1px);
        }

        .tertiary-btn {
          background-color: #6c757d;
          color: white;
        }

        .tertiary-btn:hover {
          background-color: #545b62;
          transform: translateY(-1px);
        }
      `}} />
    </div>
  );
};

export function RouteErrorBoundary({ children, routeName }) {
  return (
    <ErrorBoundary fallback={<RouteErrorFallback routeName={routeName} />}>
      {children}
    </ErrorBoundary>
  );
}

export default RouteErrorBoundary;
