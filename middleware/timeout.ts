/**
 * Request Timeout Middleware
 *
 * Provides configurable timeout functionality for Express routes.
 * Prevents long-running requests from hanging indefinitely.
 *
 * Usage:
 * - app.use(requestTimeout(30000)) - Global 30 second timeout
 * - router.get('/long', requestTimeout(300000), handler) - Route-specific 5 minute timeout
 */

import type { Request, Response, NextFunction } from 'express';
import { sendError } from '../utils/error-response.js';
import { log } from '../utils/logger.js';
import type { Middleware } from './types.js';

/**
 * The timeout callback currently registered for a response, so a second
 * `requestTimeout(...)` on the same request can REPLACE it instead of stacking.
 *
 * `res.setTimeout(ms, cb)` sets the socket deadline but *appends* the listener, so
 * the global `requestTimeout(DEFAULT)` in index.ts plus a route-level
 * `timeouts.long` left two callbacks on one deadline. The route's longer duration
 * won (last write to the socket), but the GLOBAL callback still ran first when it
 * fired — reporting `timeout: 30000` in the 408 body and the log line for a request
 * that had actually been given 120000. A WeakMap, not a property on `res`, so
 * nothing is added to an object Express hands to user code and the entry dies with
 * the response.
 */
const activeTimeoutCallback = new WeakMap<Response, () => void>();

/**
 * Default timeout values (in milliseconds)
 */
export const TIMEOUTS = {
  DEFAULT: 30000,           // 30 seconds - default for most routes
  SHORT: 10000,             // 10 seconds - quick operations
  MEDIUM: 60000,            // 1 minute - standard operations
  LONG: 120000,             // 2 minutes - file uploads, batch operations
  WHATSAPP_SEND: 300000,    // 5 minutes - WhatsApp batch sending
  DATABASE_QUERY: 30000,    // 30 seconds - database query timeout
} as const;

export type TimeoutType = keyof typeof TIMEOUTS;
export type TimeoutValue = typeof TIMEOUTS[TimeoutType];

/**
 * Creates a timeout middleware with specified duration
 * @param timeout - Timeout duration in milliseconds
 * @returns Express middleware function
 */
export function requestTimeout(timeout: number = TIMEOUTS.DEFAULT): Middleware {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Drop the callback a previous requestTimeout() on this same request left
    // behind (the global one, when a route also declares its own). Without this
    // the 408 is written by whichever middleware ran FIRST, i.e. the one with the
    // *stale* duration. Removing only our own tracked listener leaves any
    // 'timeout' listener registered elsewhere untouched.
    const previous = activeTimeoutCallback.get(res);
    if (previous) res.removeListener('timeout', previous);

    // ONE registration, not two. `req.setTimeout` and `res.setTimeout` are both
    // `socket.setTimeout` underneath — same socket, same timer — so registering
    // both did not give two independent deadlines, it gave two callbacks for the
    // one deadline: the first answered 408 and the second immediately no-op'd on
    // `headersSent`, logging a second, misleading "Response timeout exceeded"
    // line for every timeout. `res.setTimeout` is the one that survives the
    // request→response handoff, so it is the one kept.
    const onTimeout = (): void => {
      log.warn('Request timeout exceeded', {
        method: req.method,
        url: req.url,
        timeout,
        ip: req.ip
      });

      // Headers already sent = a response is mid-flight (a file/video stream, a
      // chunked download). Leave it completely alone: it is not stuck waiting on
      // a handler, and ending it here would truncate the body the client is
      // still receiving. Log only.
      if (res.headersSent) return;

      sendError(res, 408, 'Request timeout exceeded', {
        timeout: `${timeout}ms`,
        method: req.method,
        url: req.url
      });

      // A timeout cannot abort the handler — nothing in Express can interrupt an
      // await already in flight — but it CAN stop that handler from crashing the
      // error path when it eventually finishes. Ending the response here releases
      // the socket instead of holding it open behind an overrunning request, and
      // the guard in `utils/error-response.ts#isClosed` turns the handler's
      // eventual `sendData`/`sendError` into a no-op rather than an
      // `ERR_HTTP_HEADERS_SENT` throw that its own catch re-throws into the
      // global handler as a second, phantom 500.
      //
      // Not `socket.destroy()`: the 408 just written still has to reach the client.
      if (!res.writableEnded) res.end();
    };

    activeTimeoutCallback.set(res, onTimeout);
    res.setTimeout(timeout, onTimeout);

    next();
  };
}

/**
 * Preset timeout middlewares for common use cases
 */
export const timeouts = {
  // Quick operations (10 seconds)
  short: requestTimeout(TIMEOUTS.SHORT),

  // Standard operations (30 seconds)
  default: requestTimeout(TIMEOUTS.DEFAULT),

  // Medium operations (1 minute)
  medium: requestTimeout(TIMEOUTS.MEDIUM),

  // Long operations (2 minutes)
  long: requestTimeout(TIMEOUTS.LONG),

  // WhatsApp batch send (5 minutes)
  whatsappSend: requestTimeout(TIMEOUTS.WHATSAPP_SEND),
} as const;

export default requestTimeout;
