import { useEffect, useRef } from 'react';
import { postJSON } from '@/core/http';
import { roleCaps, type UserRole } from '@shared/auth/roles';
import { useAuthUser } from '../contexts/GlobalStateContext';
import { useWhatsAppAuth, AUTH_STATES } from '../hooks/useWhatsAppAuth';
import { StatusDisplay } from '../components/whatsapp-auth/StatusDisplay';
import { QRCodeDisplay } from '../components/whatsapp-auth/QRCodeDisplay';
import { SuccessDisplay } from '../components/whatsapp-auth/SuccessDisplay';
import { ErrorDisplay } from '../components/whatsapp-auth/ErrorDisplay';
import { ControlButtons } from '../components/whatsapp-auth/ControlButtons';
import { ConnectionStatusFooter } from '../components/whatsapp-auth/ConnectionStatusFooter';
import type { ReactNode } from 'react';

// WhatsApp auth page styles - CSS Module
import styles from './WhatsAppAuth.module.css';

export default function WhatsAppAuth() {
  const {
    authState,
    qrCode,
    error,
    streamDown,
    afterPairing,
    actions
  } = useWhatsAppAuth();

  // Pairing, restarting and re-linking are front-desk/admin (the server gates
  // them, and withholds the QR from other roles). A doctor or assistant sees the
  // client's state and who to ask, not buttons that 403 and a QR that never
  // comes (FE-F16-4; owner decision 2026-10-04).
  const user = useAuthUser();
  const canPair = roleCaps(user?.role as UserRole | undefined).manageWhatsApp;

  // Dev-only: kick off backend init once on page mount. Server-boot
  // auto-init is off in dev (.env.development sets WHATSAPP_AUTO_INIT=false)
  // to avoid Ctrl+C corrupting the WA Web session, so this page is where
  // on-demand init happens. Production is untouched: import.meta.env.DEV is
  // false in prod builds and this effect compiles out.
  //
  // Uses POST /api/wa/initialize (fire-and-forget, returns 200 immediately)
  // rather than /api/wa/restart, which awaits the whole init synchronously and
  // 408s against the 30s global request timeout for a session-restore that takes
  // longer than that. It is a POST because starting the client is a mutation —
  // the GET twin that used to serve this call was removed (a state-changing GET
  // is exempt from csurf while the session cookie is sameSite: 'lax').
  const initRequestedRef = useRef(false);
  useEffect(() => {
    if (!import.meta.env.DEV || !canPair) return;
    if (initRequestedRef.current) return;
    initRequestedRef.current = true;
    // Fire-and-forget: response ignored, so a non-2xx (now thrown by postJSON) just logs.
    postJSON('/api/wa/initialize', {}).catch((err) => {
      console.error('[WhatsAppAuth] dev auto-init request failed:', err);
    });
  }, [canPair]);

  const renderContent = (): ReactNode => {
    switch (authState) {
      case AUTH_STATES.INITIALIZING:
      case AUTH_STATES.CONNECTING:
      case AUTH_STATES.CHECKING_SESSION:
      case AUTH_STATES.DISCONNECTED:
      case AUTH_STATES.RESTORING:
      case AUTH_STATES.NEEDS_RELINK:
        return <StatusDisplay authState={authState} canPair={canPair} />;

      case AUTH_STATES.QR_REQUIRED:
        return canPair ? <QRCodeDisplay qrCode={qrCode} /> : <StatusDisplay authState={authState} canPair={false} />;

      case AUTH_STATES.AUTHENTICATED:
        return <SuccessDisplay afterPairing={afterPairing} />;

      case AUTH_STATES.ERROR:
        return <ErrorDisplay error={error} />;
    }
  };

  return (
    <div className={styles.authContainer}>
      <header className={styles.authHeader}>
        <h1>WhatsApp Authentication</h1>
        <p className={styles.authSubtitle}>
          {canPair ? 'Connect your WhatsApp to send messages' : "The clinic's WhatsApp connection"}
        </p>
      </header>

      <div className={styles.authContent}>
        {renderContent()}
        <ControlButtons authState={authState} actions={actions} canPair={canPair} />
      </div>

      <ConnectionStatusFooter authState={authState} streamDown={streamDown} />

      {/* Fallback for JavaScript disabled */}
      <noscript>
        <div className={styles.noscriptWarning} role="alert">
          <h2>JavaScript Required</h2>
          <p>WhatsApp authentication requires JavaScript to function properly.</p>
          <p>Please enable JavaScript in your browser and refresh the page.</p>
          <button onClick={() => location.reload()}>Refresh Page</button>
        </div>
      </noscript>
    </div>
  );
}
