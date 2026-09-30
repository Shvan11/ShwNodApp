// public/js/services/sse-channel.ts
//
// One refcounted SSE stream, shared by every consumer in the tab. The two
// channels (`sse-appointments.ts`, `sse-whatsapp.ts`) are instances of this
// class; they used to be the same file typed twice, so every fix had to be made
// in both (audit FE-F1-7).
//
// Design notes:
//  - Refcounted: `ensureConnected()` opens on the first consumer, `release()`
//    closes at zero.
//  - Freshness is `readyState === OPEN`, plus two things readyState cannot see:
//      * a stream that has gone SILENT — the server sends a named `ping` every
//        25 s, and an OPEN stream with nothing for SILENT_STREAM_TIMEOUT_MS is
//        reopened (FE-F11-7);
//      * a stream EventSource has given up on (CLOSED after a non-200, e.g. a
//        proxy's 502 during a restart) — reopened with backoff while anyone still
//        holds it (FE-F11-3).
//  - Transport blips that leave the stream CONNECTING are the browser's own
//    reconnect (the server's `retry:`); a long-hidden tab and a bfcache restore
//    force a fresh EventSource.

import {
  CLOSED_STREAM_RETRY_DELAYS_MS,
  LIVENESS_CHECK_INTERVAL_MS,
  SILENT_STREAM_TIMEOUT_MS,
  VISIBILITY_RESUME_THRESHOLD_MS,
} from '../constants/sse-liveness';

export type Freshness = 'fresh' | 'stale';

type Handler = (payload: unknown) => void;

/** The server's liveness frame (see services/messaging/sse-broadcaster.ts). */
const PING_EVENT = 'ping';

export class SseChannel {
  private es: EventSource | null = null;
  private refcount = 0;
  private listeners = new Map<string, Set<Handler>>();
  private hasOpenedOnce = false;
  private hiddenSince: number | null = null;
  private domHandlersAttached = false;
  // Sticky stale flag set by markStale(); cleared on the next successful open.
  // Keeps getFreshness() honest for callers who poll it after a recovery failure.
  private forcedStale = false;
  private lastActivity = 0;
  private livenessTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempt = 0;

  constructor(
    private readonly url: string,
    /** The named events this stream carries; each is re-emitted with its parsed JSON. */
    private readonly wireEvents: readonly string[],
    /** Log prefix, e.g. `sse-appointments`. */
    private readonly label: string
  ) {}

  // ----- Event emitter surface -----

