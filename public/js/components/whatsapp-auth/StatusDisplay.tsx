/**
 * Status Display Component
 * Shows different authentication status messages
 */

import { AUTH_STATES, AuthState, SessionRestorationProgress } from '../../hooks/useWhatsAppAuth';

interface StatusContent {
  icon: string;
  title: string;
  message: string;
  progress?: boolean;
  elapsed?: number;
  maxWait?: number;
}

interface StatusDisplayProps {
  authState: AuthState;
  sessionRestorationProgress?: SessionRestorationProgress | null;
}

export const StatusDisplay = ({ authState, sessionRestorationProgress }: StatusDisplayProps) => {
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
        if (sessionRestorationProgress) {
          const elapsed = (sessionRestorationProgress.elapsed as number) || 0;
          const maxWait = (sessionRestorationProgress.maxWait as number) || 30;
          return {
            icon: '🔍',
            title: 'Restoring WhatsApp Session...',
            message: `Attempting to restore existing session... ${elapsed}s / ${maxWait}s`,
            progress: true,
            elapsed,
            maxWait,
          };
        }
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
    <div className="auth-status" role="status" aria-live="polite" aria-atomic="true">
      <div className="status-icon-container">
        <span className="status-icon" aria-hidden="true">
          {content.icon}
        </span>
      </div>
      <div className="status-text">
        <h2>{content.title}</h2>
        <p>{content.message}</p>
        {content.progress && content.elapsed !== undefined && content.maxWait !== undefined && (
          <div className="session-restoration-progress">
            <div className="progress-bar">
              <div
                className="progress-bar-fill"
                style={{ width: `${(content.elapsed / content.maxWait) * 100}%` }}
              />
            </div>
            <p className="progress-note">
              If session restoration fails, a QR code will be displayed for re-authentication.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
