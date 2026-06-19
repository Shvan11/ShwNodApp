/**
 * Typed error for the 3Shape integration.
 *
 * `code` lets route handlers map to a friendly message / HTTP status without
 * string-matching; `status` carries the upstream HTTP status when one is relevant.
 * Codes: not_configured | not_connected | reconnect_required | invalid_grant |
 * unreachable | api_error | http_<n>.
 */
export class ThreeShapeError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = 'ThreeShapeError';
    this.code = code;
    this.status = status;
  }
}
