/**
 * Custom hook for fetching and displaying WhatsApp message status.
 *
 * React Query owns the read: keyed by date, so changing the date auto-fetches
 * (with cache), and live status ticks — the SSE `whatsapp_message_status` event,
 * surfaced by useWhatsAppSync as `messageStatusUpdate` — refetch via
 * `invalidateQueries(whatsappMessagesKey(date))`. This is the same SSE→invalidate
 * pattern the daily-appointments screen uses (see useAppointments /
 * useAppointmentsSync), reusing the shared QueryClient in App.tsx.
 *
 * RQ keeps the prior rows on screen during a background refetch (it only blanks
 * to the loading placeholder on the first load of an uncached date — `isLoading`),
 * so the burst of server→device→read ticks during a live send updates the table
 * in place; the 400ms debounce coalesces that burst into a single refetch.
 *
 * The read goes through core/http's `fetchJSON`, which unwraps the `sendSuccess`
 * envelope (`/status/:date` rides `data.messages`) — so the hand-rolled
 * multi-shape parsing + bespoke APIClient retry/abort the old version carried are
 * gone (RQ + the funnel provide retry, abort, and dedup).
 */
import { useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJSON, httpErrorMessage } from '@/core/http';
import * as messaging from '@shared/contracts/messaging.contract';
import { qk } from '@/query/keys';
import {
  API_ENDPOINTS,
  MESSAGE_STATUS_TEXT,
  MESSAGE_STATUS_CLASS,
  type MessageStatusValue,
} from '../utils/whatsapp-send-constants';
import { escapeHtml } from '../utils/whatsapp-validation';

/**
 * Coalesce the burst of status ticks during a live send (server → device → read
 * per message) into a single refetch.
 */
const MESSAGE_STATUS_DEBOUNCE_MS = 400;

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
  /** Present on every transformed row — drives the right-click resend/copy actions. */
  appointmentId?: number;
  patientName?: string;
  name?: string;
  phone?: string;
  /** Humanized failure reason overlaid from the live send state (failed rows). */
  errorMessage?: string;
  [key: string]: unknown;
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

/** Query key for a day's WhatsApp message statuses — shared with the SSE
 *  status-tick invalidation. Delegates to the central qk factory. */
export const whatsappMessagesKey = (date: string) => qk.whatsapp.messages(date);

const EMPTY_MESSAGES: Message[] = [];

/**
 * Fetch one day's message statuses. `/status/:date` rides the sendSuccess
 * envelope (`{ data: { messages } }`), which core/http unwraps — so we read
 * `.messages` directly and default a missing/empty payload to `[]`.
 */
function fetchMessageStatus(date: string, signal?: AbortSignal): Promise<Message[]> {
  return fetchJSON<{ messages?: Message[] } | null>(API_ENDPOINTS.MESSAGE_STATUS(date), {
    signal,
    schema: messaging.status.response,
  }).then((payload) => payload?.messages ?? []);
}

/**
 * Format display date
 */
function formatDisplayDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, {
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
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: whatsappMessagesKey(currentDate ?? ''),
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
      queryClient.invalidateQueries({ queryKey: whatsappMessagesKey(currentDate) });
    }, MESSAGE_STATUS_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [messageStatusUpdate, currentDate, queryClient]);

  const refresh = useCallback(async (): Promise<void> => {
    if (!currentDate) return;
    await queryClient.invalidateQueries({ queryKey: whatsappMessagesKey(currentDate) });
  }, [currentDate, queryClient]);

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
    // Only the first load of an uncached date blanks to the placeholder; live
    // refetches keep the table on screen.
    loading: query.isLoading,
    error: query.isError ? httpErrorMessage(query.error, 'Failed to load message status') : null,
    summary,
    refresh,
    formatDisplayDate,
    MESSAGE_STATUS_TEXT,
    MESSAGE_STATUS_CLASS,
    escapeHtml,
  };
}
