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
  handleRefreshQR: () => void;
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
      const response = await fetch('/api/wa/initial-state', { credentials: 'include' });
      if (!response.ok) {
        throw new Error(`Initial state request failed: ${response.status}`);
      }
      const data = (await response.json()) as InitialStateResponse;
      handleInitialState(data);
    } catch (err) {
      console.error('[useWhatsAppAuth] initial-state fetch failed', err);
    }
  }, [handleInitialState]);

  // Fetch QR code from API (fallback method)
  const fetchQRCode = useCallback(async (): Promise<string | null> => {
    try {
      const response = await fetch('/api/wa/qr', { credentials: 'include' });
      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error(`Failed to fetch QR code: ${response.status}`);
      }
      const qrResponse = await response.json();
      return qrResponse.qr || null;
    } catch (err) {
      console.error('Failed to fetch QR code:', err);
      return null;
    }
  }, []);

  // React to qrCode / clientReady arriving from GlobalStateContext (via the
  // whatsapp_qr_updated and whatsapp_client_ready SSE events).
  useEffect(() => {
    if (clientReady) {
      setAuthState(AUTH_STATES.AUTHENTICATED);
    } else if (qrCode) {
      setAuthState((currentState) =>
        currentState === AUTH_STATES.AUTHENTICATED
          ? currentState
          : AUTH_STATES.QR_REQUIRED
      );
    }
  }, [qrCode, clientReady]);

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

  const handleRefreshQR = useCallback(() => {
    void requestInitialState();
  }, [requestInitialState]);

  const handleRestart = useCallback(async () => {
    toast.info('Restarting WhatsApp client…');
    try {
      const response = await fetch('/api/wa/restart', {
        method: 'POST',
        credentials: 'include',
      });
      const result = await response.json();
      if (result.success) {
        setAuthState(AUTH_STATES.INITIALIZING);
        toast.success('WhatsApp client restart initiated');
        setTimeout(() => {
          void requestInitialState();
        }, CONFIG.CLIENT_RESTART_DELAY_MS);
      } else {
        throw new Error(result.error || 'Restart failed');
      }
    } catch (err) {
      console.error('Restart failed:', err);
      setAuthState(AUTH_STATES.ERROR);
      const message = err instanceof Error ? err.message : 'Restart failed';
      setError(message);
      toast.error(`Restart failed: ${message}`);
    }
  }, [requestInitialState, toast]);

  const handleDestroy = useCallback(async () => {
    toast.info('Closing WhatsApp browser…');
    try {
      const response = await fetch('/api/wa/destroy', {
        method: 'POST',
        credentials: 'include',
      });
      const result = await response.json();
      if (result.success) {
        setAuthState(AUTH_STATES.INITIALIZING);
        toast.success('WhatsApp browser closed');
      } else {
        throw new Error(result.error || 'Destroy failed');
      }
    } catch (err) {
      console.error('Destroy failed:', err);
      setAuthState(AUTH_STATES.ERROR);
      const message = err instanceof Error ? err.message : 'Destroy failed';
      setError(message);
      toast.error(`Failed to close browser: ${message}`);
    }
  }, [toast]);

  const handleLogout = useCallback(async () => {
    toast.info('Logging out of WhatsApp…');
    try {
      const response = await fetch('/api/wa/logout', {
        method: 'POST',
        credentials: 'include',
      });
      const result = await response.json();
      if (result.success) {
        setAuthState(AUTH_STATES.INITIALIZING);
        toast.success('Logged out — restarting client');

        try {
          const restartResponse = await fetch('/api/wa/restart', {
            method: 'POST',
            credentials: 'include',
          });
          const restartResult = await restartResponse.json();
          if (restartResult.success) {
            setTimeout(() => {
              void requestInitialState();
            }, CONFIG.LOGOUT_DELAY_MS);
          }
        } catch (restartError) {
          console.warn('Restart failed:', restartError);
          setTimeout(() => {
            void requestInitialState();
          }, CONFIG.LOGOUT_DELAY_MS);
        }
      } else {
        throw new Error(result.error || 'Logout failed');
      }
    } catch (err) {
      console.error('Logout failed:', err);
      setAuthState(AUTH_STATES.ERROR);
      const message = err instanceof Error ? err.message : 'Logout failed';
      setError(message);
      toast.error(`Logout failed: ${message}`);
    }
  }, [requestInitialState, toast]);

  // Sync authState with global qrCode and clientReady values
  useEffect(() => {
    if (clientReady && authState !== AUTH_STATES.AUTHENTICATED) {
      setAuthState(AUTH_STATES.AUTHENTICATED);
    } else if (!clientReady && qrCode && authState === AUTH_STATES.AUTHENTICATED) {
      setAuthState(AUTH_STATES.QR_REQUIRED);
    } else if (qrCode && authState === AUTH_STATES.CHECKING_SESSION) {
      setAuthState(AUTH_STATES.QR_REQUIRED);
    }
  }, [clientReady, qrCode, authState]);

  // Manage QR refresh timer based on auth state
  useEffect(() => {
    if (authState === AUTH_STATES.QR_REQUIRED) {
      startQRRefreshTimer();
    } else {
      stopQRRefreshTimer();
    }
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
