import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import sseAppointments, { type Freshness } from '../services/sse-appointments';

// Periodic safety net for missed SSE messages on the today view.
const PERIODIC_SYNC_INTERVAL_MS = 5 * 60 * 1000;
// Coalesce reconnect / online bursts that fire in rapid succession.
const RECOVERY_DEBOUNCE_MS = 1_000;
// Linear backoff (capped) for retrying a failed recovery fetch — covers the
// boot-storm window where WS upgrades land before REST routes are ready.
const RECOVERY_RETRY_DELAYS_MS = [3_000, 5_000, 8_000, 10_000];

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'error';

export interface AppointmentsUpdatedData {
  date?: string;
  appointments?: unknown[];
  [key: string]: unknown;
}

/** Callback may report failure so the hook can mark stale and retry. */
export type AppointmentsUpdateCallback = (
  data: AppointmentsUpdatedData
) => void | boolean | Promise<void | boolean>;

export interface UseAppointmentsSyncReturn {
  connectionStatus: ConnectionStatus;
  isConnected: boolean;
  dataFreshness: Freshness;
}

function getTodayDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Real-time appointment sync — **today-only by design.**
 *
 * Past/future dates render a static snapshot from the loader: no SSE
 * subscription, no broadcast listener, no recovery triggers, no periodic
 * refetch. The UI surfaces this as the "Static" indicator.
 *
 * For today: database is the source of truth; SSE is a hint that
 * something changed. Recovery is idempotent REST refetch coalesced across
 * multiple trigger sources (reconnect, network resume, periodic safety net).
 */
