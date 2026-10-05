/**
 * Status Display Component
 * Shows different authentication status messages
 */

import { AUTH_STATES, type AuthState } from '../../hooks/useWhatsAppAuth';
import styles from '../../routes/WhatsAppAuth.module.css';

interface StatusContent {
  icon: string;
  title: string;
  message: string;
}

interface StatusDisplayProps {
  authState: AuthState;
  /**
   * False for a role that may not pair (`roleCaps().manageWhatsApp`): the pairing
   * states then say who does it instead of pointing at buttons the page doesn't
   * show (FE-F16-4).
   */
  canPair?: boolean;
}

/** What a role that can't pair sees in place of the QR / re-link screens. */
export const PAIRING_ELSEWHERE: StatusContent = {
  icon: '🔐',
  title: 'WhatsApp is not linked',
  message: 'Pairing is done by the front desk or an admin. Ask them to link the clinic\'s WhatsApp; this page updates by itself once they have.',
};

export const StatusDisplay = ({ authState, canPair = true }: StatusDisplayProps) => {
  const getStatusContent = (): StatusContent | null => {
    if (!canPair && (authState === AUTH_STATES.NEEDS_RELINK || authState === AUTH_STATES.QR_REQUIRED)) {
      return PAIRING_ELSEWHERE;
    }
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

      case AUTH_STATES.RESTORING:
        return {
          icon: '⏳',
          title: 'Restoring WhatsApp session…',
          message: canPair
            ? 'This can take up to two minutes. If it doesn\'t finish, use "Re-link Device" below to get a fresh QR code.'
            : 'This can take up to two minutes.',
        };

      case AUTH_STATES.NEEDS_RELINK:
        return {
          icon: '⚠️',
          title: 'WhatsApp session expired',
          message:
            'The saved session can no longer connect. Click "Re-link Device" below to get a new QR code, then scan it with your phone.',
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
