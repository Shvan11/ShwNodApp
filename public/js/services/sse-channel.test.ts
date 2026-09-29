/**
 * SseChannel: the two liveness gaps audit F11 found in the realtime layer.
 *  - FE-F11-3: EventSource gives up (CLOSED) after any non-200 — a proxy's 502
 *    while the service restarts — and never retries; the channel must.
 *  - FE-F11-7: a transport that goes quiet without closing kept reading "Live";
 *    the channel must reopen a stream with no ping for SILENT_STREAM_TIMEOUT_MS.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SseChannel } from './sse-channel';
import {
  CLOSED_STREAM_RETRY_DELAYS_MS,
  LIVENESS_CHECK_INTERVAL_MS,
  SILENT_STREAM_TIMEOUT_MS,
} from '../constants/sse-liveness';

class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];

  readyState = FakeEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private handlers = new Map<string, Array<(e: { data: string }) => void>>();

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(name: string, fn: (e: { data: string }) => void): void {
    this.handlers.set(name, [...(this.handlers.get(name) ?? []), fn]);
  }
  close(): void {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }
  // test drivers
  open(): void {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.();
  }
  failClosed(): void {
    this.readyState = FakeEventSource.CLOSED;
    this.onerror?.();
  }
  fire(name: string, data = '{}'): void {
    for (const fn of this.handlers.get(name) ?? []) fn({ data });
  }
}

const latest = () => FakeEventSource.instances[FakeEventSource.instances.length - 1];

describe('SseChannel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('retries a stream the browser gave up on (CLOSED), with backoff, and reports reconnected', async () => {
    const ch = new SseChannel('/api/sse/test', ['thing_updated'], 'test');
    const reconnected = vi.fn();
    ch.on('reconnected', reconnected);
    const ready = ch.ensureConnected();
    latest().open();
    await ready;

    latest().failClosed(); // e.g. a proxy's 502 mid-restart
    expect(ch.getFreshness()).toBe('stale');
    expect(FakeEventSource.instances).toHaveLength(1);

    vi.advanceTimersByTime(CLOSED_STREAM_RETRY_DELAYS_MS[0]);
    expect(FakeEventSource.instances).toHaveLength(2);
    latest().failClosed(); // still down: the next delay is longer
    vi.advanceTimersByTime(CLOSED_STREAM_RETRY_DELAYS_MS[0]);
    expect(FakeEventSource.instances).toHaveLength(2);
    vi.advanceTimersByTime(CLOSED_STREAM_RETRY_DELAYS_MS[1] - CLOSED_STREAM_RETRY_DELAYS_MS[0]);
    expect(FakeEventSource.instances).toHaveLength(3);

    latest().open();
    expect(ch.getFreshness()).toBe('fresh');
    expect(reconnected).toHaveBeenCalledTimes(1);
    ch.release();
  });

  it('does not retry once nobody holds the stream', async () => {
    const ch = new SseChannel('/api/sse/test', [], 'test');
    const ready = ch.ensureConnected();
    latest().open();
    await ready;
    latest().failClosed();
    ch.release();
    vi.advanceTimersByTime(60_000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('reopens an OPEN stream that stays silent, and keeps one that pings', async () => {
    const ch = new SseChannel('/api/sse/test', ['thing_updated'], 'test');
    const reconnecting = vi.fn();
    ch.on('reconnecting', reconnecting);
    const ready = ch.ensureConnected();
    latest().open();
    await ready;

    // Pings every 25 s: never reopened.
    for (let t = 0; t < 4; t++) {
      vi.advanceTimersByTime(25_000);
      latest().fire('ping', '0');
    }
    expect(FakeEventSource.instances).toHaveLength(1);

    // Silence past the threshold (checked every LIVENESS_CHECK_INTERVAL_MS).
    vi.advanceTimersByTime(SILENT_STREAM_TIMEOUT_MS + LIVENESS_CHECK_INTERVAL_MS);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances[0].closed).toBe(true);
    expect(reconnecting).toHaveBeenCalled();
    expect(ch.getFreshness()).toBe('stale');
    ch.release();
  });

  it('re-emits wire events with their parsed payload, and counts them as activity', async () => {
    const ch = new SseChannel('/api/sse/test', ['thing_updated'], 'test');
    const seen = vi.fn();
    ch.on('thing_updated', seen);
    const ready = ch.ensureConnected();
    latest().open();
    await ready;
    latest().fire('thing_updated', '{"date":"2026-09-29"}');
    expect(seen).toHaveBeenCalledWith({ date: '2026-09-29' });
    ch.release();
    expect(latest().closed).toBe(true);
  });
});
