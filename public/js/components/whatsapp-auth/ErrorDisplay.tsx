/**
 * Error Display Component
 * Shows error messages
 */

interface ErrorDisplayProps {
  error: string | null;
}

export const ErrorDisplay = ({ error }: ErrorDisplayProps) => {
  return (
    <div className="error-section">
      <div className="error-icon-container">
        <span className="error-icon" aria-hidden="true">
          ❌
        </span>
      </div>
      <div className="error-content">
        <h2>Connection Error</h2>
        <p>{error || 'Unable to connect to WhatsApp client'}</p>
      </div>
    </div>
  );
};
