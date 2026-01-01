import { useWhatsAppAuth, AUTH_STATES } from '../hooks/useWhatsAppAuth';
import { StatusDisplay } from '../components/whatsapp-auth/StatusDisplay';
import { QRCodeDisplay } from '../components/whatsapp-auth/QRCodeDisplay';
import { SuccessDisplay } from '../components/whatsapp-auth/SuccessDisplay';
import { ErrorDisplay } from '../components/whatsapp-auth/ErrorDisplay';
import { ControlButtons } from '../components/whatsapp-auth/ControlButtons';
import { ConnectionStatusFooter } from '../components/whatsapp-auth/ConnectionStatusFooter';
import type { ReactNode } from 'react';

// WhatsApp auth page styles
import '../../css/components/whatsapp-auth.css';

export default function WhatsAppAuth() {
  const {
    authState,
    clientReady,
    qrCode,
    error,
    sessionRestorationProgress,
    actions
  } = useWhatsAppAuth();

  const renderContent = (): ReactNode => {
    switch (authState) {
      case AUTH_STATES.INITIALIZING:
      case AUTH_STATES.CONNECTING:
      case AUTH_STATES.CHECKING_SESSION:
      case AUTH_STATES.DISCONNECTED:
        return <StatusDisplay authState={authState} sessionRestorationProgress={sessionRestorationProgress} />;

      case AUTH_STATES.QR_REQUIRED:
        return <QRCodeDisplay qrCode={qrCode} />;

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
