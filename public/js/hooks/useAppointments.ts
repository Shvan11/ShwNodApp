import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { postJSON, type HttpError } from '@/core/http';
import { isInvalidStateTransition } from '@/query/useApiMutation';
import { dailyAppointmentsQuery } from '@/query/queries';
import { qk } from '@/query/keys';
import { useToast } from '@/contexts/ToastContext';
import type { DailyAppointmentRow } from '@shared/contracts/appointment.contract';

/**
 * Return type for useAppointments hook
 */
export interface UseAppointmentsReturn {
  allAppointments: DailyAppointmentRow[];
  checkedInAppointments: DailyAppointmentRow[];
  /** No data for the day yet: the lists show skeletons. */
  initialLoading: boolean;
  /**
   * A click is in flight, or another day's data is on screen while this one
   * loads: the lists dim and take no clicks. A background refetch (another
   * desk's write, the 5-minute net) is neither, so it no longer dims the board
   * or swaps an empty list for skeletons (audit FE-F11-12).
   */
  busy: boolean;
  /** Any read in flight (the refresh button's spinner). */
  refreshing: boolean;
  /** The day's READ failed (a failed check-in is a toast, not this). */
  error: string | null;
  loadAppointments: (date: string) => Promise<boolean>;
  checkInPatient: (appointmentId: number, currentDate: string) => Promise<{ success: boolean }>;
  markSeated: (appointmentId: number, currentDate: string) => Promise<{ success: boolean }>;
  markDismissed: (appointmentId: number, currentDate: string) => Promise<{ success: boolean }>;
  undoState: (appointmentId: number, stateToUndo: string, currentDate: string) => Promise<{ success: boolean }>;
}

/** Current time as HH:MM:SS (the state-change payload's `time`). */
function getCurrentTime(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
}

/** The server's refusal of a forward step on a day that hasn't come yet (FE-F11-4). */
function isFutureDayRefusal(err: unknown): boolean {
  const httpErr = err as HttpError | undefined;
  if (httpErr?.status !== 400) return false;
  const data = httpErr.data as { details?: { code?: string } } | undefined;
  return data?.details?.code === 'FUTURE_APPOINTMENT';
}

type FailKey = 'errors.checkInFailed' | 'errors.seatFailed' | 'errors.dismissFailed' | 'errors.undoFailed';

/**
 * Custom hook for managing appointments data and actions (audit M7/M8).
 *
 * React Query owns the read (`dailyAppointmentsQuery`), keyed by date, so
 * changing the date auto-fetches (with cache), and SSE/reconnect/periodic
 * triggers refetch via `invalidateQueries(qk.appointments.daily(date))`. The
 * route loader writes the same key into the cache before first paint.
 *
 * Mutations stay simple: POST → invalidate (reload) → render. Database is the
 * single source of truth (no optimistic updates / rollback). A stale-view 400
 * (INVALID_STATE_TRANSITION) is recovered silently with a reload. Any other
 * failure is a toast: it used to become the page's `error`, which replaced the
 * whole board with "Failed to load appointments" until the user navigated away
 * (audit FE-F11-2).
 *
 * @param date - The day being viewed (the query key).
 */
export function useAppointments(date: string): UseAppointmentsReturn {
  const { t } = useTranslation('appointments');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [mutating, setMutating] = useState(false);

  const query = useQuery({
    ...dailyAppointmentsQuery(date),
    // Keep the previously-selected day's snapshot visible (dimmed via `busy`)
    // while a newly-selected date loads, instead of dropping to skeletons.
    placeholderData: keepPreviousData,
  });

  /**
   * Reload a day by invalidating its query (refetches the active query and
   * resolves when it settles). Returns false if the refetch ended in error, so
   * useAppointmentsSync can mark the stream stale and retry.
   */
  const loadAppointments = useCallback(
    async (d: string): Promise<boolean> => {
      if (!d) return false;
      await queryClient.invalidateQueries({ queryKey: qk.appointments.daily(d) });
      return queryClient.getQueryState(qk.appointments.daily(d))?.status !== 'error';
    },
    [queryClient]
  );

  // Shared driver for the four state-change actions: POST → reload → render.
  const runStateChange = useCallback(
    async (
      url: string,
      body: Record<string, unknown>,
      currentDate: string,
      failKey: FailKey
    ): Promise<{ success: boolean }> => {
      try {
        setMutating(true);
        await postJSON(url, body);
        await loadAppointments(currentDate);
        return { success: true };
      } catch (err) {
        if (isInvalidStateTransition(err)) {
          // The caller's view was stale (typically a missed SSE update): reload
          // the truth instead of reporting an error.
          toast.warning(t('errors.stateConflict'));
          await loadAppointments(currentDate);
        } else if (isFutureDayRefusal(err)) {
          toast.error(t('errors.futureDay'));
        } else {
          toast.error(t(failKey));
        }
        return { success: false };
      } finally {
        setMutating(false);
      }
    },
    [loadAppointments, toast, t]
  );

  const checkInPatient = useCallback(
    (appointmentId: number, currentDate: string) =>
      runStateChange(
        '/api/updateAppointmentState',
        { appointment_id: appointmentId, state: 'present', time: getCurrentTime() },
        currentDate,
        'errors.checkInFailed'
      ),
    [runStateChange]
  );

  const markSeated = useCallback(
    (appointmentId: number, currentDate: string) =>
      runStateChange(
        '/api/updateAppointmentState',
        { appointment_id: appointmentId, state: 'seated', time: getCurrentTime() },
        currentDate,
        'errors.seatFailed'
      ),
    [runStateChange]
  );

  const markDismissed = useCallback(
    (appointmentId: number, currentDate: string) =>
      runStateChange(
        '/api/updateAppointmentState',
        { appointment_id: appointmentId, state: 'dismissed', time: getCurrentTime() },
        currentDate,
        'errors.dismissFailed'
      ),
    [runStateChange]
  );

  const undoState = useCallback(
    (appointmentId: number, stateToUndo: string, currentDate: string) =>
      runStateChange(
        '/api/undoAppointmentState',
        { appointment_id: appointmentId, state: stateToUndo },
        currentDate,
        'errors.undoFailed'
      ),
    [runStateChange]
  );

  const data = query.data;

  return {
    allAppointments: data?.allAppointments ?? [],
    checkedInAppointments: data?.checkedInAppointments ?? [],
    initialLoading: query.isPending,
    busy: mutating || query.isPlaceholderData,
    refreshing: query.isFetching,
    // Translated, not the server's English text: this renders on the Arabic board.
    error: query.isError ? t('errors.loadFailed') : null,
    loadAppointments,
    checkInPatient,
    markSeated,
    markDismissed,
    undoState,
  };
}
