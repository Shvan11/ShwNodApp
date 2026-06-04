/**
 * Connection Status Component
 * Displays connection and client status
 */

import { UI_STATES, type UIState } from '../../utils/whatsapp-send-constants';
import type { SendingProgress } from './ProgressBar';
import styles from '../../routes/WhatsAppSend.module.css';

interface ConnectionStatusProps {
  connectionStatus: UIState;
  clientReady: boolean;
  sendingProgress: SendingProgress;
}

export default function ConnectionStatus({
  connectionStatus,
  clientReady,
  sendingProgress,
}: ConnectionStatusProps) {
  const getStatusText = (): string => {
    if (sendingProgress.started && !sendingProgress.finished && sendingProgress.total > 0) {
      return `📤 Sending messages... ${sendingProgress.sent}/${sendingProgress.total}`;
    }

    if (sendingProgress.finished && sendingProgress.total > 0) {
      return `✅ Completed! ${sendingProgress.sent} delivered, ${sendingProgress.failed} failed`;
    }

    if (clientReady) {
      return '✅ WhatsApp client is ready!';
    } else if (connectionStatus === UI_STATES.ERROR) {
      return '❌ Connection error';
    } else if (connectionStatus === UI_STATES.CONNECTING) {
      return '🔄 Connecting...';
    } else if (connectionStatus === UI_STATES.DISCONNECTED) {
      return '🔌 Disconnected from server';
    } else {
      return '🔐 WhatsApp authentication required';
    }
  };

  const getStatusClass = (): string => {
    if (sendingProgress.started && !sendingProgress.finished) {
      return 'connection-status-sending';
    }
    if (connectionStatus === UI_STATES.CONNECTED || clientReady) {
      return 'connection-status-connected';
    }
    if (connectionStatus === UI_STATES.ERROR) {
      return 'connection-status-error';
    }
    return 'connection-status-disconnected';
  };

  return (
    <div
      id="state"
      className={`${styles.statusPanel} ${getStatusClass()}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className={styles.statusIcon} aria-hidden="true"></span>
      <span>{getStatusText()}</span>
    </div>
  );
}
