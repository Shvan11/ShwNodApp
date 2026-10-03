/**
 * WhatsApp Authentication Hook
 * Manages WhatsApp client authentication state via the shared SSE channel
 * and the REST initial-state endpoint.
 */

import { useReducer, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useWhatsAppStatus } from '../contexts/GlobalStateContext';
import { useToast } from '../contexts/ToastContext';
import sseWhatsapp from '../services/sse-whatsapp';
import { fetchJSON, postJSON, httpErrorMessage } from '@/core/http';
import * as whatsappContract from '@shared/contracts/whatsapp.contract';
import {
  AUTH_STATES,
  authReducer,
  initialAuthModel,
  type AuthState,
  type InitialStateResponse,
} from './whatsappAuthMachine';

export { AUTH_STATES, type AuthState };

// Configuration Constants
const CONFIG = {
  CLIENT_RESTART_DELAY_MS: 2000,
  QR_REFRESH_DELAY_MS: 30000,
  /** How long CHECKING_SESSION waits for a QR before assuming one is coming. */
  CHECK_SESSION_SETTLE_MS: 3000,
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
  const { authState, error } = model;

  // Feed the status context into the machine — during render, keyed on the
  // machine's own copy, so it's one sync instead of the two that disagreed.
  if (model.clientReady !== clientReady || model.qrCode !== qrCode) {
    dispatch({ type: 'status', clientReady, qrCode });
  }

  const qrRefreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch initial state via REST (replaces the WS RPC).
  const requestInitialState = useCallback(async () => {
    try {
      // Flat `{ success, qr, clientReady, … }` (no `data` key) → fetchJSON passthrough.
      const data = await fetchJSON<InitialStateResponse>('/api/wa/initial-state', { schema: whatsappContract.initialState.response });
      if (data) dispatch({ type: 'initialState', data });
    } catch (err) {
      console.error('[useWhatsAppAuth] initial-state fetch failed', err);
    }
  }, []);

  // CHECKING_SESSION settles into QR_REQUIRED after a few seconds. An effect
  // keyed on the state, so leaving it early (or unmounting) cancels the timer —
  // the old bare setTimeout was never cleared.
  useEffect(() => {
    if (authState !== AUTH_STATES.CHECKING_SESSION) return;
    const timer = setTimeout(() => dispatch({ type: 'settleCheck' }), CONFIG.CHECK_SESSION_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [authState]);

  // Subscribe to SSE lifecycle events + prime initial state on mount/reconnect.
  useEffect(() => {
    const handleConnected = () => {
      dispatch({ type: 'transport', event: 'connected' });
      void requestInitialState();
    };

    const handleConnecting = () => dispatch({ type: 'transport', event: 'connecting' });

    const handleDisconnected = () => dispatch({ type: 'transport', event: 'disconnected' });

    const handleError = () => dispatch({ type: 'failed', error: 'SSE connection failed' });

    const handleReconnected = () => {
      void requestInitialState();
    };

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
    sseWhatsapp.on('disconnected', handleDisconnected);
    sseWhatsapp.on('error', handleError);
    sseWhatsapp.on('reconnected', handleReconnected);
    sseWhatsapp.on('whatsapp_client_ready', handleClientReadyFrame);

    sseWhatsapp
      .ensureConnected()
      .then(() => {
        void requestInitialState();
      })
      .catch((err) => {
        console.error('[useWhatsAppAuth] Failed to open SSE:', err);
        dispatch({ type: 'failed', error: 'Failed to open SSE connection' });
      });

    return () => {
      sseWhatsapp.off('connecting', handleConnecting);
      sseWhatsapp.off('connected', handleConnected);
      sseWhatsapp.off('disconnected', handleDisconnected);
      sseWhatsapp.off('error', handleError);
      sseWhatsapp.off('reconnected', handleReconnected);
      sseWhatsapp.off('whatsapp_client_ready', handleClientReadyFrame);
      sseWhatsapp.release();
    };
  }, [requestInitialState]);

  // Start / stop QR refresh timer
  const startQRRefreshTimer = useCallback(() => {
    if (qrRefreshTimerRef.current) clearInterval(qrRefreshTimerRef.current);
    qrRefreshTimerRef.current = setInterval(() => {
      if (authState === AUTH_STATES.QR_REQUIRED) {
        void requestInitialState();
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
    void requestInitialState();
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
      setTimeout(() => {
        void requestInitialState();
      }, CONFIG.CLIENT_RESTART_DELAY_MS);
    } catch (err) {
      console.error('Refresh QR failed:', err);
      const message = httpErrorMessage(err, 'Could not refresh QR code');
      dispatch({ type: 'failed', error: message });
      toast.error(message);
    }
  }, [requestInitialState, toast]);

  const handleRestart = useCallback(async () => {
    toast.info('Restarting WhatsApp client…');
    try {
      // Non-2xx now throws (route 500s on failure); the success body is success:true.
      await postJSON('/api/wa/restart', {});
      dispatch({ type: 'reset' });
      toast.success('WhatsApp client restart initiated');
      setTimeout(() => {
        void requestInitialState();
      }, CONFIG.CLIENT_RESTART_DELAY_MS);
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
      setTimeout(() => {
        void requestInitialState();
      }, CONFIG.CLIENT_RESTART_DELAY_MS);
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
        void requestInitialState();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState]);

  // Auto-redirect only when the user actually went through QR scan on this
  // page. If the page mounted with the client already ready, stay so the user
  // can reach Restart Client / Re-link.
  const sawQrStateRef = useRef(false);
  useEffect(() => {
    if (authState === AUTH_STATES.QR_REQUIRED) {
      sawQrStateRef.current = true;
    }
  }, [authState]);

  useEffect(() => {
    if (authState !== AUTH_STATES.AUTHENTICATED) return;
    if (!sawQrStateRef.current) return;

    const state = location.state as { returnPath?: string } | null;
    const returnPath = state?.returnPath || '/send';

    const timer = setTimeout(() => {
      navigate(returnPath, { replace: true });
    }, 2000);
    return () => clearTimeout(timer);
  }, [authState, location.state, navigate]);

  return {
    authState,
    clientReady,
    qrCode,
    error,
    actions: {
      handleRetry,
      handleRefreshQR,
      handleRestart,
      handleReLink,
    },
  };
};
