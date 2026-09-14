/**
 * Session + CSRF wiring, lifted out of `index.ts` (C3 — pure move).
 *
 * Mount order is load-bearing and unchanged: staff session (skipping portal
 * paths) → portal session → portal CSRF → staff CSRF. Call this AFTER
 * `setupMiddleware(app)` (cookie-parser must already have run, the double-submit
 * check reads `req.cookies`) and BEFORE any route is registered.
 */
import type { Express } from 'express';
import session from 'express-session';
import pgSession from 'connect-pg-simple';
import { getPgPool } from '../services/database/kysely.js';
import {
  staffCsrfProtection,
  portalCsrfProtection,
  staffCsrfTokenHandler,
  portalCsrfTokenHandler,
} from '../middleware/csrf.js';
import { log } from '../utils/logger.js';

export function configureSessions(app: Express): void {
  log.info('🔐 Setting up session management...');
  // Sessions live in PostgreSQL (connect-pg-simple) — single durable backing store,
  // sharing the existing pg pool. The legacy connect-sqlite3 store (./data/sessions.db,
  // ./data/portal-sessions.db) was retired; tables owned by migrations/pg, NOT created
  // at runtime (createTableIfMissing: false). See docs/postgres-migration-plan.md.
  const PgSessionStore = pgSession(session);
  const sessionPool = getPgPool();

  // SESSION_SECRET is required — no hardcoded fallback. A weak/known secret
  // makes session forgery trivial for anyone with source-code access.
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    throw new Error(
      'SESSION_SECRET is required. Set it in .env (recommend 32+ random bytes) before starting the server.'
    );
  }
  const portalSessionSecret = process.env.PORTAL_SESSION_SECRET || sessionSecret;

  const isProduction = process.env.NODE_ENV === 'production';
  const staffSession = session({
    store: new PgSessionStore({
      pool: sessionPool,
      tableName: 'staff_sessions',
      createTableIfMissing: false
    }),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true, // Reset expiration on every request
    cookie: {
      httpOnly: true,
      // Secure in prod (Caddy terminates HTTPS and the loopback proxy is
      // trusted, so express-session can read X-Forwarded-Proto correctly).
      // Dev (NODE_ENV !== 'production') can use plain HTTP.
      secure: isProduction,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days default
      sameSite: 'lax',
      path: '/' // Ensure cookie is sent for all paths
    },
    name: 'shwan.sid' // Custom cookie name
  });

  // Skip staff session entirely on portal paths — portalSession runs there
  // and overwriting req.session would waste a session-store read per request.
  // Segment-bounded on purpose (mirrors Express's own `app.use('/api/portal')`
  // mount semantics): a broad startsWith('/api/portal') would also swallow
  // staff routes like /api/portal-activity, which would then reach
  // authenticate() with no staff session and 401 every request.
  app.use((req, res, next) => {
    if (req.path === '/portal'
      || req.path.startsWith('/portal/')
      || req.path === '/api/portal'
      || req.path.startsWith('/api/portal/')) {
      return next();
    }
    return staffSession(req, res, next);
  });

  // Patient portal session - separate cookie and store; scoped to portal paths
  const portalSession = session({
    store: new PgSessionStore({
      pool: sessionPool,
      tableName: 'portal_sessions',
      createTableIfMissing: false
    }),
    secret: portalSessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      path: '/'
    },
    name: 'shwan.portal'
  });
  app.use('/api/portal', portalSession);
  app.use('/portal', portalSession);

  log.info('✅ Session management configured');

  // ===== CSRF protection (audit H2) — double-submit token =====
  // Checked on mutations only (GET/HEAD/OPTIONS ignored, so SSE/reads are
  // untouched). Mounted AFTER the session middleware (the token is bound to
  // req.sessionID) and BEFORE every route, so it covers the pre-auth-mounted
  // reference routes (cost-preset admin mutations) and the auth routes
  // (change-password/logout) as well as the main API. Portal first (its own
  // session + cookie); staff covers the rest of /api and skips portal paths.
  // The SPA fetches a token from the *-csrf-token endpoints and echoes it in
  // the x-csrf-token header (injected by core/http.ts). cookie-parser
  // (setupMiddleware) populates req.cookies for the double-submit check.
  log.info('🛡️  Setting up CSRF protection...');
  app.use('/api/portal', portalCsrfProtection);
  app.get('/api/portal/csrf-token', portalCsrfTokenHandler);
  app.use('/api', staffCsrfProtection);
  app.get('/api/csrf-token', staffCsrfTokenHandler);
  log.info('✅ CSRF protection configured');
}
