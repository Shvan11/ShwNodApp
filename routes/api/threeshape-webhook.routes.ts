/**
 * 3Shape Unite webhook receiver — `POST /api/integrations/3shape/webhook`.
 *
 * Mounted PRE-gate in index.ts (3Shape has no staff session) and CSRF-exempt
 * (see middleware/csrf.ts). It authenticates the caller with the shared secret we
 * set as AuthSchema/AuthValue when registering the subscription. The body shape is
 * 3Shape's; we parse it leniently, log the event, and acknowledge fast.
 *
 * NOTE (extension point): IntegrationId in the payload === our person_id, so a
 * later enhancement can notify staff (Tasks/SSE) or refresh an open "3D Scans"
 * tab. For now the scans view is live-on-open, so we only log + ack.
 */
import { Router, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import config from '../../config/config.js';
import { log } from '../../utils/logger.js';

const router = Router();

function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** Accept the secret via `Authorization: Bearer <secret>`, raw Authorization, or
 *  `x-webhook-secret` — covers 3Shape's AuthSchema variants. Constant-time match. */
function secretValid(req: Request, secret: string): boolean {
  const candidates: string[] = [];
  const auth = req.headers['authorization'];
  if (typeof auth === 'string') {
    candidates.push(auth);
    if (auth.startsWith('Bearer ')) candidates.push(auth.slice(7));
  }
  const x = req.headers['x-webhook-secret'];
  if (typeof x === 'string') candidates.push(x);
  return candidates.some((c) => timingSafeEqualStr(c, secret));
}

router.post('/api/integrations/3shape/webhook', (req: Request, res: Response): void => {
  const secret = config.threeshape.webhookSecret;
  if (!secret) {
    res.status(503).json({ success: false, error: 'Webhook not configured' });
    return;
  }
  if (!secretValid(req, secret)) {
    log.warn('[3Shape webhook] rejected — bad or missing secret');
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const eventType = body.EventType ?? body.eventType ?? body.event ?? 'unknown';
  const integrationId = body.IntegrationId ?? body.integrationId ?? null;
  log.info('[3Shape webhook] event received', { eventType, integrationId });

  res.status(200).json({ success: true });
});

export default router;
