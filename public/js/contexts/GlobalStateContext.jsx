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
    console.log('[GlobalState] Initializing WebSocket connection (using singleton)');

    // Use the singleton WebSocket instance (shared across all components)
    // This prevents multiple connections and ensures consistent state
    const ws = wsService;

    // Set up connection event listeners BEFORE connecting
    // Note: WebSocketService emits 'connected', 'disconnected', and 'error' events
    const handleConnected = () => {
      console.log('[GlobalState] WebSocket connected');
      setIsWebSocketConnected(true);

      // Request initial WhatsApp state when connected
      console.log('[GlobalState] Requesting initial WhatsApp state...');
      ws.send({
        type: 'request_whatsapp_initial_state',
        data: { timestamp: Date.now() }
      }).catch(error => {
        console.error('[GlobalState] Failed to request initial state:', error);
      });
    };

    const handleDisconnected = () => {
      console.log('[GlobalState] WebSocket disconnected');
      setIsWebSocketConnected(false);
    };

    const handleError = (error) => {
      console.error('[GlobalState] WebSocket error:', error);
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

    // Note: Don't call connect() here - other components (like useWebSocketSync) will handle connection
    // This prevents duplicate connections and race conditions

    // Set initial connection status based on current state
    setIsWebSocketConnected(ws.isConnected);

    // If WebSocket is already connected, request initial state immediately
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
