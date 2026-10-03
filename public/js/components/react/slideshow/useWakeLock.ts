import { useEffect, useRef, useCallback } from 'react';

/**
 * Holds a screen Wake Lock while `active` is true so the display never sleeps
 * during a presentation. All failures are non-fatal (the API may be absent, or the
 * UA may reject on low battery).
 *
 * The browser RELEASES the lock whenever the page is hidden (another tab, another
 * app) and does not give it back; we re-acquire on `visibilitychange`. That used to
 * do nothing: the ref still held the auto-released sentinel, so `acquire()` returned
 * early and the display slept mid-presentation after any switch (FE-F15-2). The
 * sentinel's own `release` event now clears the ref, and a lock that resolves after
 * the hook was torn down is released at once instead of being kept.
 *
 * Typed defensively because `navigator.wakeLock` is not present in every TS DOM
 * lib target.
 */
interface WakeLockSentinelLike {
  released?: boolean;
  release: () => Promise<void>;
  addEventListener?: (type: 'release', listener: () => void) => void;
}
interface WakeLockNavigator {
  wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
}

export function useWakeLock(active: boolean): void {
  const lockRef = useRef<WakeLockSentinelLike | null>(null);
  // True while the hook wants a lock (between effect setup and cleanup).
  const wantedRef = useRef(false);
  const pendingRef = useRef(false);

  const acquire = useCallback(async () => {
    const wl = (navigator as Navigator & WakeLockNavigator).wakeLock;
    if (!wl || pendingRef.current || document.visibilityState !== 'visible') return;
    if (lockRef.current && !lockRef.current.released) return;
    pendingRef.current = true;
    try {
      const sentinel = await wl.request('screen');
      if (!wantedRef.current) {
        // Torn down while the request was pending — do not keep the lock.
        void sentinel.release().catch(() => {});
        return;
      }
      lockRef.current = sentinel;
      sentinel.addEventListener?.('release', () => {
        if (lockRef.current === sentinel) lockRef.current = null;
      });
    } catch {
      /* non-fatal */
    } finally {
      pendingRef.current = false;
    }
  }, []);

  const release = useCallback(async () => {
    const lock = lockRef.current;
    lockRef.current = null;
    if (lock && !lock.released) {
      try {
        await lock.release();
      } catch {
        /* ignore */
      }
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    wantedRef.current = true;
    void acquire();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void acquire();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      wantedRef.current = false;
      document.removeEventListener('visibilitychange', onVisibility);
      void release();
    };
  }, [active, acquire, release]);
}
