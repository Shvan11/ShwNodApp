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
//  - The keep-alive is a named `ping` event, not a comment frame: a comment is
//    invisible to EventSource, so a client could not tell a quiet stream from a
//    dead one. The clients reopen a stream silent for 60 s (audit FE-F11-7).

import { Router, type Request, type Response } from 'express';
import type { EventEmitter } from 'events';
import { InternalEmitterEvents } from './websocket-events.js';
import { buildChairPatientPayload, type ChairPatientPayload } from './chair-payload-builder.js';
import { log } from '../../utils/logger.js';
import type { RenderedEvent } from '../../shared/contracts/photo-editor.contract.js';

const appointmentsClients = new Set<Response>();
// Every open kiosk stream per chair. A chair may have more than one screen (a
// patient-facing one and one at the operator's side): it used to be ONE stream
// per chair, so two kiosks on the same number kept ending each other's stream and
// reconnecting every few seconds (audit FE-F11-15b).
const chairClients = new Map<string, Set<Response>>();

function chairStreams(chairId: string): Set<Response> {
  return chairClients.get(chairId) ?? new Set();
}
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
/** The liveness frame the clients watch for (public/js/services/sse-channel.ts). */
const PING_FRAME = 'event: ping\ndata: 0\n\n';

let initialized = false;
let keepAliveHandle: ReturnType<typeof setInterval> | null = null;
let listenerRefs: Array<{ event: string; fn: (...args: unknown[]) => void }> = [];
// Declared before ensureInitialized(), which assigns it — a `let` below the
// function body is a TDZ waiting to happen if this is ever called at module load.
let attachedEmitter: EventEmitter | null = null;

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
    // No active kiosk for this chair — the payload stays cached for the next connect.
    const frame = `event: chair_display_patient_loaded\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const res of chairStreams(chairId)) safeWrite(res, frame);
  };

  const onChairPatientClear = (chairId: string): void => {
    chairEpoch.set(chairId, (chairEpoch.get(chairId) ?? 0) + 1);
    chairCurrentPatient.delete(chairId);
    for (const res of chairStreams(chairId)) safeWrite(res, 'event: chair_display_patient_cleared\ndata: {}\n\n');
  };

  // A background photo render finished — notify every appointments-stream viewer
  // (the photos grid rides this same stream). Clients filter by personId/tpCode.
  const onPhotoTimepointRendered = (payload: RenderedEvent): void => {
    if (appointmentsClients.size === 0) return;
    const frame = `event: photos_rendered\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const res of appointmentsClients) safeWrite(res, frame);
  };

  emitter.on(InternalEmitterEvents.DATA_UPDATED, onAppointmentsUpdated);
  emitter.on(InternalEmitterEvents.CHAIR_PATIENT_LOAD, onChairPatientLoad);
  emitter.on(InternalEmitterEvents.CHAIR_PATIENT_CLEAR, onChairPatientClear);
  emitter.on(InternalEmitterEvents.PHOTO_TIMEPOINT_RENDERED, onPhotoTimepointRendered);

  listenerRefs = [
    { event: InternalEmitterEvents.DATA_UPDATED, fn: onAppointmentsUpdated as (...args: unknown[]) => void },
    { event: InternalEmitterEvents.CHAIR_PATIENT_LOAD, fn: onChairPatientLoad as (...args: unknown[]) => void },
    { event: InternalEmitterEvents.CHAIR_PATIENT_CLEAR, fn: onChairPatientClear as (...args: unknown[]) => void },
    { event: InternalEmitterEvents.PHOTO_TIMEPOINT_RENDERED, fn: onPhotoTimepointRendered as (...args: unknown[]) => void },
  ];

  // Single shared timer fans a `ping` event to every open stream. Cheaper than
  // per-connection timers; keeps proxies from idling the stream out AND lets the
  // client's liveness watchdog see the transport is alive.
  keepAliveHandle = setInterval(() => {
    for (const res of appointmentsClients) safeWrite(res, PING_FRAME);
    for (const streams of chairClients.values()) {
      for (const res of streams) safeWrite(res, PING_FRAME);
    }
  }, KEEP_ALIVE_MS);
  keepAliveHandle.unref();

  // Cache emitter so teardown can detach listeners.
  attachedEmitter = emitter;
}

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
    log.debug('SSE appointments client connected', { count: appointmentsClients.size });

    req.on('close', () => {
      appointmentsClients.delete(res);
      log.debug('SSE appointments client disconnected', { count: appointmentsClients.size });
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

    let streams = chairClients.get(chairId);
    if (!streams) {
      streams = new Set();
      chairClients.set(chairId, streams);
    }
    streams.add(res);
    log.debug('SSE chair-display connected', { chairId, streams: streams.size });

    // Replay the cached payload — same UX guarantee the WS REGISTER handler provided.
    const stored = chairCurrentPatient.get(chairId);
    if (stored && Date.now() - stored.loadedAt < CHAIR_PATIENT_REPLAY_TTL_MS) {
      safeWrite(res, `event: chair_display_patient_loaded\ndata: ${JSON.stringify(stored.payload)}\n\n`);
    } else if (stored) {
      chairCurrentPatient.delete(chairId);
    }

    req.on('close', () => {
      const open = chairClients.get(chairId);
      open?.delete(res);
      if (open && open.size === 0) chairClients.delete(chairId);
      log.debug('SSE chair-display disconnected', { chairId });
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
  for (const streams of chairClients.values()) {
    for (const res of streams) {
      try { res.end(); } catch { /* ignore */ }
    }
  }
  chairClients.clear();
  chairCurrentPatient.clear();
  chairEpoch.clear();
  initialized = false;
}
