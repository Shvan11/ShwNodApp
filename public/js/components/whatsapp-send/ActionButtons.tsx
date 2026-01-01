/**
 * Action Buttons Component
 * Primary action buttons for starting messages or authentication
 */

import { useNavigate, useLocation } from 'react-router-dom';
import type { SendingProgress } from './ProgressBar';

interface ActionButtonsProps {
  clientReady: boolean;
  onStartSending: () => void;
  sendingInProgress: boolean;
  sendingProgress: SendingProgress;
}

export default function ActionButtons({
  clientReady,
  onStartSending,
  sendingInProgress,
  sendingProgress,
}: ActionButtonsProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const handleLoginClick = () => {
    navigate('/auth', {
      state: {
        returnPath: location.pathname + location.search,
        timestamp: Date.now(),
      },
    });
  };

  const getButtonText = (): string => {
    if (sendingInProgress) {
      return `Sending ${sendingProgress.sent}/${sendingProgress.total}`;
    }
    return 'Start Sending Messages';
  };

  return (
    <div className="action-section">
      {clientReady ? (
        <button
          id="startButton"
          className="btn btn-primary primary-action"
          onClick={onStartSending}
          disabled={sendingInProgress}
          aria-describedby="send-instructions"
        >
          <span className="btn-icon" aria-hidden="true">
            📱
          </span>
          <span>{getButtonText()}</span>
        </button>
      ) : (
        <button
          id="authButton"
          className="btn btn-secondary"
          onClick={handleLoginClick}
          aria-label="Go to WhatsApp Authentication"
        >
          <span className="btn-icon" aria-hidden="true">
            🔐
          </span>
          <span>Go to Authentication</span>
        </button>
      )}
      <p id="send-instructions" className="help-text sr-only">
        Click to begin sending WhatsApp messages to selected date appointments
      </p>
    </div>
  );
}
