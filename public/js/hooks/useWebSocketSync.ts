import { useEffect, useRef, useState } from 'react';
import connectionManager from '../services/websocket-connection-manager';
import wsService, { type Freshness } from '../services/websocket';
import { WebSocketEvents } from '../constants/websocket-events';
import { clearLoaderCacheKey } from '../router/loaders';

// Periodic safety net for missed WebSocket messages on the today view.
const PERIODIC_SYNC_INTERVAL_MS = 5 * 60 * 1000;
// Coalesce reconnect / online / visibility bursts that fire in rapid succession.
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

export interface UseWebSocketSyncReturn {
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
 * Real-time appointment sync.
 *
 * Database is the source of truth; WebSocket is a hint that something changed.
 * Recovery is idempotent REST refetch coalesced across multiple trigger sources
 * (reconnect, network resume, tab returning to foreground while stale).
 */
export function useWebSocketSync(
  currentDate: string,
  onAppointmentsUpdated: AppointmentsUpdateCallback
): UseWebSocketSyncReturn {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [dataFreshness, setDataFreshness] = useState<Freshness>(wsService.getFreshness());

  // Keep a ref to the latest callback so the debounced trigger always invokes
  // the current closure without needing to recreate the debouncer on every render.
  const callbackRef = useRef(onAppointmentsUpdated);
  callbackRef.current = onAppointmentsUpdated;
  const currentDateRef = useRef(currentDate);
  currentDateRef.current = currentDate;

  // Initialize WebSocket connection — re-runs when currentDate changes so the
  // server-side registration metadata stays in sync (PDate query param).
  useEffect(() => {
    const initializeWebSocket = async () => {
      try {
        await connectionManager.ensureConnected('daily-appointments', {
          PDate: currentDate,
        });
        setConnectionStatus('connected');
      } catch (err) {
        console.error('[useWebSocketSync] Connection failed, auto-reconnect will retry:', err);
        setConnectionStatus('connecting');
      }
    };

    initializeWebSocket();

    return () => {
      connectionManager.removeClientType('daily-appointments');
    };
  }, [currentDate]);

  // Connection lifecycle + freshness events
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

    wsService.on('connected', handleConnected);
    wsService.on('disconnected', handleDisconnected);
    wsService.on('reconnecting', handleReconnecting);
    wsService.on('error', handleError);
    wsService.on('freshness_changed', handleFreshness);

    return () => {
      wsService.off('connected', handleConnected);
      wsService.off('disconnected', handleDisconnected);
      wsService.off('reconnecting', handleReconnecting);
      wsService.off('error', handleError);
      wsService.off('freshness_changed', handleFreshness);
    };
  }, []);

  // Debounced recovery + retry plumbing. Mounted once per hook instance.
  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryAttempt = 0;
    let cancelled = false;

    const runRecovery = async () => {
      const date = currentDateRef.current;
      clearLoaderCacheKey(`daily-appointments:${date}`);
      try {
        const result = await callbackRef.current({ date });
        if (cancelled) return;
        // Treat explicit `false` as failure; undefined/void/true as success.
        if (result === false) {
          throw new Error('recovery callback returned false');
        }
        retryAttempt = 0;
      } catch (err) {
        if (cancelled) return;
        wsService.markStale();
        const delay = RECOVERY_RETRY_DELAYS_MS[
          Math.min(retryAttempt, RECOVERY_RETRY_DELAYS_MS.length - 1)
        ];
        console.warn('[useWebSocketSync] Recovery fetch failed; retrying', {
          attempt: retryAttempt + 1,
          delayMs: delay,
          error: err instanceof Error ? err.message : String(err),
        });
        retryAttempt++;
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(() => {
          retryTimer = null;
          runRecovery();
        }, delay);
      }
    };

    const triggerRecoveryFetch = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        runRecovery();
      }, RECOVERY_DEBOUNCE_MS);
    };

    const handleReconnected = () => triggerRecoveryFetch();
    const handleOnline = () => triggerRecoveryFetch();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && wsService.getFreshness() === 'stale') {
        triggerRecoveryFetch();
      }
    };

    wsService.on('reconnected', handleReconnected);
    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      wsService.off('reconnected', handleReconnected);
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibility);
      if (debounceTimer) clearTimeout(debounceTimer);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, []);

  // APPOINTMENTS_UPDATED stream — server hint, client filters by date.
  useEffect(() => {
    const normalizeDate = (dateStr: string | undefined | null): string => {
      if (!dateStr) return '';
      return dateStr.split('T')[0];
    };

    const handleAppointmentsUpdated = (data: AppointmentsUpdatedData) => {
      const receivedDate = normalizeDate(data?.date);
      const expectedDate = normalizeDate(currentDate);

      if (receivedDate && receivedDate === expectedDate) {
        clearLoaderCacheKey(`daily-appointments:${currentDate}`);
        // Direct invocation here (not the debounced path) — broadcasts are
        // already coalesced server-side and we want minimal latency on the
        // common case.
        callbackRef.current({ ...data, date: currentDate });
      }
    };

    wsService.on(WebSocketEvents.APPOINTMENTS_UPDATED, handleAppointmentsUpdated);

    return () => {
      wsService.off(WebSocketEvents.APPOINTMENTS_UPDATED, handleAppointmentsUpdated);
    };
  }, [currentDate]);

  // Periodic safety net — only on today. Run regardless of connectionStatus:
  // the whole point is to backstop a connection that's lying about being
  // healthy. Re-route through the same callback path so failures benefit from
  // retry/markStale.
  useEffect(() => {
    const isViewingToday = currentDate === getTodayDate();
    if (!isViewingToday) return;

    const syncInterval = setInterval(() => {
      clearLoaderCacheKey(`daily-appointments:${currentDate}`);
      callbackRef.current({ date: currentDate });
    }, PERIODIC_SYNC_INTERVAL_MS);

    return () => {
      clearInterval(syncInterval);
    };
  }, [currentDate]);

  return {
    connectionStatus,
    isConnected: connectionStatus === 'connected',
    dataFreshness,
  };
}
