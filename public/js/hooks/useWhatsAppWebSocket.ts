/**
 * Custom hook for WhatsApp WebSocket connection management
 * Uses centralized connection manager to prevent duplicate connections
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useGlobalState } from '../contexts/GlobalStateContext';
import { UI_STATES, type UIState } from '../utils/whatsapp-send-constants';
import connectionManager from '../services/websocket-connection-manager';

/**
 * Sending progress data
 */
export interface SendingProgress {
  started: boolean;
  finished: boolean;
  total: number;
  sent: number;
  failed: number;
}

/**
 * Message status update data from WebSocket
 */
export interface MessageStatusUpdateData {
  date?: string;
  patientId?: number;
  status?: number;
  messageId?: string;
  [key: string]: unknown;
}

/**
 * Initial state response from server
 */
interface InitialStateResponse {
  clientReady?: boolean;
  sendingProgress?: SendingProgress;
  qr?: string;
  [key: string]: unknown;
}

/**
 * WebSocket service interface
 */
interface WebSocketService {
  isConnected: boolean;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  off: (event: string, handler: (...args: unknown[]) => void) => void;
  send: (message: unknown) => Promise<void>;
}

/**
 * Return type for useWhatsAppWebSocket hook
 */
export interface UseWhatsAppWebSocketReturn {
  connectionStatus: UIState;
  clientReady: boolean;
  sendingProgress: SendingProgress;
  messageStatusUpdate: MessageStatusUpdateData | null;
  requestInitialState: () => void;
}

/**
 * Custom hook for managing WhatsApp WebSocket connection
 */
