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

/**
 * Send a standardized error response
 * @param {Object} res - Express response object
 * @param {number} statusCode - HTTP status code (400, 401, 403, 404, 500, etc.)
 * @param {string} error - Main error message
 * @param {Object|string|null} details - Optional additional details or error object
 */
export function sendError(res, statusCode, error, details = null) {
    const response = {
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
 * @param {Object} res - Express response object
 * @param {*} data - Response data
 * @param {string} message - Optional success message
 */
export function sendSuccess(res, data, message = null) {
    const response = {
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
    badRequest: (res, error, details = null) => sendError(res, 400, error, details),
    missingParameter: (res, paramName) => sendError(res, 400, `Missing required parameter: ${paramName}`),
    invalidParameter: (res, paramName, details = null) => sendError(res, 400, `Invalid parameter: ${paramName}`, details),

    // 401 Unauthorized
    unauthorized: (res, error = 'Unauthorized', details = null) => sendError(res, 401, error, details),

    // 403 Forbidden
    forbidden: (res, error = 'Forbidden', details = null) => sendError(res, 403, error, details),

    // 404 Not Found
    notFound: (res, resource = 'Resource', details = null) => sendError(res, 404, `${resource} not found`, details),

    // 409 Conflict
    conflict: (res, error, details = null) => sendError(res, 409, error, details),

    // 500 Internal Server Error
    internalError: (res, error = 'Internal server error', details = null) => sendError(res, 500, error, details),
    serverError: (res, error = 'Server error', details = null) => sendError(res, 500, error, details),
};

export default {
    sendError,
    sendSuccess,
    ...ErrorResponses
};
