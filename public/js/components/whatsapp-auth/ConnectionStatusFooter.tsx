/**
 * Connection Status Footer Component
 * Shows connection status indicator
 */

import { AUTH_STATES, type AuthState } from '../../hooks/useWhatsAppAuth';
import styles from '../../routes/WhatsAppAuth.module.css';

interface ConnectionStatus {
  text: string;
  connected: boolean;
}

interface ConnectionStatusFooterProps {
  authState: AuthState;
  /** The page's live stream is down and being retried — whatever the client's state. */
  streamDown: boolean;
}

export const ConnectionStatusFooter = ({ authState, streamDown }: ConnectionStatusFooterProps) => {
  const getConnectionStatus = (): ConnectionStatus => {
    // A ready client stays AUTHENTICATED over a dropped stream; the footer is
    // where the page admits its live updates have stopped (FE-F16-12).
    if (streamDown) return { text: 'Reconnecting to server…', connected: false };
    switch (authState) {
      case AUTH_STATES.INITIALIZING:
        return { text: 'Initializing...', connected: false };
      case AUTH_STATES.CONNECTING:
        return { text: 'Connecting...', connected: false };
      case AUTH_STATES.AUTHENTICATED:
        return { text: 'Connected', connected: true };
      case AUTH_STATES.RESTORING:
        return { text: 'Restoring session...', connected: false };
      case AUTH_STATES.NEEDS_RELINK:
        return { text: 'Re-link required', connected: false };
      case AUTH_STATES.QR_REQUIRED:
        return { text: 'Scan QR Code', connected: false };
      case AUTH_STATES.CHECKING_SESSION:
        return { text: 'Checking session...', connected: false };
      case AUTH_STATES.DISCONNECTED:
        return { text: 'Disconnected', connected: false };
      case AUTH_STATES.ERROR:
        return { text: 'Connection Error', connected: false };
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
