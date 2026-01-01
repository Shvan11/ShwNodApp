import { useEffect, useState } from 'react';
import connectionManager from '../services/websocket-connection-manager';
import { WebSocketEvents } from '../constants/websocket-events';

/**
 * Connection status type
 */
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'error';

/**
 * Appointments updated event data
 */
export interface AppointmentsUpdatedData {
  date?: string;
  appointments?: unknown[];
  [key: string]: unknown;
}

/**
 * Return type for useWebSocketSync hook
 */
export interface UseWebSocketSyncReturn {
  connectionStatus: ConnectionStatus;
  isConnected: boolean;
}

/**
 * Custom hook for WebSocket real-time appointment updates
 *
 * SIMPLIFIED APPROACH:
 * - Just reload appointments when WebSocket message arrives
 * - No sequence numbers, no ACKs, no deduplication
 * - Database is the single source of truth
 */
export function useWebSocketSync(
  currentDate: string,
  onAppointmentsUpdated: (data: AppointmentsUpdatedData) => void
): UseWebSocketSyncReturn {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');

  // Initialize WebSocket connection
  useEffect(() => {
    const initializeWebSocket = async () => {
      console.log('[useWebSocketSync] Requesting WebSocket connection');

      try {
        await connectionManager.ensureConnected('daily-appointments', {
          PDate: currentDate,
        });

        setConnectionStatus('connected');
        console.log('[useWebSocketSync] WebSocket connected successfully');
      } catch (err) {
        console.error('[useWebSocketSync] Connection failed, auto-reconnect will retry:', err);
        setConnectionStatus('connecting');
      }
    };

    initializeWebSocket();

    return () => {
      console.log('[useWebSocketSync] Cleanup');
      connectionManager.removeClientType('daily-appointments');
    };
  }, []);

  // Listen for connection events
  useEffect(() => {
    const wsService = connectionManager.getService();

    const handleConnected = () => {
      console.log('[useWebSocketSync] WebSocket connected');
      setConnectionStatus('connected');
    };

    const handleDisconnected = () => {
      console.log('[useWebSocketSync] WebSocket disconnected');
      setConnectionStatus('disconnected');
    };

    const handleReconnecting = () => {
      console.log('[useWebSocketSync] WebSocket reconnecting...');
      setConnectionStatus('reconnecting');
    };

    const handleError = () => {
      console.error('[useWebSocketSync] WebSocket error');
      setConnectionStatus('error');
    };

    wsService.on('connected', handleConnected);
    wsService.on('disconnected', handleDisconnected);
    wsService.on('reconnecting', handleReconnecting);
    wsService.on('error', handleError);

    return () => {
      wsService.off('connected', handleConnected);
      wsService.off('disconnected', handleDisconnected);
      wsService.off('reconnecting', handleReconnecting);
      wsService.off('error', handleError);
    };
  }, []);

  // Listen for appointment updates - SIMPLIFIED
  useEffect(() => {
    const wsService = connectionManager.getService();

    const handleAppointmentsUpdated = (data: AppointmentsUpdatedData) => {
      // Only reload if the update is for the currently displayed date
      if (data && data.date === currentDate) {
        console.log('[useWebSocketSync] Appointments updated for date:', currentDate);
        onAppointmentsUpdated(data);
      }
    };

    wsService.on(WebSocketEvents.APPOINTMENTS_UPDATED, handleAppointmentsUpdated);

    return () => {
      wsService.off(WebSocketEvents.APPOINTMENTS_UPDATED, handleAppointmentsUpdated);
    };
  }, [currentDate, onAppointmentsUpdated]);

  return {
    connectionStatus,
    isConnected: connectionStatus === 'connected',
  };
}
