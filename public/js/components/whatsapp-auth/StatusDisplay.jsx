/**
 * Status Display Component
 * Shows different authentication status messages
 */

import React from 'react';
import { AUTH_STATES } from '../../hooks/useWhatsAppAuth.js';

export const StatusDisplay = ({ authState }) => {
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
      </div>
    </div>
  );
};
