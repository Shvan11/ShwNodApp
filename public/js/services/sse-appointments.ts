// public/js/services/sse-appointments.ts
//
// SSE singleton for the daily-appointments stream. Mirrors the parts of the
// `wsService` surface that `useWebSocketSync` consumes so the hook swaps with
// a small internal diff.
//
// Differences from wsService that are intentional:
//  - No freshness clock / polling. EventSource has a clear OPEN state; the
//    server's 25 s keep-alive comments keep the transport honest. Freshness
//    derives directly from `readyState === OPEN`. Saves one timer per tab.
//  - No JSON heartbeat envelope to parse — comment frames never fire onmessage.
//  - Browser-native reconnect handles transport blips via `retry: 3000` sent
//    by the server. We only defensively force-reconnect on visibility / bfcache.

import { VISIBILITY_RESUME_THRESHOLD_MS } from '../constants/websocket-liveness';

export type Freshness = 'fresh' | 'stale';

type Handler = (payload: unknown) => void;

const SSE_URL = '/api/sse/appointments';

class SseAppointments {
  private es: EventSource | null = null;
  private refcount = 0;
  private listeners = new Map<string, Set<Handler>>();
  private hasOpenedOnce = false;
  private hiddenSince: number | null = null;
  private domHandlersAttached = false;

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
        console.error(`[sse-appointments] listener for "${event}" threw`, err);
      }
    }
  }

  // ----- Freshness (readyState-derived) -----

  getFreshness(): Freshness {
    return this.es?.readyState === EventSource.OPEN ? 'fresh' : 'stale';
  }

  /**
   * Force a stale signal — used by callers when an out-of-band recovery
   * fetch fails and the UI should reflect the data gap even though the
   * transport is still nominally connected.
   */
  markStale(): void {
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
    if (this.es) {
      // Connection is opening — wait for it.
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
    return new Promise((resolve, reject) => {
      this.connect(resolve, reject);
    });
  }

  release(): void {
    if (this.refcount > 0) this.refcount--;
    if (this.refcount === 0) this.disconnect();
  }

  // ----- Private -----

  private connect(onOpen?: () => void, onError?: (err: Error) => void): void {
    if (this.es) {
      try { this.es.close(); } catch { /* ignore */ }
      this.es = null;
    }

    this.emit('connecting');

    const es = new EventSource(SSE_URL);
    this.es = es;

    es.onopen = () => {
      this.emit('connected');
      this.emit('freshness_changed', { freshness: 'fresh' });
      if (this.hasOpenedOnce) {
        this.emit('reconnected');
      } else {
        this.hasOpenedOnce = true;
      }
      onOpen?.();
    };

    es.onerror = () => {
      // EventSource auto-reconnects when readyState === CONNECTING (browser
      // honors the server's `retry: 3000`). CLOSED means it gave up — e.g.
      // a 401 from the auth gate. Surface both states; the hook decides UI.
      if (es.readyState === EventSource.CONNECTING) {
        this.emit('reconnecting');
        this.emit('freshness_changed', { freshness: 'stale' });
      } else if (es.readyState === EventSource.CLOSED) {
        this.emit('error');
        this.emit('freshness_changed', { freshness: 'stale' });
        onError?.(new Error('SSE closed'));
      }
    };

    es.addEventListener('appointments_updated', (evt) => {
      try {
        const data = JSON.parse((evt as MessageEvent).data) as Record<string, unknown>;
        this.emit('appointments_updated', data);
      } catch (err) {
        console.error('[sse-appointments] bad appointments_updated payload', err);
      }
    });
  }

  private disconnect(): void {
    if (!this.es) return;
    try { this.es.close(); } catch { /* ignore */ }
    this.es = null;
    this.hasOpenedOnce = false;
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

const sseAppointments = new SseAppointments();
export default sseAppointments;
