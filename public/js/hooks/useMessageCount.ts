/**
 * Custom hook for fetching message count
 */
import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { qk } from '../query/keys';
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
 * Custom hook for message count — fetch on mount and when the date changes, owned
 * by React Query (keyed by date). The fetch goes through the bespoke WhatsApp
 * `apiClient` (its own envelope/cancel handling — a deliberate funnel exception),
 * so the queryFn calls it directly; `cancelPrevious` aborts the previous in-flight
 * request when the date changes.
 */
export function useMessageCount(currentDate: string | null): UseMessageCountReturn {
  const {
    data: messageCount,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: qk.whatsapp.messageCount(currentDate ?? ''),
    queryFn: async () => {
      const data = await apiClient.get(API_ENDPOINTS.MESSAGE_COUNT(currentDate!), {
        cancelPrevious: 'messageCount',
        expectedFields: ['success', 'data'],
      });
      return validateMessageCountResponse(data);
    },
    enabled: !!currentDate,
  });

  const loading = isFetching;
  const errorMessage = error
    ? error instanceof Error
      ? error.message
      : 'Failed to load message count'
    : null;

  // Mirror the legacy display states: loading → "Loading…", error → failure copy,
  // otherwise the formatted count (or empty before the first load).
  const displayMessage = loading
    ? 'Loading message count...'
    : errorMessage
      ? 'Failed to load message count'
      : messageCount
        ? formatMessageCountDisplay(messageCount)
        : '';

  const refresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  return {
    messageCount: messageCount ?? null,
    loading,
    error: errorMessage,
    displayMessage,
    refresh,
  };
}
