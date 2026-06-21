/**
 * WhatsApp Authentication Hook
 * Manages WhatsApp client authentication state via the shared SSE channel
 * and the REST initial-state endpoint.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useGlobalState } from '../contexts/GlobalStateContext';
import { useToast } from '../contexts/ToastContext';
import sseWhatsapp from '../services/sse-whatsapp';
import { fetchJSON, postJSON, httpErrorMessage, type HttpError } from '@/core/http';
import * as whatsappContract from '@shared/contracts/whatsapp.contract';

// Authentication States
export const AUTH_STATES = {
  INITIALIZING: 'initializing',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  CHECKING_SESSION: 'checking_session',
  QR_REQUIRED: 'qr_required',
  AUTHENTICATED: 'authenticated',
  ERROR: 'error',
  DISCONNECTED: 'disconnected',
} as const;

export type AuthState = (typeof AUTH_STATES)[keyof typeof AUTH_STATES];

// Configuration Constants
const CONFIG = {
  CLIENT_RESTART_DELAY_MS: 2000,
  LOGOUT_DELAY_MS: 1000,
  QR_REFRESH_DELAY_MS: 30000,
} as const;

/**
 * Initial state response from server
 */
interface InitialStateResponse {
  qr?: string;
  clientReady?: boolean;
  error?: string;
  [key: string]: unknown;
}

/**
 * Actions returned by the hook
 */
export interface WhatsAppAuthActions {
  handleRetry: () => void;
  handleRefreshQR: () => Promise<void>;
  handleRestart: () => Promise<void>;
  handleDestroy: () => Promise<void>;
  handleLogout: () => Promise<void>;
  fetchQRCode: () => Promise<string | null>;
}

/**
 * Return type for useWhatsAppAuth hook
 */
export interface UseWhatsAppAuthReturn {
  authState: AuthState;
  clientReady: boolean;
  qrCode: string | null;
  error: string | null;
  connectionAttempts: number;
  actions: WhatsAppAuthActions;
}

