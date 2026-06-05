import { useCallback, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJSON, postJSON, httpErrorMessage, type HttpError } from '@/core/http';
import { dailyAppointments, type DailyAppointmentsResponse } from '@shared/contracts/appointment.contract';

/**
 * Appointment statistics from API
 */
export interface AppointmentStats {
  total: number;
  checkedIn: number;
  absent: number;
  waiting: number;
}

/**
 * Appointment data from API
 */
export interface Appointment {
  appointment_id: number;
  person_id?: number;
  patient_name?: string;
  patient_type?: string | null;
  app_date?: string | null;
  app_detail?: string | null;
  apptime?: string | null;
  phone?: string | null;
  [key: string]: unknown;
}

/**
 * Initial data from loader (the date the loader pre-fetched, used to seed the
 * React Query cache for that key so there's no loading flash on first paint).
 */
export interface AppointmentsLoaderData {
  loadedDate?: string;
  allAppointments?: Appointment[];
  checkedInAppointments?: Appointment[];
  stats?: AppointmentStats;
  error?: string | null;
  _loaderTimestamp?: number;
}

/**
 * Return type for useAppointments hook
 */
export interface UseAppointmentsReturn {
  allAppointments: Appointment[];
  checkedInAppointments: Appointment[];
  loading: boolean;
  error: string | null;
  loadAppointments: (date: string) => Promise<boolean>;
  checkInPatient: (appointmentId: number, currentDate: string) => Promise<{ success: boolean }>;
  markSeated: (appointmentId: number, currentDate: string) => Promise<{ success: boolean }>;
  markDismissed: (appointmentId: number, currentDate: string) => Promise<{ success: boolean }>;
  undoState: (appointmentId: number, stateToUndo: string, currentDate: string) => Promise<{ success: boolean }>;
  getStats: () => AppointmentStats;
}

const EMPTY_STATS: AppointmentStats = { total: 0, checkedIn: 0, absent: 0, waiting: 0 };

/** Query key for a day's appointments — shared with useAppointmentsSync's SSE invalidation. */
export const dailyAppointmentsKey = (date: string): [string, string] => ['daily-appointments', date];

/** Current time as HH:MM:SS (the state-change payload's `time`). */
function getCurrentTime(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
}

/** Fetch one day's appointments, validated at the boundary (audit H11). */
function fetchDailyAppointments(date: string, signal?: AbortSignal): Promise<DailyAppointmentsResponse> {
  return fetchJSON<DailyAppointmentsResponse>(`/api/getDailyAppointments?AppsDate=${date}`, {
    signal,
    schema: dailyAppointments.response,
  });
}

/**
 * Custom hook for managing appointments data and actions (audit M7/M8).
 *
 * React Query owns the read: keyed by date, so changing the date auto-fetches
 * (with cache), and SSE/reconnect/periodic triggers refetch via
 * `invalidateQueries(dailyAppointmentsKey(date))` — the real fix for the M7 dead
 * cache-key no-op. Abort, retry, and the 30s timeout come from core/http + RQ.
 *
 * Mutations stay simple: POST → invalidate (reload) → render. Database is the
 * single source of truth (no optimistic updates / rollback). A stale-view 400
 * (INVALID_STATE_TRANSITION) is recovered silently with a reload, not surfaced.
 *
 * @param date - The day being viewed (the query key).
 * @param initialData - Loader payload; seeds the cache for `initialData.loadedDate`.
 */
