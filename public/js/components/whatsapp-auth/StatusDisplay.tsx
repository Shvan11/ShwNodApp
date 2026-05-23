/**
 * Status Display Component
 * Shows different authentication status messages
 */

import { AUTH_STATES, AuthState } from '../../hooks/useWhatsAppAuth';
import styles from '../../routes/WhatsAppAuth.module.css';

interface StatusContent {
  icon: string;
  title: string;
  message: string;
}

interface StatusDisplayProps {
  authState: AuthState;
}

export const StatusDisplay = ({ authState }: StatusDisplayProps) => {
  const getStatusContent = (): StatusContent | null => {
    switch (authState) {
      case AUTH_STATES.INITIALIZING:
        return {
          icon: '⏳',
          title: 'Initializing WhatsApp Client...',
          message: 'Connecting to WhatsApp service',
        };

      case AUTH_STATES.CONNECTING:
        return {
          icon: '🔄',
          title: 'Connecting...',
          message: 'Establishing connection to server',
        };

      case AUTH_STATES.CHECKING_SESSION:
        return {
          icon: '🔍',
          title: 'Checking for Existing Session...',
          message: 'Looking for saved WhatsApp authentication',
        };

      case AUTH_STATES.DISCONNECTED:
        return {
          icon: '🔌',
          title: 'Disconnected',
          message: 'Connection to server lost. Attempting to reconnect...',
        };

      default:
        return null;
    }
  };

  const content = getStatusContent();

  if (!content) return null;

  return (
    <div className={styles.authStatus} role="status" aria-live="polite" aria-atomic="true">
      <div className={styles.statusIconContainer}>
        <span className={styles.statusIcon} aria-hidden="true">
          {content.icon}
        </span>
      </div>
      <div className={styles.statusText}>
        <h2>{content.title}</h2>
        <p>{content.message}</p>
      </div>
    </div>
  );
};
