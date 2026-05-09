/**
 * Chair-Side Public Display Routes
 *
 * Endpoints called by the main staff app via navigator.sendBeacon when a patient
 * is opened/closed in the patient shell. The server emits an internal event;
 * the WebSocket layer relays the event to the chair-display browser tab on the
 * matching chair.
 *
 * Both endpoints respond 202 Accepted immediately. The client is sendBeacon-based
 * and never reads the response, so server response time has no effect on the
 * staff app's perceived performance.
 */

import { Router, type Request, type Response } from 'express';
import type { EventEmitter } from 'events';
import { log } from '../../utils/logger.js';
import { WebSocketEvents } from '../../services/messaging/websocket-events.js';

const router = Router();

let wsEmitter: EventEmitter | null = null;

export function setWebSocketEmitter(emitter: EventEmitter): void {
  wsEmitter = emitter;
}

interface PatientLoadedBody {
  chairId?: unknown;
  personId?: unknown;
}

interface PatientClearedBody {
  chairId?: unknown;
}

function parseChairId(value: unknown): string | null {
  const str = typeof value === 'number' ? String(value) : typeof value === 'string' ? value : '';
  return /^([1-9]|10)$/.test(str) ? str : null;
}

router.post(
  '/chair-display/patient-loaded',
  (req: Request<unknown, unknown, PatientLoadedBody>, res: Response): void => {
    res.sendStatus(202);

    const chairId = parseChairId(req.body?.chairId);
    const personIdRaw = req.body?.personId;
    const personId = typeof personIdRaw === 'number' ? personIdRaw : parseInt(String(personIdRaw ?? ''), 10);

    if (!chairId || !Number.isFinite(personId) || personId <= 0) {
      log.warn('chair-display patient-loaded: invalid payload', { chairId, personId });
      return;
    }

    if (wsEmitter) {
      wsEmitter.emit(WebSocketEvents.CHAIR_DISPLAY_PATIENT_LOADED, String(personId), chairId);
    }
  }
);

router.post(
  '/chair-display/patient-cleared',
  (req: Request<unknown, unknown, PatientClearedBody>, res: Response): void => {
    res.sendStatus(202);

    const chairId = parseChairId(req.body?.chairId);
    if (!chairId) {
      log.warn('chair-display patient-cleared: invalid chairId', { chairId: req.body?.chairId });
      return;
    }

    if (wsEmitter) {
      wsEmitter.emit(WebSocketEvents.CHAIR_DISPLAY_PATIENT_CLEARED, chairId);
    }
  }
);

export default router;
