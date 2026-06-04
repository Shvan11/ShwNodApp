/**
 * Custom hook for WhatsApp send-page state (replaces the WS waStatus channel).
 * Subscribes to the shared SSE singleton and primes initial state via REST.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useGlobalState } from '../contexts/GlobalStateContext';
import { UI_STATES, type UIState } from '../utils/whatsapp-send-constants';
import sseWhatsapp from '../services/sse-whatsapp';

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
 * Message status update data from the WhatsApp channel
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
 * Return type for useWhatsAppWebSocket hook
 */
export interface UseWhatsAppWebSocketReturn {
  connectionStatus: UIState;
  clientReady: boolean;
  sendingProgress: SendingProgress;
  messageStatusUpdate: MessageStatusUpdateData | null;
  requestInitialState: (dateToRequest?: string) => void;
}

export function useWhatsAppWebSocket(currentDate: string): UseWhatsAppWebSocketReturn {
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

  const currentDateRef = useRef(currentDate);
  const lastRequestedDateRef = useRef<string | null>(null);

  useEffect(() => {
    currentDateRef.current = currentDate;
  }, [currentDate]);

  const applyInitialState = useCallback((data: InitialStateResponse | null) => {
    if (!data) return;
    if (data.sendingProgress && data.sendingProgress.started && !data.sendingProgress.finished) {
      setSendingProgress(data.sendingProgress);
    } else if (data.sendingProgress && data.sendingProgress.finished) {
      setSendingProgress({
        started: false,
        finished: false,
        total: 0,
        sent: 0,
        failed: 0,
      });
    }
  }, []);

  // Fetch initial state via REST (replaces the WS RPC). Preserves the
  // per-date dedupe so a date-change effect doesn't re-fire for the same
  // date during quick re-renders. The date is an explicit (optional) arg:
  // synchronous date-driven callers pass the fresh value directly, while
  // async SSE handlers omit it and fall back to the latest-date ref.
  const requestInitialState = useCallback((dateToRequest: string = currentDateRef.current) => {
    if (!dateToRequest) return;
    if (lastRequestedDateRef.current === dateToRequest) {
      return;
    }
    lastRequestedDateRef.current = dateToRequest;

    fetch('/api/wa/initial-state', { credentials: 'same-origin' })
      .then((res) => {
        if (!res.ok) throw new Error(`Initial state request failed: ${res.status}`);
        return res.json() as Promise<InitialStateResponse>;
      })
      .then(applyInitialState)
      .catch((err) => {
        console.error('[useWhatsAppWebSocket] initial-state fetch failed', err);
        // Clear the dedupe key so a later trigger can retry this date.
        // Guarded so we don't clobber a newer in-flight request for another date.
        if (lastRequestedDateRef.current === dateToRequest) {
          lastRequestedDateRef.current = null;
        }
      });
  }, [applyInitialState]);

  // Subscribe to SSE lifecycle + event payloads on mount.
  useEffect(() => {
    const handleConnecting = () => setConnectionStatus(UI_STATES.CONNECTING);
    const handleConnected = () => {
      setConnectionStatus(UI_STATES.CONNECTED);
      requestInitialState();
    };
    const handleDisconnected = () => setConnectionStatus(UI_STATES.DISCONNECTED);
    const handleError = () => setConnectionStatus(UI_STATES.ERROR);
    const handleReconnected = () => {
      // Force a refresh on reconnect by clearing the dedupe.
      lastRequestedDateRef.current = null;
      requestInitialState();
    };

    const handleMessageStatus = (data: unknown) => {
      setMessageStatusUpdate(data as MessageStatusUpdateData);
    };

    const handleSendingStarted = (data: unknown) => {
      const typed = data as Partial<SendingProgress>;
      setSendingProgress({
        started: true,
        finished: false,
        total: typed.total || 0,
        sent: typed.sent || 0,
        failed: typed.failed || 0,
      });
    };

    const handleSendingProgress = (data: unknown) => {
      const typed = data as Partial<SendingProgress>;
      setSendingProgress((prev) => ({
        ...prev,
        sent: typed.sent || 0,
        failed: typed.failed || 0,
        finished: typed.finished || false,
      }));
    };

    const handleSendingFinished = () => {
      setSendingProgress((prev) => ({
        ...prev,
        finished: true,
      }));
    };

    sseWhatsapp.on('connecting', handleConnecting);
    sseWhatsapp.on('connected', handleConnected);
    sseWhatsapp.on('disconnected', handleDisconnected);
    sseWhatsapp.on('error', handleError);
    sseWhatsapp.on('reconnected', handleReconnected);
    sseWhatsapp.on('whatsapp_message_status', handleMessageStatus);
    sseWhatsapp.on('whatsapp_sending_started', handleSendingStarted);
    sseWhatsapp.on('whatsapp_sending_progress', handleSendingProgress);
    sseWhatsapp.on('whatsapp_sending_finished', handleSendingFinished);

    setConnectionStatus(UI_STATES.CONNECTING);
    sseWhatsapp
      .ensureConnected()
      .then(() => {
        setConnectionStatus(UI_STATES.CONNECTED);
        requestInitialState();
      })
      .catch((err) => {
        console.error('[useWhatsAppWebSocket] Failed to open SSE:', err);
        setConnectionStatus(UI_STATES.ERROR);
      });

    return () => {
      sseWhatsapp.off('connecting', handleConnecting);
      sseWhatsapp.off('connected', handleConnected);
      sseWhatsapp.off('disconnected', handleDisconnected);
      sseWhatsapp.off('error', handleError);
      sseWhatsapp.off('reconnected', handleReconnected);
      sseWhatsapp.off('whatsapp_message_status', handleMessageStatus);
      sseWhatsapp.off('whatsapp_sending_started', handleSendingStarted);
      sseWhatsapp.off('whatsapp_sending_progress', handleSendingProgress);
      sseWhatsapp.off('whatsapp_sending_finished', handleSendingFinished);
      sseWhatsapp.release();
      lastRequestedDateRef.current = null;
    };
  }, [requestInitialState]);

  // Request initial state when date changes (transport stays connected).
  // Pass `currentDate` explicitly so this doesn't depend on the ref-updater
  // effect having run first — no ordering fragility.
  useEffect(() => {
    if (connectionStatus === UI_STATES.CONNECTED && currentDate) {
      requestInitialState(currentDate);
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
