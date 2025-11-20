/**
 * Status Display Component
 * Shows different authentication status messages
 */

import React from 'react';
import { AUTH_STATES } from '../../hooks/useWhatsAppAuth.js';

export const StatusDisplay = ({ authState, sessionRestorationProgress }) => {
  const getStatusContent = () => {
    switch (authState) {
      case AUTH_STATES.INITIALIZING:
        return {
          icon: '⏳',
          title: 'Initializing WhatsApp Client...',
          message: 'Connecting to WhatsApp service'
        };

      case AUTH_STATES.CONNECTING:
        return {
          icon: '🔄',
          title: 'Connecting...',
          message: 'Establishing connection to server'
        };

      case AUTH_STATES.CHECKING_SESSION:
        // Show progress if available
        if (sessionRestorationProgress) {
          const { elapsed, maxWait } = sessionRestorationProgress;
          return {
            icon: '🔍',
            title: 'Restoring WhatsApp Session...',
            message: `Attempting to restore existing session... ${elapsed}s / ${maxWait}s`,
            progress: true,
            elapsed,
            maxWait
          };
        }
        return {
          icon: '🔍',
          title: 'Checking for Existing Session...',
          message: 'Looking for saved WhatsApp authentication'
        };

      case AUTH_STATES.DISCONNECTED:
        return {
          icon: '🔌',
          title: 'Disconnected',
          message: 'Connection to server lost. Attempting to reconnect...'
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
        <span className="status-icon" aria-hidden="true">{content.icon}</span>
      </div>
      <div className="status-text">
        <h2>{content.title}</h2>
        <p>{content.message}</p>
        {content.progress && (
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
