import { useEffect, useRef, useCallback } from 'react';

/**
 * Holds a screen Wake Lock while `active` is true so the display never sleeps
 * during a presentation. The lock auto-releases when the tab is hidden, so we
 * re-acquire on `visibilitychange`. All failures are non-fatal (the API may be
 * absent, or the UA may reject on low battery).
 *
 * Typed defensively because `navigator.wakeLock` is not present in every TS DOM
 * lib target.
 */
interface WakeLockSentinelLike {
  release: () => Promise<void>;
}
interface WakeLockNavigator {
  wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
}

export function useWakeLock(active: boolean): void {
  const lockRef = useRef<WakeLockSentinelLike | null>(null);

  const acquire = useCallback(async () => {
    const wl = (navigator as Navigator & WakeLockNavigator).wakeLock;
    if (!wl || lockRef.current || document.visibilityState !== 'visible') return;
    try {
      lockRef.current = await wl.request('screen');
    } catch {
      /* non-fatal */
    }
  }, []);

  const release = useCallback(async () => {
    const lock = lockRef.current;
    lockRef.current = null;
    if (lock) {
      try {
        await lock.release();
      } catch {
        /* ignore */
      }
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void acquire();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void acquire();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      void release();
    };
  }, [active, acquire, release]);
}
