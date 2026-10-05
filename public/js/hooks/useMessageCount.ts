/**
 * Custom hook for fetching message count
 */
import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchJSON, httpErrorMessage } from '@/core/http';
import * as messagingContract from '@shared/contracts/messaging.contract';
import { qk } from '../query/keys';
import { API_ENDPOINTS } from '../utils/whatsapp-send-constants';

export type MessageCount = messagingContract.CountResponse;

/**
 * Return type for useMessageCount hook
 */
export interface UseMessageCountReturn {
  messageCount: MessageCount | null;
  loading: boolean;
  error: string | null;
  displayMessage: string;
  refresh: () => Promise<void>;
}

/**
 * Format message count for display
 */
function formatMessageCountDisplay(count: MessageCount): string {
  const actualSendable = Math.max(0, count.eligibleForMessaging);
  let message = `${actualSendable} messages ready to send`;

  if (count.alreadySent > 0) {
    message += ` (${count.alreadySent} already sent`;
    if (count.pending > 0) {
      message += `, ${count.pending} pending`;
    }
    message += ')';
  } else if (count.pending > 0) {
    message += ` (${count.pending} pending)`;
  }

  return message;
}

/**
 * Custom hook for message count — fetch on mount and when the date changes, owned
 * by React Query (keyed by date), read through the funnel with the contract's
 * schema. It used to go through a bespoke WhatsApp `APIClient` with its own
 * CSRF/timeout/retry copy and a hand-written response check (FE-F16-8).
 */
export function useMessageCount(currentDate: string | null): UseMessageCountReturn {
  const {
    data: messageCount,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: qk.whatsapp.messageCount(currentDate ?? ''),
    queryFn: ({ signal }) =>
      fetchJSON<MessageCount>(API_ENDPOINTS.MESSAGE_COUNT(currentDate!), {
        signal,
        schema: messagingContract.count.response,
      }),
    enabled: !!currentDate,
  });

  const loading = isFetching;
  const errorMessage = error ? httpErrorMessage(error, 'Failed to load message count') : null;

  const displayMessage = loading
    ? 'Loading message count...'
    : errorMessage
      ? `Failed to load message count: ${errorMessage}`
      : messageCount
        ? formatMessageCountDisplay(messageCount)
        : '';

  const refresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return {
    messageCount: messageCount ?? null,
    loading,
    error: errorMessage,
    displayMessage,
    refresh,
  };
}
