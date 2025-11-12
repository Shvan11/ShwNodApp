/**
 * WhatsApp Authentication App
 * React application for WhatsApp client authentication
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import singleSpaReact from 'single-spa-react';
import { useWhatsAppAuth, AUTH_STATES } from '../hooks/useWhatsAppAuth.js';
import { StatusDisplay } from '../components/whatsapp-auth/StatusDisplay.jsx';
import { QRCodeDisplay } from '../components/whatsapp-auth/QRCodeDisplay.jsx';
import { SuccessDisplay } from '../components/whatsapp-auth/SuccessDisplay.jsx';
import { ErrorDisplay } from '../components/whatsapp-auth/ErrorDisplay.jsx';
import { ControlButtons } from '../components/whatsapp-auth/ControlButtons.jsx';
import { ConnectionStatusFooter } from '../components/whatsapp-auth/ConnectionStatusFooter.jsx';

export default function WhatsAppAuthApp() {
  const {
    authState,
    clientReady,
    qrCode,
    error,
    actions
  } = useWhatsAppAuth();

  const renderContent = () => {
    switch (authState) {
      case AUTH_STATES.INITIALIZING:
      case AUTH_STATES.CONNECTING:
      case AUTH_STATES.CHECKING_SESSION:
      case AUTH_STATES.DISCONNECTED:
        return <StatusDisplay authState={authState} />;

      case AUTH_STATES.QR_REQUIRED:
        return <QRCodeDisplay qrCode={qrCode} onFetchQR={actions.fetchQRCode} />;

      case AUTH_STATES.AUTHENTICATED:
        return <SuccessDisplay />;

      case AUTH_STATES.ERROR:
        return <ErrorDisplay error={error} />;

      default:
        return <StatusDisplay authState={authState} />;
    }
  };

  return (
    <div className="auth-container">
      <header className="auth-header">
        <h1>WhatsApp Authentication</h1>
        <p className="auth-subtitle">Connect your WhatsApp to send messages</p>
      </header>

      <main className="auth-content">
        {renderContent()}
        <ControlButtons authState={authState} actions={actions} />
      </main>

      <ConnectionStatusFooter authState={authState} />

      {/* Fallback for JavaScript disabled */}
      <noscript>
        <div className="noscript-warning" role="alert">
          <h2>JavaScript Required</h2>
          <p>WhatsApp authentication requires JavaScript to function properly.</p>
          <p>Please enable JavaScript in your browser and refresh the page.</p>
          <button onClick={() => location.reload()}>Refresh Page</button>
        </div>
      </noscript>
    </div>
  );
}

// Single-SPA Lifecycle Exports
const lifecycles = singleSpaReact({
    React,
    ReactDOM,
    rootComponent: WhatsAppAuthApp,
    errorBoundary(err, info, props) {
        console.error('[WhatsAppAuthApp] Error:', err);
        return (
            <div className="error-boundary">
                <h2>WhatsApp Auth Error</h2>
                <p>Failed to load WhatsApp authentication. Please refresh the page.</p>
            </div>
        );
    },
});

export const { bootstrap, mount, unmount } = lifecycles;
