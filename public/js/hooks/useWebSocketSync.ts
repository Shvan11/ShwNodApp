import { useEffect, useState } from 'react';
import connectionManager from '../services/websocket-connection-manager';
import { WebSocketEvents } from '../constants/websocket-events';

// Configuration
const PERIODIC_SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes - safety net for missed WebSocket messages

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

  // Listen for appointment updates
  useEffect(() => {
    const wsService = connectionManager.getService();

    // Normalize date to YYYY-MM-DD format for comparison
    const normalizeDate = (dateStr: string | undefined | null): string => {
      if (!dateStr) return '';
      // Handle ISO strings (2025-01-02T00:00:00) and plain dates (2025-01-02)
      return dateStr.split('T')[0];
    };

    const handleAppointmentsUpdated = (data: AppointmentsUpdatedData) => {
      const receivedDate = normalizeDate(data?.date);
      const expectedDate = normalizeDate(currentDate);

      console.log('[useWebSocketSync] Received appointments_updated:', {
        receivedDate,
        expectedDate,
        rawData: data?.date,
        match: receivedDate === expectedDate
      });

      // Only reload if the update is for the currently displayed date
      if (receivedDate && receivedDate === expectedDate) {
        console.log('[useWebSocketSync] ✅ Date matches - triggering reload');
        onAppointmentsUpdated(data);
      } else {
        console.log('[useWebSocketSync] ⏭️ Date mismatch - ignoring update');
      }
    };

    wsService.on(WebSocketEvents.APPOINTMENTS_UPDATED, handleAppointmentsUpdated);
    console.log('[useWebSocketSync] 📡 Subscribed to appointments_updated for date:', currentDate);

    return () => {
      wsService.off(WebSocketEvents.APPOINTMENTS_UPDATED, handleAppointmentsUpdated);
      console.log('[useWebSocketSync] 🔌 Unsubscribed from appointments_updated');
    };
  }, [currentDate, onAppointmentsUpdated]);

  // Periodic sync fallback - safety net for any missed WebSocket messages
  // Only active when viewing today's date (when real-time updates matter most)
  useEffect(() => {
    const getTodayDate = (): string => {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    const today = getTodayDate();
    const isViewingToday = currentDate === today;

    // Only set up periodic sync when viewing today's appointments
    if (!isViewingToday) {
      return;
    }

    console.log('[useWebSocketSync] 🔄 Starting periodic sync for today');

    const syncInterval = setInterval(() => {
      if (connectionStatus === 'connected') {
        console.log('[useWebSocketSync] 🔄 Periodic sync triggered');
        onAppointmentsUpdated({ date: currentDate });
      }
    }, PERIODIC_SYNC_INTERVAL_MS);

    return () => {
      clearInterval(syncInterval);
      console.log('[useWebSocketSync] 🔄 Periodic sync stopped');
    };
  }, [currentDate, connectionStatus, onAppointmentsUpdated]);

  return {
    connectionStatus,
    isConnected: connectionStatus === 'connected',
  };
}
