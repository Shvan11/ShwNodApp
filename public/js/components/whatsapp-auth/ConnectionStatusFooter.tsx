/**
 * Connection Status Footer Component
 * Shows connection status indicator
 */

import { AUTH_STATES, AuthState } from '../../hooks/useWhatsAppAuth';
import styles from '../../routes/WhatsAppAuth.module.css';

interface ConnectionStatus {
  text: string;
  connected: boolean;
}

interface ConnectionStatusFooterProps {
  authState: AuthState;
}

export const ConnectionStatusFooter = ({ authState }: ConnectionStatusFooterProps) => {
  const getConnectionStatus = (): ConnectionStatus => {
    switch (authState) {
      case AUTH_STATES.INITIALIZING:
        return { text: 'Initializing...', connected: false };
      case AUTH_STATES.CONNECTING:
        return { text: 'Connecting...', connected: false };
      case AUTH_STATES.CONNECTED:
      case AUTH_STATES.QR_REQUIRED:
      case AUTH_STATES.CHECKING_SESSION:
      case AUTH_STATES.AUTHENTICATED:
        return { text: 'Connected', connected: true };
      case AUTH_STATES.DISCONNECTED:
        return { text: 'Disconnected', connected: false };
      case AUTH_STATES.ERROR:
        return { text: 'Connection Error', connected: false };
      default:
        return { text: 'Unknown', connected: false };
    }
  };

  const status = getConnectionStatus();

  return (
    <footer className={styles.authFooter}>
      <div className={styles.connectionStatus} aria-live="polite">
        <span
          className={`${styles.connectionIndicator} ${status.connected ? styles.connected : ''}`}
          aria-hidden="true"
        />
        <span className={styles.connectionText}>{status.text}</span>
      </div>
    </footer>
  );
};
