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
import type { Middleware } from '../types/index.js';

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
    // Set timeout on the request
    req.setTimeout(timeout, () => {
      // Log timeout event
      log.warn('Request timeout exceeded', {
        method: req.method,
        url: req.url,
        timeout: timeout,
        ip: req.ip
      });

      // Check if response hasn't been sent yet
      if (!res.headersSent) {
        // Send 408 Request Timeout error
        sendError(res, 408, 'Request timeout exceeded', {
          timeout: `${timeout}ms`,
          method: req.method,
          url: req.url
        });
      }
    });

    // Set timeout on the response
    res.setTimeout(timeout, () => {
      log.warn('Response timeout exceeded', {
        method: req.method,
        url: req.url,
        timeout: timeout,
        ip: req.ip
      });

      if (!res.headersSent) {
        sendError(res, 408, 'Response timeout exceeded', {
          timeout: `${timeout}ms`,
          method: req.method,
          url: req.url
        });
      }
    });

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

/**
 * Custom timeout for specific duration
 * @param ms - Timeout in milliseconds
 * @returns Timeout middleware
 */
export function customTimeout(ms: number): Middleware {
  return requestTimeout(ms);
}

export default requestTimeout;
