/**
 * Control Buttons Component
 * Action buttons for WhatsApp authentication
 */

import { AUTH_STATES, AuthState, WhatsAppAuthActions } from '../../hooks/useWhatsAppAuth';
import styles from '../../routes/WhatsAppAuth.module.css';

interface ControlButtonsProps {
  authState: AuthState;
  actions: WhatsAppAuthActions;
}

export const ControlButtons = ({ authState, actions }: ControlButtonsProps) => {
  const { handleRetry, handleRefreshQR, handleRestart, handleDestroy, handleLogout } = actions;

  const showRetry = authState === AUTH_STATES.ERROR || authState === AUTH_STATES.DISCONNECTED;
  const showRefresh = authState === AUTH_STATES.QR_REQUIRED;
  const showClientControls =
    authState === AUTH_STATES.AUTHENTICATED ||
    authState === AUTH_STATES.QR_REQUIRED ||
    authState === AUTH_STATES.ERROR;
  const showLogout =
    authState === AUTH_STATES.AUTHENTICATED || authState === AUTH_STATES.QR_REQUIRED;

  return (
    <div className={styles.authActions}>
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
        <>
          <button onClick={handleRestart} className="btn btn-success">
            <span className={styles.btnIcon} aria-hidden="true">
              🔄
            </span>
            <span>Restart Client</span>
          </button>

          <button onClick={handleDestroy} className="btn btn-warning">
            <span className={styles.btnIcon} aria-hidden="true">
              ⏹️
            </span>
            <span>Close Browser</span>
          </button>
        </>
      )}

      {showLogout && (
        <button onClick={handleLogout} className="btn btn-danger">
          <span className={styles.btnIcon} aria-hidden="true">
            🚪
          </span>
          <span>Logout WhatsApp</span>
        </button>
      )}
    </div>
  );
};