export function useAppointmentsSync(
  currentDate: string,
  onAppointmentsUpdated: AppointmentsUpdateCallback
): UseAppointmentsSyncReturn {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [dataFreshness, setDataFreshness] = useState<Freshness>(sseAppointments.getFreshness());

  // Single source of truth for "should this hook do anything real-time?"
  // Drives every effect below. Non-today => static view, no subscriptions.
  const isViewingToday = currentDate === getTodayDate();

  // Keep refs to the latest callback + date so the debounced trigger always
  // invokes the current closure without recreating the debouncer every render.
  // Synced post-commit (not during render) so an aborted/discarded concurrent
  // render can't leave a ref ahead of the committed UI. Both refs are read only
  // from async paths (runRecovery, event handlers), so post-commit timing is safe.
  const callbackRef = useRef(onAppointmentsUpdated);
  const currentDateRef = useRef(currentDate);
  useLayoutEffect(() => {
    callbackRef.current = onAppointmentsUpdated;
    currentDateRef.current = currentDate;
  }, [onAppointmentsUpdated, currentDate]);

  // Debounced recovery + retry state. Held in refs so both the event-driven
  // subscriptions (reconnect/online) and the periodic safety net share the
  // same coalescing window and retry attempt counter.
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttemptRef = useRef(0);
  const cancelledRef = useRef(false);

  const runRecovery = useCallback(async () => {
    const date = currentDateRef.current;
    // The callback (DailyAppointments → loadAppointments) invalidates the React
    // Query key, which refetches the live data — that IS the cache invalidation
    // now (audit M7). The old clearLoaderCacheKey('daily-appointments:…') was a
    // no-op: dailyAppointmentsLoader never wrote that key.
    try {
      const result = await callbackRef.current({ date });
      if (cancelledRef.current) return;
      // Treat explicit `false` as failure; undefined/void/true as success.
      if (result === false) {
        throw new Error('recovery callback returned false');
      }
      retryAttemptRef.current = 0;
    } catch (err) {
      if (cancelledRef.current) return;
      sseAppointments.markStale();
      const delay = RECOVERY_RETRY_DELAYS_MS[
        Math.min(retryAttemptRef.current, RECOVERY_RETRY_DELAYS_MS.length - 1)
      ];
      console.warn('[useAppointmentsSync] Recovery fetch failed; retrying', {
        attempt: retryAttemptRef.current + 1,
        delayMs: delay,
        error: err instanceof Error ? err.message : String(err),
      });
      retryAttemptRef.current++;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        runRecovery();
      }, delay);
    }
  }, []);

  const triggerRecoveryFetch = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      runRecovery();
    }, RECOVERY_DEBOUNCE_MS);
  }, [runRecovery]);

  // 1. Connection lifecycle — open the shared SSE stream only when viewing
  // today. Past/future views opt out entirely: no EventSource opened, no
  // server resources held.
  useEffect(() => {
    if (!isViewingToday) {
      setConnectionStatus('disconnected');
      return;
    }

    const initialize = async () => {
      try {
        await sseAppointments.ensureConnected();
        setConnectionStatus('connected');
      } catch (err) {
        console.error('[useAppointmentsSync] SSE connection failed, will retry:', err);
        setConnectionStatus('connecting');
      }
    };

    initialize();

    return () => {
      sseAppointments.release();
    };
  }, [isViewingToday]);

  // 2. Connection lifecycle + freshness event mirrors. Always mounted — these
  // are cheap pass-throughs from the shared singleton and keep local state
  // coherent across switches between today and other dates without resubscribing.
  useEffect(() => {
    const handleConnected = () => setConnectionStatus('connected');
    const handleDisconnected = () => setConnectionStatus('disconnected');
    const handleReconnecting = () => setConnectionStatus('reconnecting');
    const handleError = () => setConnectionStatus('error');
    const handleFreshness = (payload: unknown) => {
      const next = (payload as { freshness?: Freshness } | undefined)?.freshness;
      if (next === 'fresh' || next === 'stale') {
        setDataFreshness(next);
      }
    };

    sseAppointments.on('connected', handleConnected);
    sseAppointments.on('disconnected', handleDisconnected);
    sseAppointments.on('reconnecting', handleReconnecting);
    sseAppointments.on('error', handleError);
    sseAppointments.on('freshness_changed', handleFreshness);

    return () => {
      sseAppointments.off('connected', handleConnected);
      sseAppointments.off('disconnected', handleDisconnected);
      sseAppointments.off('reconnecting', handleReconnecting);
      sseAppointments.off('error', handleError);
      sseAppointments.off('freshness_changed', handleFreshness);
    };
  }, []);

  // 3. Recovery triggers (reconnect / online). Today-only: a refetch is
  // meaningless for a static snapshot of a past/future date.
  useEffect(() => {
    if (!isViewingToday) return;

    cancelledRef.current = false;

    const handleReconnected = () => triggerRecoveryFetch();
    const handleOnline = () => triggerRecoveryFetch();

    sseAppointments.on('reconnected', handleReconnected);
    window.addEventListener('online', handleOnline);

    return () => {
      cancelledRef.current = true;
      sseAppointments.off('reconnected', handleReconnected);
      window.removeEventListener('online', handleOnline);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [isViewingToday, triggerRecoveryFetch]);

  // 4. appointments_updated broadcast listener — today-only. The server no
  // longer filters by date (every today-viewer gets every broadcast), so the
  // client double-checks: ignore any broadcast whose date doesn't match the
  // view. This protects against midnight rollover and stray non-today broadcasts.
  useEffect(() => {
    if (!isViewingToday) return;

    const normalizeDate = (dateStr: string | undefined | null): string => {
      if (!dateStr) return '';
      return dateStr.split('T')[0];
    };

    const handleAppointmentsUpdated = async (payload: unknown) => {
      const data = (payload ?? {}) as AppointmentsUpdatedData;
      const receivedDate = normalizeDate(data.date);
      const expectedDate = normalizeDate(currentDate);

      if (receivedDate && receivedDate === expectedDate) {
        // Direct invocation here (not the debounced path) — broadcasts are
        // already coalesced server-side and we want minimal latency on the
        // common case. On failure, mirror runRecovery: mark stale and engage
        // the debounced backoff pipeline so the indicator reflects the gap.
        try {
          const result = await callbackRef.current({ ...data, date: currentDate });
          if (result === false) {
            throw new Error('refetch returned false');
          }
        } catch {
          sseAppointments.markStale();
          triggerRecoveryFetch();
        }
      }
    };

    sseAppointments.on('appointments_updated', handleAppointmentsUpdated);

    return () => {
      sseAppointments.off('appointments_updated', handleAppointmentsUpdated);
    };
  }, [isViewingToday, currentDate, triggerRecoveryFetch]);

  // 5. Periodic safety net — today-only. Backstops a connection that's lying
  // about being healthy. Route through triggerRecoveryFetch so a failure here
  // surfaces as "Stale — Resyncing" and gets retried with the backoff schedule.
  useEffect(() => {
    if (!isViewingToday) return;

    const syncInterval = setInterval(() => {
      triggerRecoveryFetch();
    }, PERIODIC_SYNC_INTERVAL_MS);

    return () => {
      clearInterval(syncInterval);
    };
  }, [isViewingToday, triggerRecoveryFetch]);

  return {
    connectionStatus,
    isConnected: connectionStatus === 'connected',
    dataFreshness,
  };
}
