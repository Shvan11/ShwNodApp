/**
 * Middleware Collection
 *
 * `setupMiddleware` + `errorHandler` (both defined/re-exported here) are what
 * index.ts imports; every route imports `auth.js` / `validate.js` / `timeout.js` /
 * `time-based-auth.js` DIRECTLY. The re-exports below are kept only for the
 * symbols that are actually reachable through this barrel — the type re-exports
 * (`MemoryFile`, `TimeoutType`, `RecordAgeOptions`, …) had zero importers
 * repo-wide and were removed rather than left as a second import path to keep
 * in sync.
 */
import express, { type Application } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

// Re-export authentication middleware
export {
  authenticate,
  authenticateWeb,
  authorize,
  verifyCredentials,
  hashPassword
} from './auth.js';

// Re-export timeout middleware
export {
  requestTimeout,
  timeouts,
  TIMEOUTS
} from './timeout.js';

// Re-export upload middleware
export {
  uploadSinglePdf,
  handleUploadError,
  type FileRequest
} from './upload.js';
export { default as upload } from './upload.js';

// Re-export global error handler (register LAST in index.ts)
export { errorHandler } from './error-handler.js';

// Re-export time-based auth middleware
export {
  requireRecordAge,
  isToday,
  getPatientCreationDate,
  getWorkCreationDate,
  getInvoiceCreationDate,
  getExpenseCreationDate
} from './time-based-auth.js';

/**
 * Common middleware setup
 * @param app - Express application
 */
export function setupMiddleware(app: Application): void {
  // Node sits behind Caddy on the same host (Caddy proxies both
  // local.shwan-orthodontics.com and remote.shwan-orthodontics.com, the latter
  // via Cloudflare DNS). Trusting 'loopback' lets express-rate-limit read the
  // real client IP from X-Forwarded-For while rejecting spoofed headers from
  // any non-localhost connection.
  app.set('trust proxy', 'loopback');

  // Security response headers. The app serves PHI (X-rays/photos) and is reachable
  // off-LAN via the Cloudflare tunnel, so the baseline hardening headers
  // (nosniff, frameguard, HSTS, referrer-policy, etc.) are worth having.
  //
  // Deliberately disabled for now — each has a concrete break risk in this
  // deployment, to be revisited rather than enabled blindly:
  //  - contentSecurityPolicy: GrapesJS template editor + PhotoSwipe gallery use
  //    inline styles/scripts; a default CSP would break them. Tighten incrementally.
  //  - crossOriginResourcePolicy / Embedder / Opener: the SPA is served under two
  //    origins (local.* on-LAN, remote.* via tunnel) and uses Google OAuth flows;
  //    the default same-origin cross-origin policies can block legitimate
  //    cross-origin resource loads and OAuth windows.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: false,
    })
  );

  // No CORS middleware — the SPA is served by the same Node process (production
  // via Caddy reverse proxy, dev via Vite proxy), so all API calls are
  // same-origin. The previous wildcard `Allow-Origin: *` paired with
  // `Allow-Credentials: true` was both a misconfiguration (browsers reject
  // that combination) and an attractive footgun for future cross-origin work.
  // If a real cross-origin need appears, add a narrow allowlist here.

  // Tight body cap on the unauthenticated login endpoints — credentials are a
  // few hundred bytes, so 16kb is generous. Registered BEFORE the global parser:
  // express.json() skips bodies already parsed, so this limit wins for these
  // paths and a hostile client can't push a 10mb body at an anonymous route.
  app.use('/api/auth/login', express.json({ limit: '16kb' }));
  app.use('/api/portal/login', express.json({ limit: '16kb' }));

  // Body parser middleware — 10mb is plenty for the JSON payloads this app
  // emits (templates, dental chart state, etc). File uploads go through
  // multer (multipart/form-data) and don't need this raised.
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Cookie parser — populates req.cookies, required by the CSRF double-submit
  // middleware (audit H2) to read its token cookie. No secret here: the CSRF
  // cookie is HMAC-validated by csrf-csrf, not by express signed cookies.
  app.use(cookieParser());
}
