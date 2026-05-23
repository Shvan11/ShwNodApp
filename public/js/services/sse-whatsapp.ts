// public/js/services/sse-whatsapp.ts
//
// SSE singleton for the WhatsApp channel. Mirrors sse-appointments.ts 1-for-1
// — same refcount lifecycle, freshness derived from readyState, visibility/
// bfcache force-reconnect.
//
// Transport-only: ensureConnected does NOT prime initial state. The hooks
// (useWhatsAppAuth, useWhatsAppWebSocket) call `fetch('/api/wa/initial-state')`
// themselves — they already own the date-change, visibility, and 30 s QR-
// refresh triggers.

import { VISIBILITY_RESUME_THRESHOLD_MS } from '../constants/sse-liveness';

export type Freshness = 'fresh' | 'stale';

type Handler = (payload: unknown) => void;

const SSE_URL = '/api/sse/whatsapp';

const WIRE_EVENTS = [
  'whatsapp_qr_updated',
  'whatsapp_client_ready',
  'whatsapp_message_status',
  'whatsapp_sending_started',
  'whatsapp_sending_progress',
  'whatsapp_sending_finished',
] as const;

class SseWhatsapp {
  private es: EventSource | null = null;
  private refcount = 0;
  private listeners = new Map<string, Set<Handler>>();
  private hasOpenedOnce = false;
  private hiddenSince: number | null = null;
  private domHandlersAttached = false;
  private forcedStale = false;

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
        console.error(`[sse-whatsapp] listener for "${event}" threw`, err);
      }
    }
  }

  // ----- Freshness (readyState-derived) -----

  getFreshness(): Freshness {
    if (this.forcedStale) return 'stale';
    return this.es?.readyState === EventSource.OPEN ? 'fresh' : 'stale';
  }

  markStale(): void {
    this.forcedStale = true;
    this.emit('freshness_changed', { freshness: 'stale' });
  }

  // ----- Connection lifecycle (refcount-based) -----

  ensureConnected(): Promise<void> {
    this.refcount++;
    this.attachDomHandlers();
    if (this.es?.readyState === EventSource.OPEN) return Promise.resolve();
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

    const es = new EventSource(SSE_URL);
    this.es = es;

    es.onopen = () => {
      this.forcedStale = false;
      this.emit('connected');
      this.emit('freshness_changed', { freshness: 'fresh' });
      if (this.hasOpenedOnce) {
        this.emit('reconnected');
      } else {
        this.hasOpenedOnce = true;
      }
    };

    es.onerror = () => {
      if (es.readyState === EventSource.CONNECTING) {
        this.emit('reconnecting');
        this.emit('freshness_changed', { freshness: 'stale' });
      } else if (es.readyState === EventSource.CLOSED) {
        this.emit('error');
        this.emit('freshness_changed', { freshness: 'stale' });
      }
    };

    for (const wireName of WIRE_EVENTS) {
      es.addEventListener(wireName, (evt) => {
        try {
          const data = JSON.parse((evt as MessageEvent).data) as Record<string, unknown>;
          this.emit(wireName, data);
        } catch (err) {
          console.error(`[sse-whatsapp] bad ${wireName} payload`, err);
        }
      });
    }
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

    window.addEventListener('pageshow', (evt) => {
      if ((evt as PageTransitionEvent).persisted && this.refcount > 0) {
        this.connect();
      }
    });
  }
}

const sseWhatsapp = new SseWhatsapp();
export default sseWhatsapp;
