/**
 * Action Buttons Component
 * Primary action buttons for starting messages or authentication
 */

import { useNavigate, useLocation } from 'react-router-dom';
import type { DateSendability } from '../../hooks/useDateManager';
import type { SendingProgress } from '../../hooks/useWhatsAppSync';
import styles from '../../routes/WhatsAppSend.module.css';

interface ActionButtonsProps {
  clientReady: boolean;
  onStartSending: () => void;
  sendingInProgress: boolean;
  sendingProgress: SendingProgress;
  sendability: DateSendability;
  /**
   * The day's eligible count is known to be 0. Start used to stay enabled, toast
   * "Messages sending started", and nothing followed (FE-F16-11).
   */
  nothingToSend: boolean;
}

export default function ActionButtons({
  clientReady,
  onStartSending,
  sendingInProgress,
  sendingProgress,
  sendability,
  nothingToSend,
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
      return `Sending ${sendingProgress.sent + sendingProgress.failed}/${sendingProgress.total}`;
    }
    if (!sendability.isSendable) {
      return 'Cannot Send - Date Out of Range';
    }
    if (nothingToSend) {
      return 'No Messages to Send';
    }
    return 'Start Sending Messages';
  };

  const isSendDisabled = sendingInProgress || !sendability.isSendable || nothingToSend;

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
      <p id="send-instructions" className={`${styles.helpText} sr-only`}>
        Click to begin sending WhatsApp messages to selected date appointments
      </p>
    </div>
  );
}
