/**
 * Final Express error handler.
 *
 * Catches any error that propagates out of a route or upstream middleware
 * (synchronously or via next(err)). Logs the full error server-side and
 * returns a generic JSON payload to the client — never the raw Error.message,
 * which historically leaked SQL fragments, file paths, and internal state.
 *
 * Routes that need a specific user-facing message should handle the error
 * locally (sendError / ErrorResponses) before it reaches this handler.
 *
 * Must be registered AFTER every route mount in index.ts.
 */

import type { Request, Response, NextFunction } from 'express';
import { log } from '../utils/logger.js';
import { classifyPgError } from '../utils/pg-errors.js';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  // 4 parameters required for Express to recognize this as an error handler.
  _next: NextFunction
): void {
  const timestamp = new Date().toISOString();
  const isProduction = process.env.NODE_ENV === 'production';

  if (res.headersSent) {
    // The response is already partway out — Express's default handler will
    // abort the connection. Just log so the failure isn't silent.
    log.error('Route error after response started', {
      timestamp,
      method: req.method,
      path: req.path,
      error: err.message,
      stack: err.stack,
    });
    return;
  }

  // Safety net for a pg constraint violation that escaped a route's own
  // try/catch: classify it to the right status (409/400) instead of a blanket
  // 500. Routes that handle the error locally never reach here.
  const classified = classifyPgError(err);
  if (classified) {
    log.warn('DB error classified at central handler', {
      timestamp,
      method: req.method,
      path: req.path,
      code: classified.code,
      error: err.message,
    });
    res.status(classified.status).json({
      success: false,
      error: classified.message,
      code: classified.code,
      timestamp,
      ...(!isProduction && {
        details: { message: err.message, stack: err.stack },
      }),
    });
    return;
  }

  log.error('Unhandled route error', {
    timestamp,
    method: req.method,
    path: req.path,
    error: err.message,
    stack: err.stack,
  });

  res.status(500).json({
    success: false,
    error: 'An unexpected error occurred. Please try again or contact support.',
    timestamp,
    // In dev, surface the underlying message + stack so the developer doesn't
    // have to dig in logs. Never in production.
    ...(!isProduction && {
      details: { message: err.message, stack: err.stack },
    }),
  });
}