export const useWhatsAppAuth = (): UseWhatsAppAuthReturn => {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();

  const { whatsappQrCode: qrCode, whatsappClientReady: clientReady } = useGlobalState();

  const [authState, setAuthState] = useState<AuthState>(AUTH_STATES.INITIALIZING);
  const [error, setError] = useState<string | null>(null);
  const [connectionAttempts, setConnectionAttempts] = useState(0);

  const qrRefreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Handle initial state - now only manages authState, not qrCode/clientReady
  const handleInitialState = useCallback((data: InitialStateResponse) => {
    if (!data) return;

    // qrCode and clientReady are managed by GlobalStateContext
    if (data.clientReady) {
      setAuthState(AUTH_STATES.AUTHENTICATED);
    } else if (data.qr) {
      setAuthState((currentState) =>
        currentState === AUTH_STATES.QR_REQUIRED ||
        currentState === AUTH_STATES.AUTHENTICATED
          ? currentState
          : AUTH_STATES.CHECKING_SESSION
      );

      setTimeout(() => {
        setAuthState((currentState) =>
          currentState === AUTH_STATES.CHECKING_SESSION
            ? AUTH_STATES.QR_REQUIRED
            : currentState
        );
      }, 3000);
    } else if (data.error) {
      setAuthState(AUTH_STATES.ERROR);
      setError(data.error);
    } else {
      // No QR and no clientReady — wait briefly for the client to settle.
      setAuthState((currentState) =>
        currentState === AUTH_STATES.QR_REQUIRED ||
        currentState === AUTH_STATES.AUTHENTICATED
          ? currentState
          : AUTH_STATES.CHECKING_SESSION
      );

      setTimeout(() => {
        setAuthState((currentState) =>
          currentState === AUTH_STATES.CHECKING_SESSION
            ? AUTH_STATES.QR_REQUIRED
            : currentState
        );
      }, 3000);
    }
  }, []);

  // Fetch initial state via REST (replaces the WS RPC).
  const requestInitialState = useCallback(async () => {
    try {
      // Flat `{ success, qr, clientReady, … }` (no `data` key) → fetchJSON passthrough.
      const data = await fetchJSON<InitialStateResponse>('/api/wa/initial-state', { schema: whatsappContract.initialState.response });
      handleInitialState(data);
    } catch (err) {
      console.error('[useWhatsAppAuth] initial-state fetch failed', err);
    }
  }, [handleInitialState]);

  // Fetch QR code from API (fallback method)
  const fetchQRCode = useCallback(async (): Promise<string | null> => {
    try {
      // Flat `{ qr, status, … }` (no `data` key) → fetchJSON passthrough.
      const qrResponse = await fetchJSON<{ qr?: string }>('/api/wa/qr', { schema: whatsappContract.qr.response });
      return qrResponse.qr || null;
    } catch (err) {
      // 404 = QR not available yet (a normal signal, not an error).
      if ((err as HttpError).status === 404) return null;
      console.error('Failed to fetch QR code:', err);
      return null;
    }
  }, []);

  // React to qrCode / clientReady arriving from GlobalStateContext (via the
  // whatsapp_qr_updated and whatsapp_client_ready SSE events). Done during render
  // (keyed on the two inputs) so it's not a setState-in-effect.
  const [prevQrReady1, setPrevQrReady1] = useState({ qrCode, clientReady });
  if (prevQrReady1.qrCode !== qrCode || prevQrReady1.clientReady !== clientReady) {
    setPrevQrReady1({ qrCode, clientReady });
    if (clientReady) {
      setAuthState(AUTH_STATES.AUTHENTICATED);
    } else if (qrCode) {
      setAuthState((currentState) =>
        currentState === AUTH_STATES.AUTHENTICATED
          ? currentState
          : AUTH_STATES.QR_REQUIRED
      );
    }
  }

  // Subscribe to SSE lifecycle events + prime initial state on mount/reconnect.
  useEffect(() => {
    const handleConnected = () => {
      setAuthState(AUTH_STATES.CONNECTED);
      setConnectionAttempts(0);
      void requestInitialState();
    };

    const handleConnecting = () => {
      setAuthState((prev) =>
        prev === AUTH_STATES.AUTHENTICATED || prev === AUTH_STATES.QR_REQUIRED
          ? prev
          : AUTH_STATES.CONNECTING
      );
    };

    const handleDisconnected = () => {
      setAuthState(AUTH_STATES.DISCONNECTED);
    };

    const handleError = () => {
      setAuthState(AUTH_STATES.ERROR);
      setError('SSE connection failed');
    };

    const handleReconnected = () => {
      setConnectionAttempts(0);
      void requestInitialState();
    };

    sseWhatsapp.on('connecting', handleConnecting);
    sseWhatsapp.on('connected', handleConnected);
    sseWhatsapp.on('disconnected', handleDisconnected);
    sseWhatsapp.on('error', handleError);
    sseWhatsapp.on('reconnected', handleReconnected);

    sseWhatsapp
      .ensureConnected()
      .then(() => {
        void requestInitialState();
      })
      .catch((err) => {
        console.error('[useWhatsAppAuth] Failed to open SSE:', err);
        setAuthState(AUTH_STATES.ERROR);
        setError('Failed to open SSE connection');
      });

    return () => {
      sseWhatsapp.off('connecting', handleConnecting);
      sseWhatsapp.off('connected', handleConnected);
      sseWhatsapp.off('disconnected', handleDisconnected);
      sseWhatsapp.off('error', handleError);
      sseWhatsapp.off('reconnected', handleReconnected);
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
    setAuthState(AUTH_STATES.INITIALIZING);
    setConnectionAttempts(0);
    setError(null);
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
    setAuthState(AUTH_STATES.INITIALIZING);
    setError(null);
    try {
      await postJSON('/api/wa/refresh-qr', {});
      setTimeout(() => {
        void requestInitialState();
      }, CONFIG.CLIENT_RESTART_DELAY_MS);
    } catch (err) {
      console.error('Refresh QR failed:', err);
      setAuthState(AUTH_STATES.ERROR);
      const message = httpErrorMessage(err, 'Could not refresh QR code');
      setError(message);
      toast.error(message);
    }
  }, [requestInitialState, toast]);

  const handleRestart = useCallback(async () => {
    toast.info('Restarting WhatsApp client…');
    try {
      // Non-2xx now throws (route 500s on failure); the success body is success:true.
      await postJSON('/api/wa/restart', {});
      setAuthState(AUTH_STATES.INITIALIZING);
      toast.success('WhatsApp client restart initiated');
      setTimeout(() => {
        void requestInitialState();
      }, CONFIG.CLIENT_RESTART_DELAY_MS);
    } catch (err) {
      console.error('Restart failed:', err);
      setAuthState(AUTH_STATES.ERROR);
      const message = httpErrorMessage(err, 'Restart failed');
      setError(message);
      toast.error(`Restart failed: ${message}`);
    }
  }, [requestInitialState, toast]);

  const handleDestroy = useCallback(async () => {
    toast.info('Closing WhatsApp browser…');
    try {
      // Non-2xx now throws (route 400/500s on failure); the success body is success:true.
      await postJSON('/api/wa/destroy', {});
      setAuthState(AUTH_STATES.INITIALIZING);
      toast.success('WhatsApp browser closed');
    } catch (err) {
      console.error('Destroy failed:', err);
      setAuthState(AUTH_STATES.ERROR);
      const message = httpErrorMessage(err, 'Destroy failed');
      setError(message);
      toast.error(`Failed to close browser: ${message}`);
    }
  }, [toast]);

  const handleLogout = useCallback(async () => {
    toast.info('Logging out of WhatsApp…');
    try {
      // Non-2xx now throws (route 400/500s on failure); the success body is success:true.
      await postJSON('/api/wa/logout', {});
      setAuthState(AUTH_STATES.INITIALIZING);
      toast.success('Logged out — restarting client');

      // Re-prime initial state whether or not the follow-up restart succeeds
      // (both branches re-prime; the catch covers a non-2xx restart too).
      try {
        await postJSON('/api/wa/restart', {});
      } catch (restartError) {
        console.warn('Restart failed:', restartError);
      } finally {
        setTimeout(() => {
          void requestInitialState();
        }, CONFIG.LOGOUT_DELAY_MS);
      }
    } catch (err) {
      console.error('Logout failed:', err);
      setAuthState(AUTH_STATES.ERROR);
      const message = httpErrorMessage(err, 'Logout failed');
      setError(message);
      toast.error(`Logout failed: ${message}`);
    }
  }, [requestInitialState, toast]);

  // Sync authState with global qrCode and clientReady values — during render (keyed
  // on the inputs + current authState) so it's not a setState-in-effect.
  const [prevQrReady2, setPrevQrReady2] = useState({ clientReady, qrCode, authState });
  if (
    prevQrReady2.clientReady !== clientReady ||
    prevQrReady2.qrCode !== qrCode ||
    prevQrReady2.authState !== authState
  ) {
    setPrevQrReady2({ clientReady, qrCode, authState });
    if (clientReady && authState !== AUTH_STATES.AUTHENTICATED) {
      setAuthState(AUTH_STATES.AUTHENTICATED);
    } else if (!clientReady && qrCode && authState === AUTH_STATES.AUTHENTICATED) {
      setAuthState(AUTH_STATES.QR_REQUIRED);
    } else if (qrCode && authState === AUTH_STATES.CHECKING_SESSION) {
      setAuthState(AUTH_STATES.QR_REQUIRED);
    }
  }

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
  // can reach Restart / Close Browser / Logout.
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
    connectionAttempts,
    actions: {
      handleRetry,
      handleRefreshQR,
      handleRestart,
      handleDestroy,
      handleLogout,
      fetchQRCode,
    },
  };
};