  on(event: string, handler: Handler): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler);
  }

  off(event: string, handler: Handler): void {
    this.listeners.get(event)?.delete(handler);
  }

  private emit(event: string, payload?: unknown): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const h of set) {
      try {
        h(payload);
      } catch (err) {
        console.error(`[${this.label}] listener for "${event}" threw`, err);
      }
    }
  }

  // ----- Freshness -----

  getFreshness(): Freshness {
    if (this.forcedStale) return 'stale';
    return this.es?.readyState === EventSource.OPEN ? 'fresh' : 'stale';
  }

  /**
   * Force a stale signal — used by callers when an out-of-band recovery
   * fetch fails and the UI should reflect the data gap even though the
   * transport is still nominally connected. Sticky until the next open.
   */
  markStale(): void {
    this.forcedStale = true;
    this.emit('freshness_changed', { freshness: 'stale' });
  }

  // ----- Connection lifecycle (refcount-based) -----

  /**
   * Open the stream (or join an existing one). Resolves on the first
   * successful `open`. Subsequent calls just increment the refcount and
   * resolve immediately if already connected.
   */
  ensureConnected(): Promise<void> {
    this.refcount++;
    this.attachDomHandlers();
    if (this.es?.readyState === EventSource.OPEN) return Promise.resolve();
    // Kick off connect() if no EventSource exists yet, then wait on the
    // emitter rather than on a specific EventSource handle — a later connect()
    // (visibility / pageshow / watchdog / retry) replaces the handle but still
    // emits 'connected' on the next open, so the waiter resolves either way.
    if (!this.es) this.connect();
    return new Promise((resolve, reject) => {
      const onOpen = () => {
        this.off('connected', onOpen);
        this.off('error', onError);
        resolve();
      };
      const onError = () => {
        this.off('connected', onOpen);
        this.off('error', onError);
        reject(new Error('SSE connection failed'));
      };
      this.on('connected', onOpen);
      this.on('error', onError);
    });
  }

  release(): void {
    if (this.refcount > 0) this.refcount--;
    if (this.refcount === 0) this.disconnect();
  }

  // ----- Private -----

  private connect(): void {
    this.clearRetry();
    // If we're replacing an OPEN socket (visibility/pageshow/watchdog path), the
    // data path is genuinely dead until the new socket opens — surface that as
    // 'reconnecting' so the indicator stops claiming Live. For the initial open
    // there's no prior live state to invalidate, so just emit 'connecting'.
    const wasOpen = this.es?.readyState === EventSource.OPEN;
    if (this.es) {
      try { this.es.close(); } catch { /* ignore */ }
      this.es = null;
    }

    if (wasOpen) {
      this.emit('reconnecting');
      this.emit('freshness_changed', { freshness: 'stale' });
    } else {
      this.emit('connecting');
    }

    const es = new EventSource(this.url);
    this.es = es;
    this.lastActivity = Date.now();
    this.startLivenessCheck();

    es.onopen = () => {
      this.forcedStale = false;
      this.retryAttempt = 0;
      this.lastActivity = Date.now();
      this.emit('connected');
      this.emit('freshness_changed', { freshness: 'fresh' });
      if (this.hasOpenedOnce) {
        this.emit('reconnected');
      } else {
        this.hasOpenedOnce = true;
      }
    };

    es.onerror = () => {
      // CONNECTING: the browser is auto-reconnecting (the server's `retry:`).
      // CLOSED: it gave up — any non-200 answer, e.g. a proxy's 502 while the
      // service restarts, or a 401. EventSource never retries after that, so we
      // do, with backoff, for as long as anyone holds the stream.
      if (es.readyState === EventSource.CONNECTING) {
        this.emit('reconnecting');
        this.emit('freshness_changed', { freshness: 'stale' });
      } else if (es.readyState === EventSource.CLOSED) {
        this.emit('error');
        this.emit('freshness_changed', { freshness: 'stale' });
        this.scheduleRetry(es);
      }
    };

    es.addEventListener(PING_EVENT, () => {
      this.lastActivity = Date.now();
    });

    for (const wireName of this.wireEvents) {
      es.addEventListener(wireName, (evt) => {
        this.lastActivity = Date.now();
        try {
          const data = JSON.parse((evt as MessageEvent).data) as Record<string, unknown>;
          this.emit(wireName, data);
        } catch (err) {
          console.error(`[${this.label}] bad ${wireName} payload`, err);
        }
      });
    }
  }

  private scheduleRetry(closed: EventSource): void {
    if (this.retryTimer || this.refcount === 0) return;
    const delays = CLOSED_STREAM_RETRY_DELAYS_MS;
    const delay = delays[Math.min(this.retryAttempt, delays.length - 1)];
    this.retryAttempt++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      // Only if that CLOSED stream is still the current one and still wanted.
      if (this.refcount > 0 && this.es === closed) this.connect();
    }, delay);
  }

  private clearRetry(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  /** Reopen an OPEN stream that has delivered nothing (not even a ping) for too long. */
  private startLivenessCheck(): void {
    if (this.livenessTimer) return;
    this.livenessTimer = setInterval(() => {
      const es = this.es;
      if (!es || es.readyState !== EventSource.OPEN) return;
      if (Date.now() - this.lastActivity > SILENT_STREAM_TIMEOUT_MS) {
        console.warn(`[${this.label}] stream silent for ${SILENT_STREAM_TIMEOUT_MS / 1000}s; reopening`);
        this.connect();
      }
    }, LIVENESS_CHECK_INTERVAL_MS);
  }

  private disconnect(): void {
    this.clearRetry();
    if (this.livenessTimer) {
      clearInterval(this.livenessTimer);
      this.livenessTimer = null;
    }
    if (!this.es) return;
    try { this.es.close(); } catch { /* ignore */ }
    this.es = null;
    this.hasOpenedOnce = false;
    this.retryAttempt = 0;
    this.emit('disconnected');
    this.emit('freshness_changed', { freshness: 'stale' });
  }

  private attachDomHandlers(): void {
    if (this.domHandlersAttached) return;
    this.domHandlersAttached = true;

    // Long-hidden tab can sit on a half-dead transport (NAT idle, cellular
    // suspend). Force a fresh EventSource on resume past the threshold.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.hiddenSince = performance.now();
        return;
      }
      const since = this.hiddenSince;
      this.hiddenSince = null;
      if (
        since !== null &&
        performance.now() - since > VISIBILITY_RESUME_THRESHOLD_MS &&
        this.refcount > 0
      ) {
        this.connect();
      }
    });

    // iOS bfcache restore — the EventSource handle survives but the underlying
    // socket is dead. `persisted === true` is the signal to recreate it.
    window.addEventListener('pageshow', (evt) => {
      if ((evt as PageTransitionEvent).persisted && this.refcount > 0) {
        this.connect();
      }
    });
  }
}
