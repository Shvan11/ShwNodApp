import React, { createContext, useContext, useState, useEffect } from 'react';
import { createWebSocketConnection } from '/js/services/websocket.js';

const GlobalStateContext = createContext();

/**
 * Global State Provider for Single-SPA Application
 * Manages shared state across all micro-apps including:
 * - WebSocket connection (persistent across apps)
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
    console.log('[GlobalState] Initializing WebSocket connection');

    // Create a new WebSocket instance for this SPA session
    const ws = createWebSocketConnection({
      debug: true,
      autoConnect: false
    });

    // Set up connection event listeners
    ws.on('connection_established', () => {
      console.log('[GlobalState] WebSocket connected');
      setIsWebSocketConnected(true);
    });

    ws.on('connection_lost', () => {
      console.log('[GlobalState] WebSocket disconnected');
      setIsWebSocketConnected(false);
    });

    ws.on('connection_error', (error) => {
      console.error('[GlobalState] WebSocket error:', error);
      setIsWebSocketConnected(false);
    });

    // WhatsApp events
    ws.on('whatsapp_client_ready', () => {
      console.log('[GlobalState] WhatsApp client ready');
      setWhatsappClientReady(true);
    });

    ws.on('whatsapp_qr_updated', (data) => {
      console.log('[GlobalState] WhatsApp QR code updated');
      setWhatsappQrCode(data.qr);
    });

    // Store WebSocket instance in state
    setWebsocket(ws);

    // Connect to WebSocket server
    ws.connect().catch(error => {
      console.error('[GlobalState] Failed to connect WebSocket:', error);
    });

    // Cleanup on unmount (only when entire app closes)
    return () => {
      console.log('[GlobalState] Cleaning up WebSocket connection');
      ws.disconnect();
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
