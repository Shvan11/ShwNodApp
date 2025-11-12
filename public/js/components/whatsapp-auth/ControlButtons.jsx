/**
 * Control Buttons Component
 * Action buttons for WhatsApp authentication
 */

import React from 'react';
import { AUTH_STATES } from '../../hooks/useWhatsAppAuth.js';

export const ControlButtons = ({ authState, actions }) => {
  const {
    handleRetry,
    handleRefreshQR,
    handleRestart,
    handleDestroy,
    handleLogout
  } = actions;

  const showRetry = authState === AUTH_STATES.ERROR || authState === AUTH_STATES.DISCONNECTED;
  const showRefresh = authState === AUTH_STATES.QR_REQUIRED;
  const showClientControls =
    authState === AUTH_STATES.AUTHENTICATED ||
    authState === AUTH_STATES.QR_REQUIRED ||
    authState === AUTH_STATES.ERROR;
  const showLogout =
    authState === AUTH_STATES.AUTHENTICATED ||
    authState === AUTH_STATES.QR_REQUIRED;

  return (
    <div className="auth-actions">
      {showRetry && (
        <button onClick={handleRetry} className="btn btn-secondary">
          <span className="btn-icon" aria-hidden="true">🔄</span>
          <span>Retry Connection</span>
        </button>
      )}

      {showRefresh && (
        <button onClick={handleRefreshQR} className="btn btn-primary">
          <span className="btn-icon" aria-hidden="true">📱</span>
          <span>Refresh QR Code</span>
        </button>
      )}

      {showClientControls && (
        <>
          <button onClick={handleRestart} className="btn btn-success">
            <span className="btn-icon" aria-hidden="true">🔄</span>
            <span>Restart Client</span>
          </button>

          <button onClick={handleDestroy} className="btn btn-warning">
            <span className="btn-icon" aria-hidden="true">⏹️</span>
            <span>Close Browser</span>
          </button>
        </>
      )}

      {showLogout && (
        <button onClick={handleLogout} className="btn btn-danger">
          <span className="btn-icon" aria-hidden="true">🚪</span>
          <span>Logout WhatsApp</span>
        </button>
      )}
    </div>
  );
};
