/**
 * Custom hook for WhatsApp send-page state (replaces the WS waStatus channel).
 * Subscribes to the shared SSE singleton; the initial state comes from the shared
 * `whatsappInitialStateQuery` (the status provider reads the same one).
 */
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { batchProgress, type BatchProgress } from '@shared/contracts/whatsapp.contract';
import { whatsappInitialStateQuery } from '@/query/queries';
import { useWhatsAppStatus } from '../contexts/GlobalStateContext';
import { UI_STATES, type UIState } from '../utils/whatsapp-send-constants';
import sseWhatsapp from '../services/sse-whatsapp';

/** The reminder batch's progress, as the server reports it (frames + initial-state). */
export type SendingProgress = BatchProgress;

export const IDLE_PROGRESS: SendingProgress = {
  started: false,
  finished: false,
  total: 0,
  sent: 0,
  failed: 0,
  date: null,
  error: null,
};

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
}

/** A frame the batch's progress can be read from, or null if it isn't one. */
function parseProgress(data: unknown): SendingProgress | null {
  const parsed = batchProgress.safeParse(data);
  if (!parsed.success) {
    console.error('[useWhatsAppSync] unreadable batch progress frame', parsed.error);
    return null;
  }
  const { active: _active, ...progress } = parsed.data;
  return progress;
}

export function useWhatsAppSync(): UseWhatsAppSyncReturn {
  const { clientReady } = useWhatsAppStatus();

  // Starts CONNECTING: the mount effect always opens the SSE stream immediately,
  // so this is the true first-paint state (and keeps that setState out of the
  // effect body — react-hooks/set-state-in-effect).
  const [connectionStatus, setConnectionStatus] = useState<UIState>(UI_STATES.CONNECTING);
  const [sendingProgress, setSendingProgress] = useState<SendingProgress>(IDLE_PROGRESS);
  const [messageStatusUpdate, setMessageStatusUpdate] = useState<MessageStatusUpdateData | null>(
    null
  );
  const [unconfirmedSend, setUnconfirmedSend] = useState<UnconfirmedSendData | null>(null);

  // Join a batch that is already running — this tab was reloaded, opened second,
  // or came back to /send mid-batch (FE-F16-2: the server never sent this, so the
  // page sat on "ready" over a running batch and offered Start again). Applied
  // once per successful read; a batch that ended while the stream was down lands
  // as its finished state, so the page doesn't sit on "Sending 7/22".
  const { data: snapshot, dataUpdatedAt } = useQuery(whatsappInitialStateQuery());
  const [appliedAt, setAppliedAt] = useState(0);
  if (snapshot && dataUpdatedAt !== appliedAt) {
    setAppliedAt(dataUpdatedAt);
    const server = snapshot.sendingProgress;
    if (server?.active) {
      const { active: _active, ...progress } = server;
      setSendingProgress(progress);
    } else if (server && sendingProgress.started && !sendingProgress.finished && server.finished) {
      const { active: _active, ...progress } = server;
      setSendingProgress(progress);
    }
  }

  // Subscribe to SSE lifecycle + event payloads on mount.
  useEffect(() => {
    const handleConnecting = () => setConnectionStatus(UI_STATES.CONNECTING);
    const handleConnected = () => setConnectionStatus(UI_STATES.CONNECTED);
    // A dropped stream is `reconnecting` (the channel is retrying); `disconnected`
    // is only ever the last consumer letting go, which this page never sees while
    // it holds the channel (FE-F16-12).
    const handleReconnecting = () => setConnectionStatus(UI_STATES.DISCONNECTED);
    const handleError = () => setConnectionStatus(UI_STATES.ERROR);

    const handleMessageStatus = (data: unknown) => {
      setMessageStatusUpdate(data as MessageStatusUpdateData);
    };

    // All three frames carry the whole batch's progress, so each one replaces it.
    const handleProgressFrame = (data: unknown) => {
      const progress = parseProgress(data);
      if (progress) setSendingProgress(progress);
    };

    const handleSendUnconfirmed = (data: unknown) => {
      setUnconfirmedSend((data as UnconfirmedSendData) ?? {});
    };

    sseWhatsapp.on('connecting', handleConnecting);
    sseWhatsapp.on('connected', handleConnected);
    sseWhatsapp.on('reconnecting', handleReconnecting);
    sseWhatsapp.on('error', handleError);
    sseWhatsapp.on('whatsapp_message_status', handleMessageStatus);
    sseWhatsapp.on('whatsapp_sending_started', handleProgressFrame);
    sseWhatsapp.on('whatsapp_sending_progress', handleProgressFrame);
    sseWhatsapp.on('whatsapp_sending_finished', handleProgressFrame);
    sseWhatsapp.on('whatsapp_send_unconfirmed', handleSendUnconfirmed);

    sseWhatsapp
      .ensureConnected()
      .then(() => setConnectionStatus(UI_STATES.CONNECTED))
      .catch((err) => {
        console.error('[useWhatsAppSync] Failed to open SSE:', err);
        setConnectionStatus(UI_STATES.ERROR);
      });

    return () => {
      sseWhatsapp.off('connecting', handleConnecting);
      sseWhatsapp.off('connected', handleConnected);
      sseWhatsapp.off('reconnecting', handleReconnecting);
      sseWhatsapp.off('error', handleError);
      sseWhatsapp.off('whatsapp_message_status', handleMessageStatus);
      sseWhatsapp.off('whatsapp_sending_started', handleProgressFrame);
      sseWhatsapp.off('whatsapp_sending_progress', handleProgressFrame);
      sseWhatsapp.off('whatsapp_sending_finished', handleProgressFrame);
      sseWhatsapp.off('whatsapp_send_unconfirmed', handleSendUnconfirmed);
      sseWhatsapp.release();
    };
  }, []);

  return {
    connectionStatus,
    clientReady,
    sendingProgress,
    messageStatusUpdate,
    unconfirmedSend,
  };
}
