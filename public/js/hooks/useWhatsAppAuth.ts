/**
 * WhatsApp Authentication Hook
 * Manages WhatsApp client authentication state via the shared SSE channel
 * and the shared `/api/wa/initial-state` query.
 */

import { useReducer, useEffect, useRef, useCallback, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useWhatsAppStatus } from '../contexts/GlobalStateContext';
import { useToast } from '../contexts/ToastContext';
import sseWhatsapp from '../services/sse-whatsapp';
import { postJSON, httpErrorMessage } from '@/core/http';
import { whatsappInitialStateQuery } from '@/query/queries';
import {
  AUTH_STATES,
  authReducer,
  initialAuthModel,
  type AuthState,
} from './whatsappAuthMachine';

export { AUTH_STATES, type AuthState };

// Configuration Constants
const CONFIG = {
  CLIENT_RESTART_DELAY_MS: 2000,
  QR_REFRESH_DELAY_MS: 30000,
  /** How long CHECKING_SESSION waits for a QR before assuming one is coming. */
  CHECK_SESSION_SETTLE_MS: 3000,
  /** How long the "connected" screen shows before going back where the user came from. */
  REDIRECT_DELAY_MS: 2000,
} as const;

/**
 * Actions returned by the hook
 */
export interface WhatsAppAuthActions {
  handleRetry: () => void;
  handleRefreshQR: () => Promise<void>;
  handleRestart: () => Promise<void>;
  handleReLink: () => Promise<void>;
}

/**
 * Return type for useWhatsAppAuth hook
 */
export interface UseWhatsAppAuthReturn {
  authState: AuthState;
  clientReady: boolean;
  qrCode: string | null;
  error: string | null;
  /** The page's own SSE stream is down and being retried. */
  streamDown: boolean;
  /** Where the page is about to go after a successful pairing: a path, 'close' (popup), or null (stays). */
  afterPairing: string | null;
  actions: WhatsAppAuthActions;
}

