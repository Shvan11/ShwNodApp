/**
 * Control Buttons Component
 * Action buttons for WhatsApp authentication
 */

import { AUTH_STATES, type AuthState, type WhatsAppAuthActions } from '../../hooks/useWhatsAppAuth';
import styles from '../../routes/WhatsAppAuth.module.css';

interface ControlButtonsProps {
  authState: AuthState;
  actions: WhatsAppAuthActions;
}

export const ControlButtons = ({ authState, actions }: ControlButtonsProps) => {
  const { handleRetry, handleRefreshQR, handleRestart, handleReLink } = actions;

  // Re-link (clear session → fresh QR) is the single session-clearing action: the
  // recovery for a poisoned/parked session, AND the way to sign out / switch number
  // when authenticated (it replaced the separate Logout button — same unlink() call).
  // PRIMARY when the server has parked the session (NEEDS_RELINK); secondary otherwise.
  const showRelink =
    authState === AUTH_STATES.NEEDS_RELINK ||
    authState === AUTH_STATES.RESTORING ||
    authState === AUTH_STATES.ERROR ||
    authState === AUTH_STATES.QR_REQUIRED ||
    authState === AUTH_STATES.AUTHENTICATED;
  const relinkIsPrimary = authState === AUTH_STATES.NEEDS_RELINK;

  const showRetry = authState === AUTH_STATES.ERROR || authState === AUTH_STATES.DISCONNECTED;
  const showRefresh = authState === AUTH_STATES.QR_REQUIRED;
  // Restart Client only makes sense once there's a live/authenticated client to act on
  // — NOT on the QR screen, where Restart calls the same restart() as Refresh QR (pure
  // duplicate). So QR_REQUIRED shows only Refresh QR + Re-link (the light refresh vs the
  // hard session-clearing reset).
  const showClientControls =
    authState === AUTH_STATES.AUTHENTICATED ||
    authState === AUTH_STATES.RESTORING ||
    authState === AUTH_STATES.ERROR;

  return (
    <div className={styles.authActions}>
      {showRelink && (
        <button
          onClick={handleReLink}
          className={relinkIsPrimary ? 'btn btn-primary' : 'btn btn-secondary'}
        >
          <span className={styles.btnIcon} aria-hidden="true">
            🔗
          </span>
          <span>Re-link Device (new QR)</span>
        </button>
      )}

      {showRetry && (
        <button onClick={handleRetry} className="btn btn-secondary">
          <span className={styles.btnIcon} aria-hidden="true">
            🔄
          </span>
          <span>Retry Connection</span>
        </button>
      )}

      {showRefresh && (
        <button onClick={handleRefreshQR} className="btn btn-primary">
          <span className={styles.btnIcon} aria-hidden="true">
            📱
          </span>
          <span>Refresh QR Code</span>
        </button>
      )}

      {showClientControls && (
        <button onClick={handleRestart} className="btn btn-success">
          <span className={styles.btnIcon} aria-hidden="true">
            🔄
          </span>
          <span>Restart Client</span>
        </button>
      )}
    </div>
  );
};
