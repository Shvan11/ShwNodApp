/**
 * Custom hook for fetching message count
 */
import { useState, useEffect, useCallback } from 'react';
import { API_ENDPOINTS } from '../utils/whatsapp-send-constants';
import {
  validateMessageCountResponse,
  type MessageCountData,
} from '../utils/whatsapp-validation';
import { APIClient } from '../utils/whatsapp-api-client';

const apiClient = new APIClient();

/**
 * Return type for useMessageCount hook
 */
export interface UseMessageCountReturn {
  messageCount: MessageCountData | null;
  loading: boolean;
  error: string | null;
  displayMessage: string;
  refresh: () => void;
}

/**
 * Format message count for display
 */
function formatMessageCountDisplay(count: MessageCountData): string {
  const actualSendable = Math.max(0, count.eligibleForMessaging || 0);
  let message = `${actualSendable} messages ready to send`;

  const pending = (count as { pending?: number }).pending;

  if (count.alreadySent > 0) {
    message += ` (${count.alreadySent} already sent`;
    if (pending && pending > 0) {
      message += `, ${pending} pending`;
    }
    message += ')';
  } else if (pending && pending > 0) {
    message += ` (${pending} pending)`;
  }

  return message;
}

/**
 * Custom hook for message count
 */
export function useMessageCount(currentDate: string | null): UseMessageCountReturn {
  const [messageCount, setMessageCount] = useState<MessageCountData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [displayMessage, setDisplayMessage] = useState('');

  const fetchMessageCount = useCallback(async () => {
    if (!currentDate) return;

    setLoading(true);
    setError(null);
    setDisplayMessage('Loading message count...');

    try {
      const data = await apiClient.get(API_ENDPOINTS.MESSAGE_COUNT(currentDate), {
        cancelPrevious: 'messageCount',
        expectedFields: ['success', 'data'],
      });

      const count = validateMessageCountResponse(data);
      setMessageCount(count);

      const message = formatMessageCountDisplay(count);
      setDisplayMessage(message);
    } catch (err) {
      // Ignore AbortError - this is expected when a request is cancelled
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }

      // Only log actual errors (not cancellations)
      const errorMessage = err instanceof Error ? err.message : 'Failed to load message count';
      console.warn('Failed to load message count:', errorMessage);
      setError(errorMessage);
      setDisplayMessage('Failed to load message count');
      setMessageCount(null);
    } finally {
      setLoading(false);
    }
  }, [currentDate]);

  // Fetch message count on mount and when date changes
  useEffect(() => {
    fetchMessageCount();
  }, [fetchMessageCount]);

  // Refresh function for manual refresh
  const refresh = useCallback(() => {
    fetchMessageCount();
  }, [fetchMessageCount]);

  return {
    messageCount,
    loading,
    error,
    displayMessage,
    refresh,
  };
}
