// services/messaging/sse-whatsapp.ts
//
// SSE transport for the WhatsApp channel (replaces the legacy waStatus + auth
// WebSocket fan-out). Subscribes to typed `InternalEmitterEvents.WHATSAPP_*`
// events and writes one SSE frame per emit. Every connected stream registers
// as a QR viewer so the `messageState.activeQRViewers > 0` optimization that
// gates QR data-URL generation and on-demand init keeps working.
//
// AUTHORIZATION — the route is deliberately NOT `authorize()`d, the PAYLOAD is
// filtered per stream. Six of the seven wire events (client-ready, message
// status, the three sending-progress frames, send-unconfirmed) drive the send
// screens and the per-patient send gate, which every staff role legitimately
// uses — sending is CLINICAL_ROLES. Gating the route would take those out for
// two roles, and would also change WHO registers as a QR viewer, i.e. when
// WhatsApp initializes at all.
//
// The one privileged item is the pairing QR: whoever scans it links a device to
// the clinic's WhatsApp account. `GET /api/wa/qr` is FINANCE_ROLES and
// `/api/wa/initial-state` withholds the QR from everyone else, so this channel
// must not be the way around those gates. Each stream therefore records
// `mayPair` at open, and `whatsapp_qr_updated` is broadcast with `qr` blanked
// for streams that can't pair — the frame itself still goes out, because its
// `clientReady: false` is app-wide state the send gate needs.

import { Router, type Request, type Response } from 'express';
import type { EventEmitter } from 'events';
import { InternalEmitterEvents } from './websocket-events.js';
import messageState from './messageState.js';
import { FINANCE_ROLES } from '../../shared/auth/roles.js';
import { log } from '../../utils/logger.js';

interface WhatsappClient {
  res: Response;
  viewerId: string;
  /**
   * May this stream receive the pairing QR? Snapshotted from the session role at
   * open, which is exactly as fresh as every `authorize()` gate — `userRole` is
   * written only at login. Each EventSource reconnect (the `retry` frame, plus
   * the client singleton's visibility/bfcache forced reconnect) re-runs
   * `authenticate` and re-takes this snapshot, so a role change lands at the
   * next reconnect at the latest.
   */
  mayPair: boolean;
  /** Idempotent per-stream teardown (unregisters the QR viewer exactly once). */
  disconnect: () => void;
}

const whatsappClients = new Map<string, WhatsappClient>();

const KEEP_ALIVE_MS = 25_000;

let initialized = false;
let keepAliveHandle: ReturnType<typeof setInterval> | null = null;
let listenerRefs: Array<{ event: string; fn: (...args: unknown[]) => void }> = [];
let attachedEmitter: EventEmitter | null = null;

function safeWrite(res: Response, data: string): void {
  if (res.writableEnded || res.destroyed) return;
  try {
    res.write(data);
  } catch {
    // Socket dead; req.on('close') will clean up the registration.
  }
}

/**
 * Fan one frame out to every open stream. `redact`, when given, produces the
 * variant sent to streams whose `mayPair` is false — it is built lazily, so the
 * common single-audience case still costs exactly one `JSON.stringify`.
 */
function broadcast(
  event: string,
  payload: unknown,
  redact?: (payload: unknown) => unknown
): void {
  if (whatsappClients.size === 0) return;
  const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  let redactedFrame: string | null = null;
  for (const { res, mayPair } of whatsappClients.values()) {
    if (!redact || mayPair) {
      safeWrite(res, frame);
      continue;
    }
    redactedFrame ??= `event: ${event}\ndata: ${JSON.stringify(redact(payload))}\n\n`;
    safeWrite(res, redactedFrame);
  }
}

/**
 * The non-pairing variant of a `whatsapp_qr_updated` frame. The frame is NOT
 * dropped: `clientReady: false` is app-wide state — `SendMessage`'s per-patient
 * gate reads it — so a stream that can't pair still has to learn WhatsApp is
 * unlinked. Only the scannable data URL is removed.
 */
function redactPairingQr(payload: unknown): unknown {
  return { ...(payload as Record<string, unknown>), qr: null };
}

function mayPairFromSession(req: Request): boolean {
  const role = req.session?.userRole;
  return !!role && (FINANCE_ROLES as readonly string[]).includes(role);
}

