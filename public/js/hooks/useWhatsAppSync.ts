/**
 * Custom hook for WhatsApp send-page state (replaces the WS waStatus channel).
 * Subscribes to the shared SSE singleton and primes initial state via REST.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchJSON } from '@/core/http';
import * as whatsappContract from '@shared/contracts/whatsapp.contract';
import { useWhatsAppStatus } from '../contexts/GlobalStateContext';
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
 * Server-detected zero-ack batch: messages reported "sent" but WhatsApp never
 * confirmed a single one — almost certainly not delivered.
 */
export interface UnconfirmedSendData {
  date?: string;
  sentCount?: number;
  message?: string;
}

/**
 * Return type for useWhatsAppSync hook
 */
export interface UseWhatsAppSyncReturn {
  connectionStatus: UIState;
  clientReady: boolean;
  sendingProgress: SendingProgress;
  messageStatusUpdate: MessageStatusUpdateData | null;
  unconfirmedSend: UnconfirmedSendData | null;
  requestInitialState: () => void;
}

export function useWhatsAppSync(): UseWhatsAppSyncReturn {
  const { clientReady } = useWhatsAppStatus();

  // Starts CONNECTING: the mount effect always opens the SSE stream immediately,
  // so this is the true first-paint state (and keeps that setState out of the
  // effect body — react-hooks/set-state-in-effect).
  const [connectionStatus, setConnectionStatus] = useState<UIState>(UI_STATES.CONNECTING);
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
  const [unconfirmedSend, setUnconfirmedSend] = useState<UnconfirmedSendData | null>(null);

  // Single-flight guard for the initial-state read (true while one is in flight).
  const inFlightRef = useRef(false);

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

  // Fetch initial state via REST (replaces the WS RPC). `/api/wa/initial-state`
  // takes no date — it reads only the session and the server's message state —
  // so the only dedupe is single-flight: a call while one is in flight is
  // dropped (the connect + mount triggers land together), and every later call
  // refetches. It used to dedupe BY DATE, which made an explicit refresh after a
  // finished send a permanent no-op until the date changed (audit FE-F3-11).
  const requestInitialState = useCallback(() => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    fetchJSON<InitialStateResponse>('/api/wa/initial-state', { schema: whatsappContract.initialState.response })
      .then(applyInitialState)
      .catch((err) => {
        console.error('[useWhatsAppSync] initial-state fetch failed', err);
      })
      .finally(() => {
        inFlightRef.current = false;
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
    const handleReconnected = () => requestInitialState();

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

    const handleSendUnconfirmed = (data: unknown) => {
      setUnconfirmedSend((data as UnconfirmedSendData) ?? {});
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
    sseWhatsapp.on('whatsapp_send_unconfirmed', handleSendUnconfirmed);

    sseWhatsapp
      .ensureConnected()
      .then(() => {
        setConnectionStatus(UI_STATES.CONNECTED);
        requestInitialState();
      })
      .catch((err) => {
        console.error('[useWhatsAppSync] Failed to open SSE:', err);
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
      sseWhatsapp.off('whatsapp_send_unconfirmed', handleSendUnconfirmed);
      sseWhatsapp.release();
    };
  }, [requestInitialState]);

  return {
    connectionStatus,
    clientReady,
    sendingProgress,
    messageStatusUpdate,
    unconfirmedSend,
    requestInitialState,
  };
}
