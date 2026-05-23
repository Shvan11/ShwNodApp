// services/messaging/sse-broadcaster.ts
//
// SSE transport for the `daily-appointments` and `chair-display` channels.
// Subscribes to the same internal `wsEmitter` events the WebSocket handler
// uses, so the existing emit sites (appointment.routes.ts, chair-display.
// routes.ts) need no changes.
//
// Memory/CPU choices (per CLAUDE.md guidance to minimize both):
//  - No JSON envelope per event — single string allocation per send.
//  - No Last-Event-ID buffer — clients fall back to REST refetch on reconnect.
//  - One module-scoped keep-alive interval (25 s), not per connection.
//  - Comment frames (`:\n\n`) for keep-alive — no client allocation.

import { Router, type Request, type Response } from 'express';
import type { EventEmitter } from 'events';
import { InternalEmitterEvents } from './websocket-events.js';
import { buildChairPatientPayload, type ChairPatientPayload } from './chair-payload-builder.js';
import { logger } from '../core/Logger.js';

const appointmentsClients = new Set<Response>();
const chairClients = new Map<string, Response>();
const chairCurrentPatient = new Map<string, { payload: ChairPatientPayload; loadedAt: number }>();
// Monotonic per-chair counter — bumped synchronously on every LOAD/CLEAR so an
// async LOAD that resolves AFTER a later CLEAR (or another LOAD) can detect
// it's been superseded and skip writing stale state to the cache/kiosk.
const chairEpoch = new Map<string, number>();

// 12 h covers a workday + buffer; staff arriving the next morning won't see
// yesterday's patient. Same TTL the legacy WS replay used.
const CHAIR_PATIENT_REPLAY_TTL_MS = 12 * 60 * 60 * 1000;

// 25 s undercuts typical proxy idle drops (Caddy default ~30 s) and the
// browser's silent-fail window for EventSource.
const KEEP_ALIVE_MS = 25_000;

let initialized = false;
let keepAliveHandle: ReturnType<typeof setInterval> | null = null;
let listenerRefs: Array<{ event: string; fn: (...args: unknown[]) => void }> = [];

function safeWrite(res: Response, data: string): void {
  if (res.writableEnded || res.destroyed) return;
  try {
    res.write(data);
  } catch {
    // Socket dead; req.on('close') will clean up the registration.
  }
}

