/**
 * Shared Express helper for 3Shape route handlers — maps a thrown error onto a
 * response whose `error` field carries the friendly message (read by the client's
 * httpErrorMessage). Used by both the patient-action routes and the integrations
 * webhook-management routes.
 */
import type { Response } from 'express';
import { ErrorResponses } from '../../utils/error-response.js';
import { log } from '../../utils/logger.js';
import { ThreeShapeError } from './errors.js';

export function sendThreeShapeError(res: Response, err: unknown, fallback: string): void {
  if (err instanceof ThreeShapeError) {
    // Expected, staff-actionable conditions (configure / connect / reconnect / turn
    // the scanner workstation on) → 400 with the friendly message. 400 keeps them out
    // of the 5xx client-error sink — they're operational states, not server faults.
    if (
      err.code === 'not_connected' ||
      err.code === 'reconnect_required' ||
      err.code === 'not_configured' ||
      err.code === 'unreachable'
    ) {
      ErrorResponses.badRequest(res, err.message);
      return;
    }
    // Genuine upstream API error (3Shape returned a 5xx / unexpected status).
    ErrorResponses.internalError(res, err.message);
    return;
  }
  log.error('[3Shape] unexpected route error', { error: (err as Error).message });
  ErrorResponses.internalError(res, fallback);
}
