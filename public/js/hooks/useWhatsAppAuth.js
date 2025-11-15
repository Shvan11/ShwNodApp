/**
 * WhatsApp Authentication Hook
 * Manages WhatsApp client authentication state and WebSocket connection
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { config } from '../config/environment.js';

// Authentication States
export const AUTH_STATES = {
  INITIALIZING: 'initializing',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  CHECKING_SESSION: 'checking_session',
  QR_REQUIRED: 'qr_required',
  AUTHENTICATED: 'authenticated',
  ERROR: 'error',
  DISCONNECTED: 'disconnected'
};

// Configuration Constants
const CONFIG = {
  WEBSOCKET_RECONNECT_DELAY_MS: 500,
  CLIENT_RESTART_DELAY_MS: 2000,
  LOGOUT_DELAY_MS: 1000,
  QR_REFRESH_DELAY_MS: 30000,
  MAX_RECONNECT_ATTEMPTS: 10,
  HEARTBEAT_INTERVAL_MS: 30000
};

export const useWhatsAppAuth = () => {
  const [authState, setAuthState] = useState(AUTH_STATES.INITIALIZING);
  const [clientReady, setClientReady] = useState(false);
  const [qrCode, setQrCode] = useState(null);
  const [error, setError] = useState(null);
  const [connectionAttempts, setConnectionAttempts] = useState(0);

  const wsRef = useRef(null);
  const qrRefreshTimerRef = useRef(null);
  const reconnectTimerRef = useRef(null);

  // Request initial state from server
  const requestInitialState = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket not ready, cannot request initial state');
      return;
    }

    console.log('Requesting WhatsApp initial state...');
    const message = {
      type: 'request_whatsapp_initial_state',
      data: { timestamp: Date.now() }
    };

    wsRef.current.send(JSON.stringify(message));
  }, []);

  // Fetch QR code from API
  const fetchQRCode = useCallback(async () => {
    try {
      console.log('Fetching QR code from API...');
      const response = await fetch('/api/wa/qr', {
        credentials: 'include' // Include session cookies for authentication
      });

      if (!response.ok) {
        if (response.status === 404) {
          console.log('QR code not available yet');
          return null;
        }
        throw new Error(`Failed to fetch QR code: ${response.status}`);
      }

      const qrResponse = await response.json();
      return qrResponse.qr || null;
    } catch (error) {
      console.error('Failed to fetch QR code:', error);
      return null;
    }
  }, []);

  // Handle QR code update (QR is already converted to data URL by server)
  const handleQRUpdate = useCallback((data) => {
    console.log('QR Code updated - has QR:', !!data.qr);

    if (authState === AUTH_STATES.AUTHENTICATED) {
      console.log('Already authenticated, ignoring QR update');
      return;
    }

    if (authState === AUTH_STATES.CHECKING_SESSION) {
      console.log('Still checking session, storing QR for later');
      setQrCode(data.qr);
      return;
    }

    setAuthState(AUTH_STATES.QR_REQUIRED);
    setQrCode(data.qr);
    console.log('QR Code received and set');
  }, [authState]);

  // Handle client ready
  const handleClientReady = useCallback((data) => {
    console.log('Client ready:', data);
    const isReady = data.clientReady || data.state === 'ready';

    if (isReady) {
      setAuthState(AUTH_STATES.AUTHENTICATED);
      setClientReady(true);
    } else {
      setAuthState(AUTH_STATES.QR_REQUIRED);
      setClientReady(false);
    }
  }, []);

  // Handle initial state
  const handleInitialState = useCallback((data) => {
    console.log('Initial state received:', data);
    console.log('Initial state has QR:', !!data?.qr);
    console.log('Initial state clientReady:', data?.clientReady);

    if (!data) {
      console.log('No data received');
      return;
    }

    if (data.clientReady) {
      console.log('Client is ready, setting AUTHENTICATED state');
      setAuthState(AUTH_STATES.AUTHENTICATED);
      setClientReady(true);
    } else if (data.qr) {
      console.log('QR code found in initial state (already converted by server)');
      setAuthState(AUTH_STATES.CHECKING_SESSION);
      setQrCode(data.qr);

      // Wait to see if session restores
      setTimeout(() => {
        setAuthState((currentState) => {
          if (currentState === AUTH_STATES.CHECKING_SESSION) {
            console.log('Session not restored, showing QR');
            return AUTH_STATES.QR_REQUIRED;
          }
          return currentState;
        });
      }, 3000);
    } else if (data.error) {
      console.log('Error found:', data.error);
      setAuthState(AUTH_STATES.ERROR);
      setError(data.error);
    } else {
      console.log('No specific state (no QR, no clientReady), checking for session');
      setAuthState(AUTH_STATES.CHECKING_SESSION);

      setTimeout(() => {
        setAuthState((currentState) => {
          if (currentState === AUTH_STATES.CHECKING_SESSION) {
            console.log('Timeout reached, moving to QR_REQUIRED');
            return AUTH_STATES.QR_REQUIRED;
          }
          return currentState;
        });
      }, 3000);
    }
  }, []);

  // Setup WebSocket connection
  const setupWebSocket = useCallback(() => {
    // Use the centralized environment configuration (same as appointments page)
    const wsUrl = `${config.wsUrl}?clientType=auth&needsQR=true&timestamp=${Date.now()}`;

    console.log('Connecting to:', wsUrl);

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('WebSocket connected');
      setAuthState(AUTH_STATES.CONNECTED);
      setConnectionAttempts(0);

      // Send heartbeat
      ws.send(JSON.stringify({
        type: 'heartbeat_ping',
        data: { timestamp: Date.now() }
      }));

      requestInitialState();
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        // Only log important messages (not heartbeats)
        if (message.type !== 'heartbeat_pong') {
          console.log('WebSocket message:', message.type);
        }

        switch (message.type) {
          case 'whatsapp_qr_updated':
            handleQRUpdate(message.data);
            break;
          case 'whatsapp_client_ready':
            handleClientReady(message.data);
            break;
          case 'whatsapp_initial_state_response':
            handleInitialState(message.data);
            break;
          case 'heartbeat_pong':
            // Heartbeat response - connection is alive (silently handled)
            break;
          default:
            console.log('Unhandled message:', message);
        }
      } catch (error) {
        console.error('Error parsing message:', error);
      }
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      setAuthState(AUTH_STATES.DISCONNECTED);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      setAuthState(AUTH_STATES.ERROR);
      setError('WebSocket connection failed');
    };
  }, [requestInitialState, handleQRUpdate, handleClientReady, handleInitialState]);

  // Start QR refresh timer
  const startQRRefreshTimer = useCallback(() => {
    if (qrRefreshTimerRef.current) {
      clearInterval(qrRefreshTimerRef.current);
    }

    qrRefreshTimerRef.current = setInterval(() => {
      if (authState === AUTH_STATES.QR_REQUIRED) {
        requestInitialState();
      }
    }, CONFIG.QR_REFRESH_DELAY_MS);
  }, [authState, requestInitialState]);

  // Stop QR refresh timer
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
    setupWebSocket();
  }, [setupWebSocket]);

  const handleRefreshQR = useCallback(() => {
    requestInitialState();
  }, [requestInitialState]);

  const handleRestart = useCallback(async () => {
    try {
      const response = await fetch('/api/wa/restart', {
        method: 'POST',
        credentials: 'include'
      });
      const result = await response.json();

      if (result.success) {
        setAuthState(AUTH_STATES.INITIALIZING);
        setTimeout(() => {
          requestInitialState();
        }, CONFIG.CLIENT_RESTART_DELAY_MS);
      } else {
        throw new Error(result.error || 'Restart failed');
      }
    } catch (error) {
      console.error('Restart failed:', error);
      setAuthState(AUTH_STATES.ERROR);
      setError('Restart failed');
    }
  }, [requestInitialState]);

  const handleDestroy = useCallback(async () => {
    try {
      const response = await fetch('/api/wa/destroy', {
        method: 'POST',
        credentials: 'include'
      });
      const result = await response.json();

      if (result.success) {
        setAuthState(AUTH_STATES.INITIALIZING);
      } else {
        throw new Error(result.error || 'Destroy failed');
      }
    } catch (error) {
      console.error('Destroy failed:', error);
      setAuthState(AUTH_STATES.ERROR);
      setError('Destroy failed');
    }
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      console.log('Starting logout process...');
      const response = await fetch('/api/wa/logout', {
        method: 'POST',
        credentials: 'include'
      });
      const result = await response.json();

      if (result.success) {
        console.log('Logout successful, restarting client...');
        setAuthState(AUTH_STATES.INITIALIZING);

        // Restart client after logout
        try {
          const restartResponse = await fetch('/api/wa/restart', {
            method: 'POST',
            credentials: 'include'
          });
          const restartResult = await restartResponse.json();

          if (restartResult.success) {
            setTimeout(() => {
              requestInitialState();
            }, CONFIG.LOGOUT_DELAY_MS);
          }
        } catch (restartError) {
          console.warn('Restart failed:', restartError);
          setTimeout(() => {
            requestInitialState();
          }, CONFIG.LOGOUT_DELAY_MS);
        }
      } else {
        throw new Error(result.error || 'Logout failed');
      }
    } catch (error) {
      console.error('Logout failed:', error);
      setAuthState(AUTH_STATES.ERROR);
      setError('Logout failed');
    }
  }, [requestInitialState]);

  // Initialize WebSocket on mount (only once!)
  useEffect(() => {
    setupWebSocket();

    return () => {
      stopQRRefreshTimer();
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty array = run only once on mount

  // Manage QR refresh timer based on auth state
  useEffect(() => {
    if (authState === AUTH_STATES.QR_REQUIRED) {
      startQRRefreshTimer();
    } else {
      stopQRRefreshTimer();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState]); // Only depend on authState changes

  // Handle page visibility
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && authState === AUTH_STATES.QR_REQUIRED) {
        requestInitialState();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState]); // Only depend on authState changes

  // Handle successful authentication redirect
  useEffect(() => {
    if (authState === AUTH_STATES.AUTHENTICATED) {
      const urlParams = new URLSearchParams(window.location.search);
      const returnTo = urlParams.get('returnTo');

      if (returnTo) {
        console.log('Authentication successful, redirecting to:', returnTo);
        setTimeout(() => {
          try {
            const decodedUrl = decodeURIComponent(returnTo);
            const returnUrl = new URL(decodedUrl, window.location.origin);
            returnUrl.searchParams.set('authCompleted', Date.now().toString());
            window.location.href = returnUrl.toString();
          } catch (error) {
            console.error('Error parsing return URL:', error);
            window.location.href = '/send';
          }
        }, 2000);
      }
    }
  }, [authState]);

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
      fetchQRCode
    }
  };
};