export function useAppointments(
  date: string,
  initialData: AppointmentsLoaderData | null = null
): UseAppointmentsReturn {
  const queryClient = useQueryClient();
  const [mutating, setMutating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Seed RQ from the loader payload, but only for the exact date it fetched.
  const seed =
    initialData && initialData.loadedDate === date && !initialData.error
      ? {
          allAppointments: initialData.allAppointments ?? [],
          checkedInAppointments: initialData.checkedInAppointments ?? [],
          stats: initialData.stats ?? EMPTY_STATS,
        }
      : undefined;

  const query = useQuery({
    queryKey: dailyAppointmentsKey(date),
    queryFn: ({ signal }) => fetchDailyAppointments(date, signal),
    enabled: !!date,
    initialData: seed,
    initialDataUpdatedAt: seed ? initialData?._loaderTimestamp : undefined,
    // Keep the previously-selected day's snapshot visible (dimmed via the list's
    // refreshing state) while a newly-selected date loads, instead of dropping to
    // skeletons. initialData still takes precedence for the loader-seeded date.
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
      await queryClient.invalidateQueries({ queryKey: dailyAppointmentsKey(d) });
      return queryClient.getQueryState(dailyAppointmentsKey(d))?.status !== 'error';
    },
    [queryClient]
  );

  // The server rejects a forward state transition when the caller's view is
  // stale (typically a missed SSE DATA_UPDATED). That's not a hard error — the
  // right recovery is a silent reload of the truth. Returns true if it handled it.
  const recoverFromConflict = useCallback(
    async (err: unknown, currentDate: string): Promise<boolean> => {
      const httpErr = err as HttpError;
      if (httpErr.status !== 400) return false;
      const errorData = httpErr.data as { details?: { code?: string } } | undefined;
      if (errorData?.details?.code === 'INVALID_STATE_TRANSITION') {
        window.toast?.warning('Patient state changed — refreshing');
        await loadAppointments(currentDate);
        return true;
      }
      return false;
    },
    [loadAppointments]
  );

  // Shared driver for the four state-change actions: POST → reload → render,
  // with silent conflict recovery and a friendly error surfaced otherwise.
  const runStateChange = useCallback(
    async (
      url: string,
      body: Record<string, unknown>,
      currentDate: string,
      failMessage: string
    ): Promise<{ success: boolean }> => {
      try {
        setMutating(true);
        setActionError(null);
        await postJSON(url, body);
        await loadAppointments(currentDate);
        return { success: true };
      } catch (err) {
        if (await recoverFromConflict(err, currentDate)) {
          return { success: false };
        }
        console.error(`${failMessage}:`, err);
        setActionError(httpErrorMessage(err, failMessage));
        throw err;
      } finally {
        setMutating(false);
      }
    },
    [loadAppointments, recoverFromConflict]
  );

  const checkInPatient = useCallback(
    (appointmentId: number, currentDate: string) =>
      runStateChange(
        '/api/updateAppointmentState',
        { appointment_id: appointmentId, state: 'present', time: getCurrentTime() },
        currentDate,
        'Failed to check in patient'
      ),
    [runStateChange]
  );

  const markSeated = useCallback(
    (appointmentId: number, currentDate: string) =>
      runStateChange(
        '/api/updateAppointmentState',
        { appointment_id: appointmentId, state: 'seated', time: getCurrentTime() },
        currentDate,
        'Failed to seat patient'
      ),
    [runStateChange]
  );

  const markDismissed = useCallback(
    (appointmentId: number, currentDate: string) =>
      runStateChange(
        '/api/updateAppointmentState',
        { appointment_id: appointmentId, state: 'dismissed', time: getCurrentTime() },
        currentDate,
        'Failed to complete visit'
      ),
    [runStateChange]
  );

  const undoState = useCallback(
    (appointmentId: number, stateToUndo: string, currentDate: string) =>
      runStateChange(
        '/api/undoAppointmentState',
        { appointment_id: appointmentId, state: stateToUndo },
        currentDate,
        `Failed to undo ${stateToUndo}`
      ),
    [runStateChange]
  );

  const data = query.data;

  return {
    allAppointments: (data?.allAppointments ?? []) as Appointment[],
    checkedInAppointments: (data?.checkedInAppointments ?? []) as Appointment[],
    loading: mutating || query.isFetching,
    error:
      actionError ??
      (query.isError ? httpErrorMessage(query.error, 'Failed to load appointments') : null),
    loadAppointments,
    checkInPatient,
    markSeated,
    markDismissed,
    undoState,
    getStats: () => (data?.stats ?? EMPTY_STATS) as AppointmentStats,
  };
}