function ensureInitialized(emitter: EventEmitter): void {
  if (initialized) return;
  initialized = true;

  const onAppointmentsUpdated = (date: string): void => {
    if (appointmentsClients.size === 0) return;
    const frame = `event: appointments_updated\ndata: ${JSON.stringify({ date })}\n\n`;
    for (const res of appointmentsClients) safeWrite(res, frame);
  };

  const onChairPatientLoad = async (pid: string, chairId: string): Promise<void> => {
    const epoch = (chairEpoch.get(chairId) ?? 0) + 1;
    chairEpoch.set(chairId, epoch);
    const payload = await buildChairPatientPayload(pid, chairId);
    if (!payload) return;
    // A later LOAD or CLEAR bumped the epoch while we were awaiting the DB —
    // commit nothing, or we'd resurrect a cleared patient in the cache (12 h TTL).
    if (chairEpoch.get(chairId) !== epoch) return;
    chairCurrentPatient.set(chairId, { payload, loadedAt: Date.now() });
    const res = chairClients.get(chairId);
    if (!res) return; // No active kiosk for this chair — payload stays cached for next connect.
    safeWrite(res, `event: chair_display_patient_loaded\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  const onChairPatientClear = (chairId: string): void => {
    chairEpoch.set(chairId, (chairEpoch.get(chairId) ?? 0) + 1);
    chairCurrentPatient.delete(chairId);
    const res = chairClients.get(chairId);
    if (!res) return;
    safeWrite(res, 'event: chair_display_patient_cleared\ndata: {}\n\n');
  };

  emitter.on(InternalEmitterEvents.DATA_UPDATED, onAppointmentsUpdated);
  emitter.on(InternalEmitterEvents.CHAIR_PATIENT_LOAD, onChairPatientLoad);
  emitter.on(InternalEmitterEvents.CHAIR_PATIENT_CLEAR, onChairPatientClear);

  listenerRefs = [
    { event: InternalEmitterEvents.DATA_UPDATED, fn: onAppointmentsUpdated as (...args: unknown[]) => void },
    { event: InternalEmitterEvents.CHAIR_PATIENT_LOAD, fn: onChairPatientLoad as (...args: unknown[]) => void },
    { event: InternalEmitterEvents.CHAIR_PATIENT_CLEAR, fn: onChairPatientClear as (...args: unknown[]) => void },
  ];

  // Single shared timer fans `:\n\n` (SSE comment frame) to every open stream.
  // Cheaper than per-connection timers and proves transport health to proxies.
  keepAliveHandle = setInterval(() => {
    for (const res of appointmentsClients) safeWrite(res, ':\n\n');
    for (const res of chairClients.values()) safeWrite(res, ':\n\n');
  }, KEEP_ALIVE_MS);
  keepAliveHandle.unref();

  // Cache emitter so teardown can detach listeners.
  attachedEmitter = emitter;
}

let attachedEmitter: EventEmitter | null = null;

function openStream(req: Request, res: Response): void {
  // Bypass the global 30 s requestTimeout (middleware/timeout.ts) — without
  // this every SSE connection 408s at exactly 30 s.
  req.setTimeout(0);
  res.setTimeout(0);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  // Jitter 2500–3500 ms so all clients don't reconnect in lockstep after a restart.
  res.write(`retry: ${2500 + Math.floor(Math.random() * 1000)}\n\n`);
}

export function createAppointmentsSseRouter(emitter: EventEmitter): Router {
  ensureInitialized(emitter);
  const router = Router();

  router.get('/appointments', (req: Request, res: Response) => {
    openStream(req, res);
    appointmentsClients.add(res);
    logger.websocket.debug('SSE appointments client connected', { count: appointmentsClients.size });

    req.on('close', () => {
      appointmentsClients.delete(res);
      logger.websocket.debug('SSE appointments client disconnected', { count: appointmentsClients.size });
    });
  });

  return router;
}

export function createChairDisplaySseRouter(emitter: EventEmitter): Router {
  ensureInitialized(emitter);
  const router = Router();

  router.get('/chair-display/:chairId', (req: Request, res: Response) => {
    const chairId = req.params.chairId;
    if (!/^([1-9]|10)$/.test(chairId)) {
      res.status(400).json({ error: 'Invalid chairId' });
      return;
    }

    openStream(req, res);

    // If a previous stream is mapped, end it explicitly so its req.on('close')
    // can't unmap THIS new connection.
    const prev = chairClients.get(chairId);
    if (prev && prev !== res) {
      try { prev.end(); } catch { /* already gone */ }
    }
    chairClients.set(chairId, res);
    logger.websocket.debug('SSE chair-display connected', { chairId });

    // Replay the cached payload — same UX guarantee the WS REGISTER handler provided.
    const stored = chairCurrentPatient.get(chairId);
    if (stored && Date.now() - stored.loadedAt < CHAIR_PATIENT_REPLAY_TTL_MS) {
      safeWrite(res, `event: chair_display_patient_loaded\ndata: ${JSON.stringify(stored.payload)}\n\n`);
    } else if (stored) {
      chairCurrentPatient.delete(chairId);
    }

    req.on('close', () => {
      // Only delete if the map still points to THIS res — a fast reconnect may
      // have already replaced it via the prev.end() branch above.
      if (chairClients.get(chairId) === res) {
        chairClients.delete(chairId);
      }
      logger.websocket.debug('SSE chair-display disconnected', { chairId });
    });
  });

  return router;
}

export function teardownSseBroadcaster(): void {
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
  for (const res of appointmentsClients) {
    try { res.end(); } catch { /* ignore */ }
  }
  appointmentsClients.clear();
  for (const res of chairClients.values()) {
    try { res.end(); } catch { /* ignore */ }
  }
  chairClients.clear();
  chairCurrentPatient.clear();
  chairEpoch.clear();
  initialized = false;
}
