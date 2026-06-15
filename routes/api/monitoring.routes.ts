/**
 * Monitoring Routes Module
 *
 * - POST /client-error: browser-side error sink. The staff SPA POSTs failures it
 *   would otherwise only console.error (render-boundary crashes, fail-loud contract
 *   drift, uncaught window errors) and we log them via Winston, so prod issues land
 *   in error.log instead of dying in a user's console. Fire-and-forget on the
 *   client — we just log + ack.
 */
import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import type { z } from 'zod';
import { sendData } from '../../utils/error-response.js';
import { validate } from '../../middleware/validate.js';
import { log } from '../../utils/logger.js';
import { reportClientError } from '../../shared/contracts/monitoring.contract.js';

const router = Router();

// Flood guard: a render loop on one tab (or a hostile client) must not be able to
// hammer error.log. Generous enough for a genuine burst; the client also throttles
// + dedupes + hard-caps before sending, so this is defense in depth.
const clientErrorLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, error: 'Too many client error reports.' },
});

/**
 * POST /client-error → /api/client-error
 */
router.post(
  '/client-error',
  clientErrorLimiter,
  validate({ body: reportClientError.body }),
  (req: Request<object, unknown, z.infer<typeof reportClientError.body>>, res: Response): void => {
    const { source, message, stack, componentStack, url, userAgent, status, queryKey, validation, at } =
      req.body;

    // Single error-level line per report; the structured meta keeps the stack +
    // component stack + originating user/session for triage.
    log.error(`[client-error] ${source}: ${message}`, {
      source,
      url,
      status,
      queryKey,
      validation,
      userAgent,
      clientTime: at,
      userId: req.session?.userId,
      username: req.session?.username,
      ip: req.ip,
      stack,
      componentStack,
    });

    sendData(res, reportClientError.response, { ok: true });
  }
);

export default router;
