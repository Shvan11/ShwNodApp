/**
 * Standardized Error Response Utility
 *
 * Provides consistent error response formatting across all API endpoints.
 * Follows the standard format:
 * {
 *   success: false,
 *   error: 'Error message',
 *   details: { ... },      // Optional additional context
 *   timestamp: '2025-11-14T12:00:00.000Z'
 * }
 */

import type { Response } from 'express';
import { z, type ZodType } from 'zod';

/**
 * Error response structure
 */
export interface ErrorResponseBody {
  success: false;
  error: string;
  timestamp: string;
  details?: Record<string, unknown>;
}

/**
 * Success response structure
 */
export interface SuccessResponseBody<T = unknown> {
  success: true;
  message?: string;
  data?: T;
  timestamp: string;
}

/**
 * True once nothing more may be written to this response.
 *
 * The request-timeout middleware answers 408 and ends the response while the
 * handler that overran is still running; when that handler finally finishes it
 * calls one of the senders below, and `res.status().json()` on a committed
 * response throws `ERR_HTTP_HEADERS_SENT` — synchronously, inside the handler's
 * own `try`, so its `catch` then calls `ErrorResponses.internalError()` and
 * throws a SECOND time, out of the catch and into the global handler as an
 * unhandled 500 for a request the client already got a clean 408 for.
 *
 * Guarding the four senders here fixes that for every one of the ~140 call sites
 * at once: a late write is a no-op, not a crash. It is never reached on a normal
 * request — only after a timeout, an abort, or a genuine double-send.
 */
function isClosed(res: Response): boolean {
  return res.headersSent || res.writableEnded;
}

/**
 * Send a standardized error response
 * @param res - Express response object
 * @param statusCode - HTTP status code (400, 401, 403, 404, 500, etc.)
 * @param error - Main error message
 * @param details - Optional additional details or error object
 */
export function sendError(
  res: Response,
  statusCode: number,
  error: string,
  details: Error | Record<string, unknown> | string | null = null
): Response {
  if (isClosed(res)) return res; // late write after a 408/abort — see isClosed()

  const response: ErrorResponseBody = {
    success: false,
    error: error,
    timestamp: new Date().toISOString()
  };

  // Include details if provided
  if (details !== null && details !== undefined) {
    // If details is an Error object, extract message and stack.
    //
    // BOTH are dev-only. ~140 call sites pass a caught error straight through
    // (`ErrorResponses.internalError(res, 'Failed to …', error as Error)`), so
    // emitting `details.message` in production shipped the raw driver text —
    // SQLSTATE strings carrying table, column and constraint names, file paths,
    // the offending literal — to the browser. That is exactly what
    // `middleware/error-handler.ts` documents itself as preventing ("never the
    // raw Error.message, which historically leaked SQL fragments, file paths,
    // and internal state"); the two layers had opposite postures. The error is
    // still logged server-side at every call site, and the client's
    // `httpErrorMessage` reads the top-level `error` string, not this one, so
    // suppressing it costs the UI nothing.
    if (details instanceof Error) {
      response.details =
        process.env.NODE_ENV !== 'production'
          ? { message: details.message, stack: details.stack }
          : {};
    } else if (typeof details === 'string') {
      response.details = { message: details };
    } else {
      response.details = details;
    }
  }

  return res.status(statusCode).json(response);
}

/**
 * Send a standardized success response
 * @param res - Express response object
 * @param data - Response data
 * @param message - Optional success message
 * @param statusCode - HTTP status code (defaults to 200; pass 201 for resource creation)
 */
export function sendSuccess<T>(
  res: Response,
  data: T,
  message: string | null = null,
  statusCode: number = 200
): Response {
  if (isClosed(res)) return res; // late write after a 408/abort — see isClosed()

  const response: SuccessResponseBody<T> = {
    success: true,
    ...(message && { message }),
    ...(data !== null && data !== undefined && { data }),
    timestamp: new Date().toISOString()
  };

  return res.status(statusCode).json(response);
}