export const useWhatsAppAuth = (): UseWhatsAppAuthReturn => {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();

  const { qrCode, clientReady } = useWhatsAppStatus();

  // ONE state machine (hooks/whatsappAuthMachine.ts) owns authState + error;
  // every writer below is an event dispatched into it (audit FE-F3-5).
  const [model, dispatch] = useReducer(authReducer, undefined, () => initialAuthModel(clientReady, qrCode));
  const { authState, error, streamDown } = model;

  // Feed the status context into the machine — during render, keyed on the
  // machine's own copy, so it's one sync instead of the two that disagreed.
  if (model.clientReady !== clientReady || model.qrCode !== qrCode) {
    dispatch({ type: 'status', clientReady, qrCode });
  }

  // The server snapshot — the same query the status provider and the send page
  // read (FE-F16-16). Each successful read is one `initialState` event; a failed
  // read while the page has nothing better to show is an ERROR with Retry, not a
  // blank (FE-F16-12).
  const snapshot = useQuery(whatsappInitialStateQuery());
  const [appliedAt, setAppliedAt] = useState(0);
  if (snapshot.data && snapshot.dataUpdatedAt !== appliedAt) {
    setAppliedAt(snapshot.dataUpdatedAt);
    dispatch({ type: 'initialState', data: snapshot.data });
  }
  const [failedAt, setFailedAt] = useState(0);
  if (snapshot.isError && snapshot.errorUpdatedAt !== failedAt) {
    setFailedAt(snapshot.errorUpdatedAt);
    if (authState === AUTH_STATES.INITIALIZING || authState === AUTH_STATES.CONNECTING) {
      dispatch({ type: 'failed', error: httpErrorMessage(snapshot.error, 'Could not read the WhatsApp status') });
    }
  }

  const refetchSnapshot = snapshot.refetch;
  const requestInitialState = useCallback(() => {
    void refetchSnapshot();
  }, [refetchSnapshot]);

  const qrRefreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // CHECKING_SESSION settles into QR_REQUIRED after a few seconds. An effect
  // keyed on the state, so leaving it early (or unmounting) cancels the timer —
  // the old bare setTimeout was never cleared.
  useEffect(() => {
    if (authState !== AUTH_STATES.CHECKING_SESSION) return;
    const timer = setTimeout(() => dispatch({ type: 'settleCheck' }), CONFIG.CHECK_SESSION_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [authState]);

  // Subscribe to SSE lifecycle events. Every (re)open re-reads the snapshot: the
  // status provider invalidates the shared query on `connected`.
  useEffect(() => {
    const handleConnected = () => dispatch({ type: 'transport', event: 'connected' });
    const handleConnecting = () => dispatch({ type: 'transport', event: 'connecting' });
    // A dropped stream emits `reconnecting` (the channel is retrying). The page
    // used to listen for `disconnected`, which only fires when the last consumer
    // lets go — never while this page holds it (FE-F16-12).
    const handleReconnecting = () => dispatch({ type: 'transport', event: 'disconnected' });
    const handleError = () => dispatch({ type: 'failed', error: 'SSE connection failed' });

    // React to the WhatsApp client-ready DATA frame (distinct from the SSE
    // transport events above) so a server-side park (needs_relink) or a re-link
    // flips the page live, instead of waiting for the next poll.
    const handleClientReadyFrame = (raw: unknown) => {
      const frame = raw as { clientReady?: boolean; state?: string } | null;
      if (!frame) return;
      dispatch({ type: 'clientFrame', clientReady: frame.clientReady, state: frame.state });
    };

    sseWhatsapp.on('connecting', handleConnecting);
    sseWhatsapp.on('connected', handleConnected);
    sseWhatsapp.on('reconnecting', handleReconnecting);
    sseWhatsapp.on('error', handleError);
    sseWhatsapp.on('whatsapp_client_ready', handleClientReadyFrame);

    sseWhatsapp.ensureConnected().catch((err) => {
      console.error('[useWhatsAppAuth] Failed to open SSE:', err);
      dispatch({ type: 'failed', error: 'Failed to open SSE connection' });
    });

    return () => {
      sseWhatsapp.off('connecting', handleConnecting);
      sseWhatsapp.off('connected', handleConnected);
      sseWhatsapp.off('reconnecting', handleReconnecting);
      sseWhatsapp.off('error', handleError);
      sseWhatsapp.off('whatsapp_client_ready', handleClientReadyFrame);
      sseWhatsapp.release();
    };
  }, []);

  // Start / stop QR refresh timer
  const startQRRefreshTimer = useCallback(() => {
    if (qrRefreshTimerRef.current) clearInterval(qrRefreshTimerRef.current);
    qrRefreshTimerRef.current = setInterval(() => {
      if (authState === AUTH_STATES.QR_REQUIRED) {
        requestInitialState();
      }
    }, CONFIG.QR_REFRESH_DELAY_MS);
  }, [authState, requestInitialState]);

  const stopQRRefreshTimer = useCallback(() => {
    if (qrRefreshTimerRef.current) {
      clearInterval(qrRefreshTimerRef.current);
      qrRefreshTimerRef.current = null;
    }
  }, []);

  // Action handlers
  const handleRetry = useCallback(() => {
    dispatch({ type: 'reset' });
    requestInitialState();
  }, [requestInitialState]);

  // "Refresh QR Code" — get a genuinely NEW code. The displayed QR is already
  // live-pushed on every whatsapp-web.js rotation via SSE, so just re-fetching
  // state can't change it; only a fresh client init mints a new QR. The server
  // route restarts in the background (fire-and-forget) and returns 200 at once,
  // and the new QR arrives over SSE within a few seconds — which flips authState
  // back to QR_REQUIRED on its own.
  const handleRefreshQR = useCallback(async () => {
    toast.info('Generating a new QR code…');
    dispatch({ type: 'reset' });
    try {
      await postJSON('/api/wa/refresh-qr', {});
      setTimeout(requestInitialState, CONFIG.CLIENT_RESTART_DELAY_MS);
    } catch (err) {
      console.error('Refresh QR failed:', err);
      const message = httpErrorMessage(err, 'Could not refresh QR code');
      dispatch({ type: 'failed', error: message });
      toast.error(message);
    }
  }, [requestInitialState, toast]);

  // "Restart Client" — fire-and-forget on the server (FE-F16-3), so the reset
  // comes FIRST, like Refresh QR and Re-link: the restart's QR / ready / park
  // arrives over SSE and moves the page on. It used to await the whole restart
  // behind a 30 s timeout and then drop the restart's live QR for "Restart failed".
  const handleRestart = useCallback(async () => {
    toast.info('Restarting WhatsApp client…');
    dispatch({ type: 'reset' });
    try {
      await postJSON('/api/wa/restart', {});
      setTimeout(requestInitialState, CONFIG.CLIENT_RESTART_DELAY_MS);
    } catch (err) {
      console.error('Restart failed:', err);
      const message = httpErrorMessage(err, 'Restart failed');
      dispatch({ type: 'failed', error: message });
      toast.error(`Restart failed: ${message}`);
    }
  }, [requestInitialState, toast]);

  // "Re-link device" — the recovery for a poisoned/parked session. Clears the
  // stored session via the library (POST /api/wa/unlink) and starts fresh; the
  // new QR arrives over SSE (which flips authState to QR_REQUIRED on its own).
  const handleReLink = useCallback(async () => {
    toast.info('Re-linking WhatsApp — a new QR is on the way…');
    dispatch({ type: 'reset' });
    try {
      await postJSON('/api/wa/unlink', {});
      setTimeout(requestInitialState, CONFIG.CLIENT_RESTART_DELAY_MS);
    } catch (err) {
      console.error('Re-link failed:', err);
      const message = httpErrorMessage(err, 'Could not re-link WhatsApp');
      dispatch({ type: 'failed', error: message });
      toast.error(message);
    }
  }, [requestInitialState, toast]);

  // Manage QR refresh timer based on auth state
  useEffect(() => {
    if (authState === AUTH_STATES.QR_REQUIRED) {
      startQRRefreshTimer();
    } else {
      stopQRRefreshTimer();
    }
    // Clear the interval on unmount — otherwise it keeps firing
    // requestInitialState() forever if the component unmounts while in
    // QR_REQUIRED state.
    return () => stopQRRefreshTimer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState]);

  // Handle page visibility — re-prime initial state on tab return.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && authState === AUTH_STATES.QR_REQUIRED) {
        requestInitialState();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState]);

  // Leave only when the user actually went through a QR scan on this page. If the
  // page mounted with the client already ready, stay so the user can reach
  // Restart Client / Re-link.
  const [sawQr, setSawQr] = useState(false);
  if (authState === AUTH_STATES.QR_REQUIRED && !sawQr) setSawQr(true);

  // Opened as a popup by the send-message page (`?popup=1`): close, so the user
  // is back on the page that asked, instead of this little window navigating to
  // the whole /send screen (FE-F16-13).
  const isPopup = new URLSearchParams(location.search).has('popup') && !!window.opener;
  const returnPath = (location.state as { returnPath?: string } | null)?.returnPath || '/send';
  const afterPairing =
    authState === AUTH_STATES.AUTHENTICATED && sawQr ? (isPopup ? 'close' : returnPath) : null;

  useEffect(() => {
    if (!afterPairing) return;
    const timer = setTimeout(() => {
      if (afterPairing === 'close') window.close();
      else navigate(afterPairing, { replace: true });
    }, CONFIG.REDIRECT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [afterPairing, navigate]);

  return {
    authState,
    clientReady,
    qrCode,
    error,
    streamDown,
    afterPairing,
    actions: {
      handleRetry,
      handleRefreshQR,
      handleRestart,
      handleReLink,
    },
  };
};
