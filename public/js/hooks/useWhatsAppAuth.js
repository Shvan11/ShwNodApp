/**
 * WhatsApp Authentication Hook
 * Manages WhatsApp client authentication state and WebSocket connection
 * Uses centralized connection manager to prevent duplicate connections
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useGlobalState } from '../contexts/GlobalStateContext.jsx';
import connectionManager from '../services/websocket-connection-manager.js';

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
  // Use GlobalStateContext for QR code and client ready status (single source of truth)
  const { whatsappQrCode: qrCode, whatsappClientReady: clientReady } = useGlobalState();

  const [authState, setAuthState] = useState(AUTH_STATES.INITIALIZING);
  const [error, setError] = useState(null);
  const [connectionAttempts, setConnectionAttempts] = useState(0);

  const wsRef = useRef(null);
  const qrRefreshTimerRef = useRef(null);
  const reconnectTimerRef = useRef(null);

  // Request initial state from server (using singleton service)
  const requestInitialState = useCallback(() => {
    if (!wsRef.current || !wsRef.current.isConnected) {
      console.warn('WebSocket not ready, cannot request initial state');
      return;
    }

    console.log('Requesting WhatsApp initial state...');
    wsRef.current.send({
      type: 'request_whatsapp_initial_state',
      data: { timestamp: Date.now() }
    }).catch(error => {
      console.error('Failed to request initial state:', error);
    });
  }, []);

  // Fetch QR code from API (fallback method)
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

  // NOTE: handleQRUpdate and handleClientReady removed - now managed by GlobalStateContext
  // QR code and client ready state are automatically synced from GlobalStateContext

  // Handle initial state - now only manages authState, not qrCode/clientReady
  const handleInitialState = useCallback((data) => {
    console.log('Initial state received:', data);
    console.log('Initial state has QR:', !!data?.qr);
    console.log('Initial state clientReady:', data?.clientReady);

    if (!data) {
      console.log('No data received');
      return;
    }

    // qrCode and clientReady are managed by GlobalStateContext
    // We only need to manage authState here
    if (data.clientReady) {
      console.log('Client is ready, setting AUTHENTICATED state');
      setAuthState(AUTH_STATES.AUTHENTICATED);
    } else if (data.qr) {
      console.log('QR code found in initial state');
      setAuthState(AUTH_STATES.CHECKING_SESSION);

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

  // Setup WebSocket connection using connection manager
  const setupWebSocket = useCallback(async () => {
    try {
      console.log('[useWhatsAppAuth] Setting up WebSocket connection');

      // Use connection manager to ensure single connection
      await connectionManager.ensureConnected('auth', {
        needsQR: true,
        timestamp: Date.now()
      });

      console.log('[useWhatsAppAuth] WebSocket connected via connection manager');

      // Get the WebSocket service from connection manager
      const websocketService = connectionManager.getService();
      wsRef.current = websocketService;

      // Setup connection event handlers
      const handleConnected = () => {
        console.log('[useWhatsAppAuth] WebSocket connected');
        setAuthState(AUTH_STATES.CONNECTED);
        setConnectionAttempts(0);
        requestInitialState();
      };

      const handleDisconnected = () => {
        console.log('[useWhatsAppAuth] WebSocket disconnected');
        setAuthState(AUTH_STATES.DISCONNECTED);
      };

      const handleError = (error) => {
        console.error('[useWhatsAppAuth] WebSocket error:', error);
        setAuthState(AUTH_STATES.ERROR);
        setError('WebSocket connection failed');
      };

      // NOTE: whatsapp_qr_updated and whatsapp_client_ready are managed by GlobalStateContext
      // We only need to listen to whatsapp_initial_state_response for auth flow management
      websocketService.on('connected', handleConnected);
      websocketService.on('disconnected', handleDisconnected);
      websocketService.on('error', handleError);
      websocketService.on('whatsapp_initial_state_response', handleInitialState);

      // Set initial state based on current connection
      if (websocketService.isConnected) {
        setAuthState(AUTH_STATES.CONNECTED);
        requestInitialState();
      } else {
        setAuthState(AUTH_STATES.CONNECTING);
      }

      // Return cleanup function
      return () => {
        websocketService.off('connected', handleConnected);
        websocketService.off('disconnected', handleDisconnected);
        websocketService.off('error', handleError);
        websocketService.off('whatsapp_initial_state_response', handleInitialState);
      };
    } catch (error) {
      console.error('Failed to setup WebSocket listeners:', error);
      setAuthState(AUTH_STATES.ERROR);
      setError('Failed to setup WebSocket');
    }
  }, [requestInitialState, handleInitialState]);

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
    let cleanup;

    setupWebSocket().then(cleanupFn => {
      cleanup = cleanupFn;
    }).catch(error => {
      console.error('[useWhatsAppAuth] Failed to setup WebSocket:', error);
      setAuthState(AUTH_STATES.ERROR);
      setError('Failed to setup WebSocket connection');
    });

    return () => {
      console.log('[useWhatsAppAuth] Cleanup - removing event listeners');
      stopQRRefreshTimer();
      if (cleanup) {
        cleanup();
      }
      // Remove our client type from connection manager
      connectionManager.removeClientType('auth');
      // Clear reconnect timer
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty array = run only once on mount

  // Sync authState with global qrCode and clientReady values
  useEffect(() => {
    // Update authState based on global state changes
    if (clientReady && authState !== AUTH_STATES.AUTHENTICATED) {
      console.log('Global clientReady changed to true, setting AUTHENTICATED');
      setAuthState(AUTH_STATES.AUTHENTICATED);
    } else if (!clientReady && qrCode && authState === AUTH_STATES.AUTHENTICATED) {
      console.log('Global clientReady changed to false with QR, setting QR_REQUIRED');
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
