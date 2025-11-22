import React, { createContext, useContext, useState, useEffect } from 'react';
import wsService from '../services/websocket.js';

const GlobalStateContext = createContext();

/**
 * Global State Provider for React Application
 * Manages shared state across all components including:
 * - WebSocket connection (persistent across the app)
 * - Current patient data
 * - User information
 * - Appointments cache
 */
export function GlobalStateProvider({ children }) {
  // User state
  const [user, setUser] = useState(null);

  // Current patient state (shared across patient-related apps)
  const [currentPatient, setCurrentPatient] = useState(null);

  // WebSocket connection (initialized once, shared by all apps)
  const [websocket, setWebsocket] = useState(null);
  const [isWebSocketConnected, setIsWebSocketConnected] = useState(false);

  // Appointments cache (avoid refetching)
  const [appointmentsCache, setAppointmentsCache] = useState({});

  // WhatsApp client state (shared between send and auth apps)
  const [whatsappClientReady, setWhatsappClientReady] = useState(false);
  const [whatsappQrCode, setWhatsappQrCode] = useState(null);

  // Initialize WebSocket connection once on mount
  useEffect(() => {
    console.log('[GlobalState] Initializing WebSocket event listeners (NOT connecting - other hooks handle connection)');

    // Use the singleton WebSocket instance (shared across all components)
    // This prevents multiple connections and ensures consistent state
    const ws = wsService;

    // Track last timeout error to prevent console spam
    let lastTimeoutErrorLog = 0;

    // Set up connection event listeners
    // NOTE: We do NOT call connect() here - other hooks (useWebSocketSync, etc.) handle connection
    // This prevents multiple connect() calls on the same singleton instance
    const handleConnected = () => {
      console.log('[GlobalState] WebSocket connected');
      setIsWebSocketConnected(true);

      // Broadcast reconnection event for components to refresh their data
      console.log('[GlobalState] Broadcasting reconnection event');
      window.dispatchEvent(new CustomEvent('websocket_reconnected', {
        detail: { timestamp: Date.now() }
      }));

      // NOTE: Initial WhatsApp state is requested by useWhatsAppWebSocket hook
      // with the current date, so we don't need to request it here
    };

    const handleDisconnected = () => {
      console.log('[GlobalState] WebSocket disconnected');
      setIsWebSocketConnected(false);
    };

    const handleError = (error) => {
      // Reduce console spam from timeout errors during auto-reconnect
      const isTimeoutError = error && error.message && error.message.includes('Connection timeout');
      const now = Date.now();

      if (!isTimeoutError || !lastTimeoutErrorLog || (now - lastTimeoutErrorLog) > 60000) {
        console.error('[GlobalState] WebSocket error:', error);
        if (isTimeoutError) {
          lastTimeoutErrorLog = now;
        }
      }
      setIsWebSocketConnected(false);
    };

    const handleConnecting = () => {
      console.log('[GlobalState] WebSocket connecting...');
    };

    // WhatsApp events
    const handleWhatsAppReady = (data) => {
      console.log('[GlobalState] WhatsApp client ready:', data);
      setWhatsappClientReady(data?.clientReady ?? true);
      // If client is ready, clear QR code
      if (data?.clientReady) {
        setWhatsappQrCode(null);
      }
    };

    const handleWhatsAppQR = (data) => {
      console.log('[GlobalState] WhatsApp QR code updated');
      setWhatsappQrCode(data.qr);
      // If showing QR, client is not ready
      if (data.qr) {
        setWhatsappClientReady(false);
      }
    };

    const handleInitialState = (data) => {
      console.log('[GlobalState] WhatsApp initial state received:', data);
      if (data) {
        // Set client ready status
        if (data.clientReady !== undefined) {
          setWhatsappClientReady(data.clientReady);
          console.log('[GlobalState] Initial clientReady:', data.clientReady);
        }
        // Set QR code if available
        if (data.qr) {
          setWhatsappQrCode(data.qr);
          console.log('[GlobalState] Initial QR code available');
        } else {
          setWhatsappQrCode(null);
        }
      }
    };

    // Register event listeners
    ws.on('connected', handleConnected);
    ws.on('disconnected', handleDisconnected);
    ws.on('error', handleError);
    ws.on('connecting', handleConnecting);
    ws.on('whatsapp_client_ready', handleWhatsAppReady);
    ws.on('whatsapp_qr_updated', handleWhatsAppQR);
    ws.on('whatsapp_initial_state_response', handleInitialState);

    // Store WebSocket instance in state
    setWebsocket(ws);

    // Set initial connection status based on current state
    setIsWebSocketConnected(ws.isConnected);

    // NOTE: We do NOT call connect() here
    // The first component that needs the connection (useWebSocketSync, useWhatsAppWebSocket, etc.)
    // will handle connecting via the connection manager
    // This prevents duplicate connect() calls and race conditions

    // If WebSocket is already connected (from another component), request initial state
    if (ws.isConnected) {
      console.log('[GlobalState] WebSocket already connected, requesting initial state...');
      ws.send({
        type: 'request_whatsapp_initial_state',
        data: { timestamp: Date.now() }
      }).catch(error => {
        console.error('[GlobalState] Failed to request initial state:', error);
      });
    }

    // Cleanup on unmount (only when entire app closes)
    return () => {
      console.log('[GlobalState] Cleaning up WebSocket listeners');
      // Remove event listeners to prevent memory leaks
      ws.off('connected', handleConnected);
      ws.off('disconnected', handleDisconnected);
      ws.off('error', handleError);
      ws.off('connecting', handleConnecting);
      ws.off('whatsapp_client_ready', handleWhatsAppReady);
      ws.off('whatsapp_qr_updated', handleWhatsAppQR);
      ws.off('whatsapp_initial_state_response', handleInitialState);
      // Note: Don't disconnect here - other components may still need the connection
    };
  }, []);

  // Wake detection - detects when computer wakes from sleep
  useEffect(() => {
    let lastCheck = Date.now();

    const detectWake = () => {
      const now = Date.now();
      const elapsed = now - lastCheck;

      // If more than 5 minutes passed, likely woke from sleep
      if (elapsed > 5 * 60 * 1000) {
        console.log('[GlobalState] 🌅 Wake from sleep detected - forcing reconnect');

        if (websocket) {
          // Disconnect and reconnect to ensure fresh connection
          if (websocket.isConnected) {
            console.log('[GlobalState] Disconnecting stale connection...');
            websocket.disconnect(1000, 'Wake from sleep - forcing reconnect');
          }

          // Reconnect with fresh parameters
          console.log('[GlobalState] Reconnecting...');
          websocket.connect({ timestamp: Date.now(), reason: 'wake_from_sleep' }).catch(err => {
            console.error('[GlobalState] Reconnect failed:', err);
          });
        }
      }

      lastCheck = now;
    };

    // Check every 30 seconds for time jumps
    const interval = setInterval(detectWake, 30000);

    return () => clearInterval(interval);
  }, [websocket]);

  // Helper function to update patient
  const updateCurrentPatient = (patient) => {
    console.log('[GlobalState] Updating current patient:', patient?.code || patient?.id || 'null');
    setCurrentPatient(patient);
  };

  // Helper function to clear patient
  const clearCurrentPatient = () => {
    console.log('[GlobalState] Clearing current patient');
    setCurrentPatient(null);
  };

  // Helper function to update appointments cache
  const updateAppointmentsCache = (date, appointments) => {
    setAppointmentsCache(prev => ({
      ...prev,
      [date]: appointments
    }));
  };

  // Context value
  const value = {
    // User
    user,
    setUser,

    // Patient
    currentPatient,
    updateCurrentPatient,
    clearCurrentPatient,

    // WebSocket
    websocket,
    isWebSocketConnected,

    // WhatsApp
    whatsappClientReady,
    setWhatsappClientReady,
    whatsappQrCode,
    setWhatsappQrCode,

    // Appointments
    appointmentsCache,
    updateAppointmentsCache,
  };

  return (
    <GlobalStateContext.Provider value={value}>
      {children}
    </GlobalStateContext.Provider>
  );
}

/**
 * Hook to access global state
 * Usage: const { currentPatient, websocket } = useGlobalState();
 */
export function useGlobalState() {
  const context = useContext(GlobalStateContext);

  if (!context) {
    throw new Error('useGlobalState must be used within GlobalStateProvider');
  }

  return context;
}

export default GlobalStateContext;
