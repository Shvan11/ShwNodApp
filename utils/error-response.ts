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
  const response: ErrorResponseBody = {
    success: false,
    error: error,
    timestamp: new Date().toISOString()
  };

  // Include details if provided
  if (details !== null && details !== undefined) {
    // If details is an Error object, extract message and stack
    if (details instanceof Error) {
      response.details = {
        message: details.message,
        ...(process.env.NODE_ENV !== 'production' && { stack: details.stack })
      };
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
 */
export function sendSuccess<T>(
  res: Response,
  data: T,
  message: string | null = null
): Response {
  const response: SuccessResponseBody<T> = {
    success: true,
    ...(message && { message }),
    ...(data !== null && data !== undefined && { data }),
    timestamp: new Date().toISOString()
  };

  return res.status(200).json(response);
}

/**
 * Common error response helpers
 */
export const ErrorResponses = {
  // 400 Bad Request
  badRequest: (res: Response, error: string, details: Record<string, unknown> | null = null) =>
    sendError(res, 400, error, details),

  missingParameter: (res: Response, paramName: string) =>
    sendError(res, 400, `Missing required parameter: ${paramName}`),

  invalidParameter: (res: Response, paramName: string, details: Record<string, unknown> | null = null) =>
    sendError(res, 400, `Invalid parameter: ${paramName}`, details),

  // 401 Unauthorized
  unauthorized: (res: Response, error: string = 'Unauthorized', details: Record<string, unknown> | null = null) =>
    sendError(res, 401, error, details),

  // 403 Forbidden
  forbidden: (res: Response, error: string = 'Forbidden', details: Record<string, unknown> | null = null) =>
    sendError(res, 403, error, details),

  // 404 Not Found
  notFound: (res: Response, resource: string = 'Resource', details: Record<string, unknown> | null = null) =>
    sendError(res, 404, `${resource} not found`, details),

  // 409 Conflict
  conflict: (res: Response, error: string, details: Record<string, unknown> | null = null) =>
    sendError(res, 409, error, details),

  // 500 Internal Server Error
  internalError: (res: Response, error: string = 'Internal server error', details: Error | Record<string, unknown> | null = null) =>
    sendError(res, 500, error, details),

  serverError: (res: Response, error: string = 'Server error', details: Error | Record<string, unknown> | null = null) =>
    sendError(res, 500, error, details),
};

export default {
  sendError,
  sendSuccess,
  ...ErrorResponses
};
