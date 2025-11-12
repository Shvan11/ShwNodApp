/**
 * Connection Status Footer Component
 * Shows connection status indicator
 */

import React from 'react';
import { AUTH_STATES } from '../../hooks/useWhatsAppAuth.js';

export const ConnectionStatusFooter = ({ authState }) => {
  const getConnectionStatus = () => {
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
    <footer className="auth-footer">
      <div className="connection-status" aria-live="polite">
        <span
          className={`connection-indicator ${status.connected ? 'connected' : 'disconnected'}`}
          aria-hidden="true"
        />
        <span className="connection-text">{status.text}</span>
      </div>
    </footer>
  );
};
