/**
 * Patient Portal Authentication Middleware
 *
 * Separate from staff `authenticate` — checks the portal session cookie.
 * Staff and patient sessions coexist in one browser because they use
 * different cookie names (`shwan.sid` vs `shwan.portal`).
 */
import rateLimit from 'express-rate-limit';
import type { Request, Response, NextFunction } from 'express';
import { log } from '../utils/logger.js';
import { ErrorResponses } from '../utils/error-response.js';

/**
 * 401 unless the portal session has a patientId.
 */
export function authenticatePatient(
  req: Request,
  res: Response,
  next: NextFunction
): void | Response {
  if (req.session && req.session.patientId) {
    return next();
  }
  log.warn(`Patient portal auth failed for ${req.method} ${req.path}`);
  return ErrorResponses.unauthorized(res, 'Authentication required');
}

/**
 * Rate limiter for POST /api/portal/login:
 * 5 attempts per 15 minutes per IP.
 */
export const portalLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many login attempts. Please try again later.',
  },
});
