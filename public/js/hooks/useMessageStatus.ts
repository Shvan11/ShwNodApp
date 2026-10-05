/**
 * Custom hook for fetching and displaying WhatsApp message status.
 *
 * React Query owns the read: keyed by date, so changing the date auto-fetches
 * (with cache), and live status ticks — the SSE `whatsapp_message_status` event,
 * surfaced by useWhatsAppSync as `messageStatusUpdate` — refetch via
 * `invalidateQueries(qk.whatsapp.messages(date))`. This is the same
 * SSE→invalidate pattern the daily-appointments screen uses (see useAppointments /
 * useAppointmentsSync), reusing the shared QueryClient in App.tsx.
 *
 * RQ keeps the prior rows on screen during a background refetch (it only blanks
 * to the loading placeholder on the first load of an uncached date — `isLoading`),
 * so the burst of server→device→read ticks during a live send updates the table
 * in place; the 400ms debounce coalesces that burst into a single refetch.
 *
 * The rows are the contract's `StatusRow`, unwrapped from the `sendSuccess`
 * envelope by core/http's `fetchJSON` (audit FE-F16-10: a hand-written `Message`
 * type with a dozen fields the endpoint never sends sat over it).
 */
import { useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJSON, httpErrorMessage } from '@/core/http';
import * as messaging from '@shared/contracts/messaging.contract';
import type { StatusRow } from '@shared/contracts/messaging.contract';
import { qk } from '@/query/keys';
import { API_ENDPOINTS, MESSAGE_STATUS } from '../utils/whatsapp-send-constants';

/**
 * Coalesce the burst of status ticks during a live send (server → device → read
 * per message) into a single refetch.
 */
const MESSAGE_STATUS_DEBOUNCE_MS = 400;

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
 * Message status update data from the WhatsApp SSE channel
 * Using number for status to be compatible with MessageStatusUpdateData from useWhatsAppSync
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
  messages: StatusRow[];
  loading: boolean;
  error: string | null;
  summary: MessageSummary;
  refresh: () => Promise<void>;
}

const EMPTY_MESSAGES: StatusRow[] = [];

/** One day's message statuses (`/status/:date` rides `data.messages`). */
function fetchMessageStatus(date: string, signal?: AbortSignal): Promise<StatusRow[]> {
  return fetchJSON<messaging.StatusResponse>(API_ENDPOINTS.MESSAGE_STATUS(date), {
    signal,
    schema: messaging.status.response,
  }).then((payload) => payload?.messages ?? []);
}

/**
 * Custom hook for message status
 */
export function useMessageStatus(
  currentDate: string | null,
  messageStatusUpdate: MessageStatusUpdate | null
): UseMessageStatusReturn {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: qk.whatsapp.messages(currentDate ?? ''),
    queryFn: ({ signal }) => fetchMessageStatus(currentDate as string, signal),
    enabled: !!currentDate,
  });

  const messages = query.data ?? EMPTY_MESSAGES;

  // Live status ticks → debounced background refetch of the current day. These
  // fire rapidly during a send, so a 400ms debounce coalesces the burst into one
  // refetch; RQ keeps the existing rows visible while it refetches (no blanking).
  // Like the old version, any status tick refreshes the active date — the send
  // in progress is always for the day on screen.
  useEffect(() => {
    if (!messageStatusUpdate || !currentDate) return;
    const timer = setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: qk.whatsapp.messages(currentDate) });
    }, MESSAGE_STATUS_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [messageStatusUpdate, currentDate, queryClient]);

  const refresh = useCallback(async (): Promise<void> => {
    if (!currentDate) return;
    await queryClient.invalidateQueries({ queryKey: qk.whatsapp.messages(currentDate) });
  }, [currentDate, queryClient]);

  const count = (status: number) => messages.filter((m) => m.status === status).length;
  const summary: MessageSummary = {
    total: messages.length,
    pending: count(MESSAGE_STATUS.PENDING),
    ready: count(MESSAGE_STATUS.READY),
    server: count(MESSAGE_STATUS.SERVER),
    device: count(MESSAGE_STATUS.DEVICE),
    read: count(MESSAGE_STATUS.READ),
    played: count(MESSAGE_STATUS.PLAYED),
    failed: messages.filter((m) => m.status < 0).length,
  };

  return {
    messages,
    // Only the first load of an uncached date blanks to the placeholder; live
    // refetches keep the table on screen.
    loading: query.isLoading,
    error: query.isError ? httpErrorMessage(query.error, 'Failed to load message status') : null,
    summary,
    refresh,
  };
}
