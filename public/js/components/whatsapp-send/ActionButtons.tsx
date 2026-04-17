/**
 * Action Buttons Component
 * Primary action buttons for starting messages or authentication
 */

import { useNavigate, useLocation } from 'react-router-dom';
import type { DateSendability } from '../../hooks/useDateManager';
import type { SendingProgress } from './ProgressBar';
import styles from '../../routes/WhatsAppSend.module.css';

interface ActionButtonsProps {
  clientReady: boolean;
  onStartSending: () => void;
  sendingInProgress: boolean;
  sendingProgress: SendingProgress;
  sendability: DateSendability;
}

export default function ActionButtons({
  clientReady,
  onStartSending,
  sendingInProgress,
  sendingProgress,
  sendability,
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
    if (!sendability.isSendable) {
      return 'Cannot Send - Date Out of Range';
    }
    return 'Start Sending Messages';
  };

  const isSendDisabled = sendingInProgress || !sendability.isSendable;

  return (
    <div className={styles.actionSection}>
      {clientReady ? (
        <button
          id="startButton"
          className={`btn btn-primary ${styles.primaryAction}`}
          onClick={onStartSending}
          disabled={isSendDisabled}
          aria-describedby="send-instructions"
        >
          <span className={styles.btnIcon} aria-hidden="true">
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
          <span className={styles.btnIcon} aria-hidden="true">
            🔐
          </span>
          <span>Go to Authentication</span>
        </button>
      )}
      <p id="send-instructions" className={`${styles.helpText} ${styles.srOnly}`}>
        Click to begin sending WhatsApp messages to selected date appointments
      </p>
    </div>
  );
}
