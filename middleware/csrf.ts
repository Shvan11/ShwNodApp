/**
 * CSRF protection (audit H2) — signed double-submit cookie via `csrf-csrf`.
 *
 * The app authenticates with a session cookie the browser auto-attaches, so a
 * cross-site form/script could otherwise forge a state-changing request. The
 * double-submit defense issues a token that is HMAC-bound to the session id,
 * stored in an httpOnly cookie AND returned in a response body; the SPA echoes
 * it in the `x-csrf-token` header on every mutation, and the server rejects any
 * mutation whose header token doesn't match the cookie + session. Safe methods
 * (GET/HEAD/OPTIONS) are never checked, so SSE streams and reads are unaffected.
 *
 * Two independent instances bind to the two sessions in this app — staff
 * (`shwan.sid`) and patient portal (`shwan.portal`) — each with its own cookie,
 * so a token minted in one context can't satisfy the other.
 *
 * Secret: reuses SESSION_SECRET (guaranteed present by the boot env schema)
 * unless a dedicated CSRF_SECRET is set. Both are stable across restarts, so an
 * already-issued token survives a server restart. Read lazily (per request) so
 * module load order vs. dotenv never matters.
 *
 * Requires `cookie-parser` (wired in setupMiddleware) to populate `req.cookies`.
 */
import { doubleCsrf, type CsrfRequestMethod } from 'csrf-csrf';
import type { ErrorRequestHandler, Request, RequestHandler, Response } from 'express';

const isProduction = process.env.NODE_ENV === 'production';

// Mirror the session cookies' flags exactly (httpOnly + lax + secure-in-prod),
// so behaviour behind the Caddy TLS-terminating proxy matches what already works
// for `shwan.sid` / `shwan.portal`.
const cookieOptions = {
  sameSite: 'lax' as const,
  secure: isProduction,
  httpOnly: true,
  path: '/',
};

// Only mutations are checked; reads (incl. SSE GETs) ride through untouched.
const ignoredMethods: CsrfRequestMethod[] = ['GET', 'HEAD', 'OPTIONS'];

function getSecret(): string {
  const secret = process.env.CSRF_SECRET || process.env.SESSION_SECRET;
  if (!secret) {
    // The boot env schema guarantees SESSION_SECRET, so this only fires on a
    // genuine misconfiguration.
    throw new Error('CSRF secret unavailable: set CSRF_SECRET or SESSION_SECRET.');
  }
  return secret;
}

function makeCsrf(cookieName: string, skipCsrfProtection: (req: Request) => boolean) {
  return doubleCsrf({
    getSecret,
    getSessionIdentifier: (req) => req.sessionID ?? '',
    getCsrfTokenFromRequest: (req) => req.headers['x-csrf-token'],
    cookieName,
    cookieOptions,
    ignoredMethods,
    size: 32,
    errorConfig: {
      statusCode: 403,
      message: 'Invalid or missing CSRF token',
      code: 'EBADCSRFTOKEN',
    },
    skipCsrfProtection,
  });
}

// Staff surface. Skipped, in order of why:
//  - `/api/auth/login` — pre-auth and regenerates the session id, so no valid
//    token can exist yet (login CSRF is low-risk; credentials are still required).
//  - `/api/chair-display/*` — fired via navigator.sendBeacon, which cannot set a
//    header; behind the auth gate and non-damaging (kiosk patient-load hints).
//  - `/api/portal*` — owned by the portal instance below (its own session/cookie).
const staff = makeCsrf('shwan.csrf', (req) => {
  const p = req.originalUrl.split('?')[0];
  return (
    p === '/api/auth/login' ||
    // 3Shape Unite posts webhook events here from the scanner workstation (no
    // session, no CSRF token); the endpoint authenticates via its own shared secret.
    p === '/api/integrations/3shape/webhook' ||
    p.startsWith('/api/chair-display/') ||
    p.startsWith('/api/portal')
  );
});

// Portal surface (separate session/cookie). Portal login is pre-auth → skipped.
const portal = makeCsrf('shwan.portal.csrf', (req) => {
  return req.originalUrl.split('?')[0] === '/api/portal/login';
});

/** Validates the `x-csrf-token` header on staff mutations. Mount on `/api`. */
export const staffCsrfProtection: RequestHandler = staff.doubleCsrfProtection;

/** Validates the `x-csrf-token` header on portal mutations. Mount on `/api/portal`. */
export const portalCsrfProtection: RequestHandler = portal.doubleCsrfProtection;

/** GET handler: mint + cookie a token for the current staff session, return it. */
export function staffCsrfTokenHandler(req: Request, res: Response): void {
  res.json({ csrfToken: staff.generateCsrfToken(req, res) });
}

/** GET handler: mint + cookie a token for the current portal session, return it. */
export function portalCsrfTokenHandler(req: Request, res: Response): void {
  res.json({ csrfToken: portal.generateCsrfToken(req, res) });
}

/**
 * Error handler for a failed CSRF check. `doubleCsrfProtection` calls
 * `next(invalidCsrfTokenError)` (an http-errors 403 carrying code
 * `EBADCSRFTOKEN`); the global errorHandler would otherwise flatten that to a
 * generic 500. Mount this BEFORE the global errorHandler. Emits the standard
 * error envelope so funneled callers read `data.error`/`data.code` — the client
 * detects `EBADCSRFTOKEN`, re-fetches a token, and retries the mutation once.
 */
export const csrfErrorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (err && (err as { code?: string }).code === 'EBADCSRFTOKEN') {
    res.status(403).json({
      success: false,
      error: 'Invalid or missing CSRF token',
      code: 'EBADCSRFTOKEN',
      timestamp: new Date().toISOString(),
    });
    return;
  }
  next(err);
};
