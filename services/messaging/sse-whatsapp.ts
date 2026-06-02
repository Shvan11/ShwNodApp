// services/messaging/sse-whatsapp.ts
//
// SSE transport for the WhatsApp channel (replaces the legacy waStatus + auth
// WebSocket fan-out). Subscribes to typed `InternalEmitterEvents.WHATSAPP_*`
// events and writes one SSE frame per emit. Every connected stream registers
// as a QR viewer so the `messageState.activeQRViewers > 0` optimization that
// gates QR data-URL generation and on-demand init keeps working.

import { Router, type Request, type Response } from 'express';
import type { EventEmitter } from 'events';
import { InternalEmitterEvents } from './websocket-events.js';
import messageState from '../state/messageState.js';
import { log } from '../../utils/logger.js';

interface WhatsappClient {
  res: Response;
  viewerId: string;
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

function broadcast(event: string, payload: unknown): void {
  if (whatsappClients.size === 0) return;
  const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const { res } of whatsappClients.values()) safeWrite(res, frame);
}

function ensureInitialized(emitter: EventEmitter): void {
  if (initialized) return;
  initialized = true;

  const wire: Array<[string, string]> = [
    [InternalEmitterEvents.WHATSAPP_QR_UPDATED, 'whatsapp_qr_updated'],
    [InternalEmitterEvents.WHATSAPP_CLIENT_READY, 'whatsapp_client_ready'],
    [InternalEmitterEvents.WHATSAPP_MESSAGE_STATUS, 'whatsapp_message_status'],
    [InternalEmitterEvents.WHATSAPP_SENDING_STARTED, 'whatsapp_sending_started'],
    [InternalEmitterEvents.WHATSAPP_SENDING_PROGRESS, 'whatsapp_sending_progress'],
    [InternalEmitterEvents.WHATSAPP_SENDING_FINISHED, 'whatsapp_sending_finished'],
  ];

  for (const [internal, wireName] of wire) {
    const fn = (payload: unknown): void => broadcast(wireName, payload ?? {});
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
    whatsappClients.set(viewerId, { res, viewerId });

    // Pair each registerQRViewer with exactly one unregisterQRViewer regardless
    // of timing. The 'close' listener is attached BEFORE the await so a
    // disconnect during registration isn't lost; if it fires before register
    // resolves, cleanup is deferred so we never unregister before we register.
    let registered = false;
    let closedEarly = false;
    const cleanup = (): void => {
      whatsappClients.delete(viewerId);
      void messageState.unregisterQRViewer(viewerId).catch(() => {
        /* state already torn down */
      });
      log.debug('SSE whatsapp client disconnected', {
        viewerId,
        count: whatsappClients.size,
      });
    };

    req.on('close', () => {
      if (registered) cleanup();
      else closedEarly = true;
    });

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
  for (const { res, viewerId } of whatsappClients.values()) {
    try { res.end(); } catch { /* ignore */ }
    void messageState.unregisterQRViewer(viewerId).catch(() => { /* state already torn down */ });
  }
  whatsappClients.clear();
  initialized = false;
}