/**
 * Send a contract-typed success response (shared/contracts API rollout).
 *
 * Like `sendSuccess`, but the payload is pinned to a Zod response schema:
 *  - COMPILE-TIME: `data` must be `z.input<S>`, so a handler that drifts from the
 *    contract is a build error (the whole point — no more silent `undefined` in the UI).
 *  - DEV RUNTIME: `schema.parse(data)` runs only when `NODE_ENV !== 'production'`
 *    (mirrors `sendError`'s existing NODE_ENV gate) — fail-loud in dev, zero prod CPU.
 *
 * The client still re-validates via `fetchJSON({ schema })`, so the consumer's
 * final value is identical whether or not the dev-parse reshaped it.
 *
 * NOTE — `data` is typed `z.input<S>`, NOT `z.infer<S>` (= `z.output`). The handler
 * holds the PRE-serialization value, which for a `timestampString` column is a raw
 * `Date` (the `pg` parser's `timestamp` type) — the schema's INPUT, transformed to
 * the ISO `string` OUTPUT the client receives. For every schema without a transform
 * (the vast majority) `z.input === z.output`, so this is a no-op; it only matters for
 * the transform-bearing primitives, where the server legitimately passes the input.
 *
 * @param res - Express response object
 * @param schema - Zod schema describing the UNWRAPPED data payload (the inner `data`)
 * @param data - Response data (the schema's INPUT type — what the handler holds)
 * @param message - Optional success message
 * @param statusCode - HTTP status code (defaults to 200; pass 201 for resource creation)
 */
export function sendData<S extends ZodType>(
  res: Response,
  schema: S,
  data: z.input<S>,
  message: string | null = null,
  statusCode: number = 200
): Response {
  if (isClosed(res)) return res; // skip the dev-parse too — see isClosed()

  const payload = process.env.NODE_ENV !== 'production' ? schema.parse(data) : data;
  return sendSuccess(res, payload, message, statusCode);
}

/**
 * Common error response helpers.
 *
 * Every `details` parameter is `ErrorDetails` — i.e. it accepts a caught `Error`
 * as readily as a plain object. Only the two 500 helpers used to, so a handler
 * with a caught error and a 400/403/409 to send had no way to pass it: it had to
 * hand-build `{ error: err.message }`, which `sendError` does NOT dev-gate (only
 * the `instanceof Error` branch is), and that wrapper shipped the raw driver/fs
 * text to the browser in production. Passing the error itself is now always
 * available, so the safe form is also the easy one.
 */
type ErrorDetails = Error | Record<string, unknown> | null;

export const ErrorResponses = {
  // 400 Bad Request
  badRequest: (res: Response, error: string, details: ErrorDetails = null) =>
    sendError(res, 400, error, details),

  missingParameter: (res: Response, paramName: string) =>
    sendError(res, 400, `Missing required parameter: ${paramName}`),

  invalidParameter: (res: Response, paramName: string, details: ErrorDetails = null) =>
    sendError(res, 400, `Invalid parameter: ${paramName}`, details),

  // 401 Unauthorized
  unauthorized: (res: Response, error: string = 'Unauthorized', details: ErrorDetails = null) =>
    sendError(res, 401, error, details),

  // 403 Forbidden
  forbidden: (res: Response, error: string = 'Forbidden', details: ErrorDetails = null) =>
    sendError(res, 403, error, details),

  // 404 Not Found
  notFound: (res: Response, resource: string = 'Resource', details: ErrorDetails = null) =>
    sendError(res, 404, `${resource} not found`, details),

  // 409 Conflict
  conflict: (res: Response, error: string, details: ErrorDetails = null) =>
    sendError(res, 409, error, details),

  // 422 Unprocessable Entity — the request is well-formed but a required server-side
  // precondition isn't met (e.g. the 'Clinic' pseudo-doctor is missing).
  unprocessable: (res: Response, error: string, details: ErrorDetails = null) =>
    sendError(res, 422, error, details),

  // 500 Internal Server Error
  internalError: (res: Response, error: string = 'Internal server error', details: ErrorDetails = null) =>
    sendError(res, 500, error, details),

  serverError: (res: Response, error: string = 'Server error', details: ErrorDetails = null) =>
    sendError(res, 500, error, details),
};

export default {
  sendError,
  sendSuccess,
  sendData,
  ...ErrorResponses
};