export function useWhatsAppWebSocket(currentDate: string): UseWhatsAppWebSocketReturn {
  // Use global state for clientReady instead of duplicating listener
  const { whatsappClientReady: clientReady } = useGlobalState();

  const [connectionStatus, setConnectionStatus] = useState<UIState>(UI_STATES.DISCONNECTED);
  const [sendingProgress, setSendingProgress] = useState<SendingProgress>({
    started: false,
    finished: false,
    total: 0,
    sent: 0,
    failed: 0,
  });
  const [messageStatusUpdate, setMessageStatusUpdate] = useState<MessageStatusUpdateData | null>(
    null
  );

  const wsRef = useRef<WebSocketService | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentDateRef = useRef(currentDate);
  const lastRequestedDateRef = useRef<string | null>(null);

  // Keep currentDateRef updated
  useEffect(() => {
    currentDateRef.current = currentDate;
  }, [currentDate]);

  // Request initial state from server (defined before setupWebSocket)
  const requestInitialState = useCallback(() => {
    if (wsRef.current && wsRef.current.isConnected) {
      const dateToRequest = currentDateRef.current;

      // Prevent duplicate requests for the same date
      if (lastRequestedDateRef.current === dateToRequest) {
        console.log(
          `[useWhatsAppWebSocket] Skipping duplicate initial state request for date: ${dateToRequest}`
        );
        return;
      }

      lastRequestedDateRef.current = dateToRequest;
      console.log(
        `[useWhatsAppWebSocket] Requesting initial state from server for date: ${dateToRequest}`
      );

      wsRef.current
        .send({
          type: 'request_whatsapp_initial_state',
          data: {
            date: dateToRequest,
            timestamp: Date.now(),
          },
        })
        .catch((error: Error) => {
          console.error('Failed to request initial state:', error);
        });
    }
  }, []); // No dependencies - uses ref

  // Setup WebSocket service using connection manager
  const setupWebSocket = useCallback(async () => {
    try {
      console.log('[useWhatsAppWebSocket] Setting up WebSocket connection');

      // Use connection manager to ensure single connection
      await connectionManager.ensureConnected('waStatus', {
        PDate: currentDate,
      });

      console.log('[useWhatsAppWebSocket] WebSocket connected via connection manager');

      // Get the WebSocket service from connection manager
      const websocketService = connectionManager.getService() as WebSocketService;

      // Setup event handlers
      const handleConnecting = () => setConnectionStatus(UI_STATES.CONNECTING);
      const handleConnected = () => {
        setConnectionStatus(UI_STATES.CONNECTED);
        requestInitialState();
      };
      const handleDisconnected = () => setConnectionStatus(UI_STATES.DISCONNECTED);
      const handleError = (error: unknown) => {
        setConnectionStatus(UI_STATES.ERROR);
        console.error('WebSocket error:', error);
      };

      const handleMessageStatus = (data: MessageStatusUpdateData) => {
        setMessageStatusUpdate(data);
      };

      const handleSendingStarted = (data: Partial<SendingProgress>) => {
        setSendingProgress({
          started: true,
          finished: false,
          total: data.total || 0,
          sent: data.sent || 0,
          failed: data.failed || 0,
        });
      };

      const handleSendingProgress = (data: Partial<SendingProgress>) => {
        setSendingProgress((prev) => ({
          ...prev,
          sent: data.sent || 0,
          failed: data.failed || 0,
          finished: data.finished || false,
        }));
      };

      const handleSendingFinished = (_data: unknown) => {
        setSendingProgress((prev) => ({
          ...prev,
          finished: true,
        }));
      };

      const handleInitialState = (data: InitialStateResponse) => {
        if (data) {
          // clientReady is now managed by GlobalStateContext, no need to set it here

          if (data.sendingProgress && data.sendingProgress.started && !data.sendingProgress.finished) {
            setSendingProgress(data.sendingProgress);
          } else if (data.sendingProgress && data.sendingProgress.finished) {
            // Clear finished progress
            setSendingProgress({
              started: false,
              finished: false,
              total: 0,
              sent: 0,
              failed: 0,
            });
          }
        }
      };

      // Register event handlers
      // NOTE: whatsapp_client_ready is managed by GlobalStateContext - no duplicate listener needed
      websocketService.on('connecting', handleConnecting);
      websocketService.on('connected', handleConnected);
      websocketService.on('disconnected', handleDisconnected);
      websocketService.on('error', handleError);
      websocketService.on('whatsapp_message_status', handleMessageStatus as (...args: unknown[]) => void);
      websocketService.on('whatsapp_sending_started', handleSendingStarted as (...args: unknown[]) => void);
      websocketService.on('whatsapp_sending_progress', handleSendingProgress as (...args: unknown[]) => void);
      websocketService.on('whatsapp_sending_finished', handleSendingFinished as (...args: unknown[]) => void);
      websocketService.on('whatsapp_initial_state_response', handleInitialState as (...args: unknown[]) => void);

      // Set connection status based on current state
      if (websocketService.isConnected) {
        setConnectionStatus(UI_STATES.CONNECTED);
        requestInitialState();
      } else {
        setConnectionStatus(UI_STATES.CONNECTING);
      }

      wsRef.current = websocketService;

      // Cleanup function
      return () => {
        websocketService.off('connecting', handleConnecting);
        websocketService.off('connected', handleConnected);
        websocketService.off('disconnected', handleDisconnected);
        websocketService.off('error', handleError);
        websocketService.off('whatsapp_message_status', handleMessageStatus as (...args: unknown[]) => void);
        websocketService.off('whatsapp_sending_started', handleSendingStarted as (...args: unknown[]) => void);
        websocketService.off('whatsapp_sending_progress', handleSendingProgress as (...args: unknown[]) => void);
        websocketService.off('whatsapp_sending_finished', handleSendingFinished as (...args: unknown[]) => void);
        websocketService.off('whatsapp_initial_state_response', handleInitialState as (...args: unknown[]) => void);
      };
    } catch (error) {
      console.error('Failed to setup WebSocket listeners:', error);
      setConnectionStatus(UI_STATES.ERROR);
    }
  }, []); // Empty dependency - only setup once on mount

  // Setup WebSocket on mount (only once)
  useEffect(() => {
    let cleanup: (() => void) | undefined;

    setupWebSocket()
      .then((cleanupFn) => {
        cleanup = cleanupFn;
      })
      .catch((error) => {
        console.error('[useWhatsAppWebSocket] Failed to setup WebSocket:', error);
        setConnectionStatus(UI_STATES.ERROR);
      });

    return () => {
      console.log('[useWhatsAppWebSocket] Cleanup - removing event listeners');
      if (cleanup) cleanup();
      // Remove our client type from connection manager
      connectionManager.removeClientType('waStatus');
      // Clear any reconnect timers
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      // Reset last requested date
      lastRequestedDateRef.current = null;
    };
  }, [setupWebSocket]);

  // Request initial state when date changes (without reconnecting WebSocket)
  useEffect(() => {
    // Only request if we have an active connection
    if (connectionStatus === UI_STATES.CONNECTED && currentDate) {
      console.log(
        `[useWhatsAppWebSocket] Date changed to ${currentDate}, requesting initial state...`
      );
      requestInitialState();
    }
  }, [currentDate, connectionStatus, requestInitialState]);

  return {
    connectionStatus,
    clientReady,
    sendingProgress,
    messageStatusUpdate,
    requestInitialState,
  };
}