function ensureInitialized(emitter: EventEmitter): void {
  if (initialized) return;
  initialized = true;

  // Third slot: the redactor applied to streams that may not pair. Only the
  // pairing QR has one — every other frame goes to every stream verbatim.
  const wire: Array<[string, string, ((payload: unknown) => unknown)?]> = [
    [InternalEmitterEvents.WHATSAPP_QR_UPDATED, 'whatsapp_qr_updated', redactPairingQr],
    [InternalEmitterEvents.WHATSAPP_CLIENT_READY, 'whatsapp_client_ready'],
    [InternalEmitterEvents.WHATSAPP_MESSAGE_STATUS, 'whatsapp_message_status'],
    [InternalEmitterEvents.WHATSAPP_SENDING_STARTED, 'whatsapp_sending_started'],
    [InternalEmitterEvents.WHATSAPP_SENDING_PROGRESS, 'whatsapp_sending_progress'],
    [InternalEmitterEvents.WHATSAPP_SENDING_FINISHED, 'whatsapp_sending_finished'],
    [InternalEmitterEvents.WHATSAPP_SEND_UNCONFIRMED, 'whatsapp_send_unconfirmed'],
  ];

  for (const [internal, wireName, redact] of wire) {
    const fn = (payload: unknown): void => broadcast(wireName, payload ?? {}, redact);
    emitter.on(internal, fn);
    listenerRefs.push({ event: internal, fn: fn as (...args: unknown[]) => void });
  }

  keepAliveHandle = setInterval(() => {
    for (const { res } of whatsappClients.values()) safeWrite(res, ':\n\n');
  }, KEEP_ALIVE_MS);
  keepAliveHandle.unref();

  attachedEmitter = emitter;
}

function generateViewerId(req: Request): string {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  return `${ip}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function openStream(req: Request, res: Response): void {
  req.setTimeout(0);
  res.setTimeout(0);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(`retry: ${2500 + Math.floor(Math.random() * 1000)}\n\n`);
}

export function createWhatsappSseRouter(emitter: EventEmitter): Router {
  ensureInitialized(emitter);
  const router = Router();

  router.get('/whatsapp', async (req: Request, res: Response) => {
    openStream(req, res);

    const viewerId = generateViewerId(req);

    // Pair each registerQRViewer with exactly one unregisterQRViewer regardless
    // of timing. The 'close' listener is attached BEFORE the await so a
    // disconnect during registration isn't lost; if it fires before register
    // resolves, cleanup is deferred so we never unregister before we register.
    let registered = false;
    let closedEarly = false;
    // ...and exactly one unregister per viewer, however many times we're asked:
    // teardown ends the response, which itself fires `close`, so without this
    // latch the same viewer would be unregistered twice and activeQRViewers
    // would drift below the real number of open streams.
    let cleanedUp = false;
    const cleanup = (): void => {
      if (cleanedUp) return;
      cleanedUp = true;
      whatsappClients.delete(viewerId);
      void messageState.unregisterQRViewer(viewerId).catch(() => {
        /* state already torn down */
      });
      log.debug('SSE whatsapp client disconnected', {
        viewerId,
        count: whatsappClients.size,
      });
    };

    const disconnect = (): void => {
      if (registered) cleanup();
      else closedEarly = true;
    };

    whatsappClients.set(viewerId, { res, viewerId, mayPair: mayPairFromSession(req), disconnect });
    req.on('close', disconnect);

    // Every SSE subscriber is a QR viewer. Triggers QR data-URL generation
    // and gates the on-demand init in /api/wa/initial-state.
    try {
      await messageState.registerQRViewer(viewerId);
    } catch (err) {
      log.error('registerQRViewer failed', {
        viewerId,
        error: (err as Error).message,
      });
      whatsappClients.delete(viewerId);
      return; // headers already flushed; nothing more to do
    }
    registered = true;
    if (closedEarly) {
      // Socket closed while registration was in flight — run the deferred
      // cleanup now (synchronous after the flag flip, so no interleave).
      cleanup();
      return;
    }
    log.debug('SSE whatsapp client connected', {
      viewerId,
      count: whatsappClients.size,
    });
  });

  return router;
}

export function teardownWhatsappSseBroadcaster(): void {
  if (keepAliveHandle) {
    clearInterval(keepAliveHandle);
    keepAliveHandle = null;
  }
  if (attachedEmitter) {
    for (const { event, fn } of listenerRefs) {
      attachedEmitter.off(event, fn);
    }
    attachedEmitter = null;
  }
  listenerRefs = [];
  // Go through each stream's own teardown so the QR-viewer count is decremented
  // exactly once per viewer — the `close` that res.end() triggers finds it done.
  for (const { res, disconnect } of Array.from(whatsappClients.values())) {
    try { res.end(); } catch { /* ignore */ }
    disconnect();
  }
  whatsappClients.clear();
  initialized = false;
}
