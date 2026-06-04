/**
 * Custom hook for fetching and displaying message status
 */
import { useState, useEffect, useCallback } from 'react';
import {
  API_ENDPOINTS,
  MESSAGE_STATUS_TEXT,
  MESSAGE_STATUS_CLASS,
  type MessageStatusValue,
} from '../utils/whatsapp-send-constants';
import { escapeHtml } from '../utils/whatsapp-validation';
import { APIClient } from '../utils/whatsapp-api-client';

const apiClient = new APIClient();

/**
 * Message data from API
 */
export interface Message {
  PatientID?: number;
  patient_name?: string;
  Phone?: string;
  MessageText?: string;
  status: MessageStatusValue;
  SentAt?: string;
  [key: string]: unknown;
}

/**
 * Message status API response
 */
interface MessageStatusApiResponse {
  success?: boolean;
  messages?: Message[];
  data?: Message[];
  error?: string;
}

/**
 * Message status summary
 */
export interface MessageSummary {
  total: number;
  pending: number;
  ready: number;
  server: number;
  device: number;
  read: number;
  played: number;
  failed: number;
}

/**
 * Message status update data from WebSocket
 * Using number for status to be compatible with MessageStatusUpdateData from useWhatsAppWebSocket
 */
export interface MessageStatusUpdate {
  date?: string;
  patientId?: number;
  status?: number;
  [key: string]: unknown;
}

/**
 * Return type for useMessageStatus hook
 */
export interface UseMessageStatusReturn {
  messages: Message[];
  loading: boolean;
  error: string | null;
  summary: MessageSummary;
  refresh: () => Promise<void>;
  formatDisplayDate: (dateString: string) => string;
  MESSAGE_STATUS_TEXT: typeof MESSAGE_STATUS_TEXT;
  MESSAGE_STATUS_CLASS: typeof MESSAGE_STATUS_CLASS;
  escapeHtml: typeof escapeHtml;
}

/**
 * Format display date
 */
function formatDisplayDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Custom hook for message status
 */
export function useMessageStatus(
  currentDate: string | null,
  messageStatusUpdate: MessageStatusUpdate | null
): UseMessageStatusReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMessageStatus = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!currentDate) return;

    // Silent refreshes (triggered by live SSE status ticks during a send) keep
    // the current rows on screen and just swap in fresh data. Flipping `loading`
    // would unmount the table for the full-screen placeholder on every status
    // update — which reads as the page "refreshing" after each message.
    if (!silent) setLoading(true);
    setError(null);

    try {
      const data = await apiClient.get<MessageStatusApiResponse>(
        API_ENDPOINTS.MESSAGE_STATUS(currentDate),
        {
          cancelPrevious: 'messageStatus',
        }
      );

      // Handle different API response formats
      let messagesData: Message[] | null = null;
      let hasValidResponse = false;

      if (data && typeof data === 'object') {
        // Try different possible response structures
        if (data.success === true || data.success === undefined) {
          if (data.messages && Array.isArray(data.messages)) {
            messagesData = data.messages;
            hasValidResponse = true;
          } else if (data.data && Array.isArray(data.data)) {
            messagesData = data.data;
            hasValidResponse = true;
          } else if (Array.isArray(data)) {
            messagesData = data as unknown as Message[];
            hasValidResponse = true;
          }
        } else if (data.success === false) {
          hasValidResponse = true; // Valid response, just no data
        }
      }

      if (hasValidResponse) {
        if (messagesData && messagesData.length > 0) {
          setMessages(messagesData);
        } else {
          setMessages([]);
        }
      } else {
        console.warn('Invalid API response structure:', data);
        setMessages([]);
      }
    } catch (err) {
      // Ignore AbortError - this is expected when a request is cancelled
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }

      // Don't show error for missing data - it's normal for dates with no messages
      const errorMessage =
        err instanceof Error ? err.message : err?.toString() || 'Unknown error';
      if (errorMessage.includes('HTTP 404') || errorMessage.includes('Not Found')) {
        setMessages([]);
      } else {
        console.warn('Failed to load message status table:', errorMessage);
        setMessages([]);
      }
    } finally {
      setLoading(false);
    }
  }, [currentDate]);

  // Fetch message status on mount and when date changes
  useEffect(() => {
    fetchMessageStatus();
  }, [fetchMessageStatus]);

  // Reload when message status updates. These fire rapidly during a live send
  // (server → device → read per message), so refresh silently to avoid blanking
  // the table on every tick, and debounce so a burst of ticks coalesces into a
  // single refetch instead of one request per tick.
  useEffect(() => {
    if (!messageStatusUpdate) return;
    const timer = setTimeout(() => {
      fetchMessageStatus({ silent: true });
    }, 400);
    return () => clearTimeout(timer);
  }, [messageStatusUpdate, fetchMessageStatus]);

  // Calculate summary statistics
  const summary: MessageSummary = {
    total: messages.length,
    pending: messages.filter((m) => m.status === 0).length,
    ready: messages.filter((m) => m.status === 5).length,
    server: messages.filter((m) => m.status === 1).length,
    device: messages.filter((m) => m.status === 2).length,
    read: messages.filter((m) => m.status === 3).length,
    played: messages.filter((m) => m.status === 4).length,
    failed: messages.filter((m) => m.status < 0).length,
  };

  return {
    messages,
    loading,
    error,
    summary,
    refresh: fetchMessageStatus,
    formatDisplayDate,
    MESSAGE_STATUS_TEXT,
    MESSAGE_STATUS_CLASS,
    escapeHtml,
  };
}
