/**
 * The app's whole route table, lifted out of `index.ts` (C3 — pure move).
 *
 * Registration order IS the routing contract in Express, so this file is the one
 * place that decides what is public, where the auth gate sits, and which router
 * wins a path collision. Nothing here may be reordered casually — the inline
 * comments record why each mount sits where it does.
 *
 * Call AFTER `configureSessions(app)` and the request-timeout/static middleware,
 * and BEFORE any post-route boot work: the last two mounts are the CSRF and
 * global error handlers, which must stay last.
 */
import express, { type Express, type Request, type Response } from 'express';
import path from 'path';
import type { EventEmitter } from 'events';
import {
  createAppointmentsSseRouter,
  createChairDisplaySseRouter,
} from '../services/messaging/sse-broadcaster.js';
import { createWhatsappSseRouter } from '../services/messaging/sse-whatsapp.js';
import { errorHandler } from '../middleware/index.js';
import { csrfErrorHandler } from '../middleware/csrf.js';
import apiRoutes, { setWebSocketEmitter } from '../routes/api/index.js';
import webRoutes from '../routes/web.js';
import calendarRoutes from '../routes/api/calendar.routes.js';
import adminRoutes from '../routes/admin.js';
import syncWebhookRoutes from '../routes/sync-webhook.js';
import emailApiRoutes from '../routes/api/email.routes.js';
import authRoutes from '../routes/auth.js';
import threeshapeWebhookRoutes from '../routes/api/threeshape-webhook.routes.js';
import userManagementRoutes from '../routes/api/user-management.routes.js';
import costPresetRoutes from '../routes/api/cost-preset.routes.js';
import lookupRoutes from '../routes/api/lookup.routes.js';
import lookupAdminRoutes from '../routes/api/lookup-admin.routes.js';
import publicVideoRoutes from '../routes/public/video.routes.js';
import tvDisplayRoutes from '../routes/public/tv-display.routes.js';
import portalRoutes from '../routes/portal.js';
import { clinicRoot, workingDir } from '../services/files/clinic-paths.js';
import { log } from '../utils/logger.js';

/**
 * Register every route, static mount and error handler on `app`.
 *
 * `wsEmitter` is the in-process event bus the SSE broadcasters and the
 * fan-out API routes share.
 */
export async function mountRoutes(app: Express, wsEmitter: EventEmitter): Promise<void> {
  // Inject the emitter into API routes that fan out (appointments, chair-display).
  setWebSocketEmitter(wsEmitter);

  // Use routes
  log.info('🛣️  Setting up routes...');

  // ===== AUTHENTICATION MIDDLEWARE (MUST BE BEFORE ROUTES) =====
  // Public routes - NO authentication required

  // Liveness probe. Deliberately public — a monitor has no session — but it is
  // registered HERE, inside mountRoutes, rather than at index.ts module body
  // as it used to be: Express matches in registration order, so from the module
  // body it preceded setupMiddleware and was the one route in the app served
  // with no helmet headers and no request timeout. It also no longer reports
  // `process.version` or `NODE_ENV`; an unauthenticated caller does not need the
  // server's Node build to look up against, and `/api/health/detailed` (admin,
  // post-gate) is where real diagnostics live.
  app.get('/health/basic', (_req: Request, res: Response) => {
    const memoryUsage = process.memoryUsage();
    res.json({
      status: 'healthy',
      uptime: Math.floor(process.uptime()),
      memory: {
        used: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        total: Math.round(memoryUsage.heapTotal / 1024 / 1024)
      },
      timestamp: Date.now()
    });
  });

  app.use('/api/auth', authRoutes);
  // 3Shape Unite webhook receiver — pre-gate (the scanner workstation has no
  // session) + CSRF-exempt (middleware/csrf.ts); authenticated by a shared secret.
  app.use(threeshapeWebhookRoutes);
  // (Reference-data routes — cost presets + lookups — moved BEHIND the auth gate;
  // they mount with the other /api routers below.)
  app.use('/v', publicVideoRoutes); // Public video sharing (no auth - educational content)
  // Waiting-room TV signage slideshow (no auth - the TV browser has no session;
  // serves only signage content dropped into the tv-media folder, never PHI).
  // Self-contained feature: see routes/public/tv-display.routes.ts. Remove by
  // deleting that file + this mount.
  app.use('/tv-display', tvDisplayRoutes);
  app.use('/api/portal', portalRoutes); // Patient portal (own session, own auth)

  // Serve login page BEFORE auth check (public access)
  app.get('/login.html', (_req: Request, res: Response) => {
    res.sendFile(path.join(process.cwd(), './public/login.html'));
  });

  // Patient portal SPA shell (public; portal handles its own auth)
  app.get(['/portal', '/portal/*splat'], (_req: Request, res: Response) => {
    // In production the built bundle is at dist/portal.html; in dev Vite
    // serves it directly and this route isn't hit (vite proxy handles /api).
    const builtPath = path.join(process.cwd(), './dist/portal.html');
    const srcPath = path.join(process.cwd(), './public/portal.html');
    res.sendFile(builtPath, (err) => {
      if (!err) return;
      // Only fall back while the response is still uncommitted. `sendFile`'s
      // callback also fires for an error raised MID-STREAM (or a client abort),
      // and a second sendFile on a committed response throws ERR_HTTP_HEADERS_SENT.
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.sendFile(srcPath, (fallbackErr) => {
        if (fallbackErr && !res.headersSent) res.status(404).end();
      });
    });
  });

  // Default-on: auth is enabled unless AUTHENTICATION_ENABLED is the literal
  // string 'false'. In production, refuse to boot on any other ambiguous
  // value to catch env typos that would otherwise silently expose the app.
  const authEnv = process.env.AUTHENTICATION_ENABLED;
  let authenticationEnabled: boolean;
  if (authEnv === undefined || authEnv === 'true') {
    authenticationEnabled = true;
  } else if (authEnv === 'false') {
    authenticationEnabled = false;
  } else if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `AUTHENTICATION_ENABLED must be 'true' or 'false', got: ${JSON.stringify(authEnv)}. ` +
      `Refusing to start in production with ambiguous auth config.`
    );
  } else {
    log.warn(`⚠️  AUTHENTICATION_ENABLED=${authEnv} — treating as enabled. Use 'false' to disable.`);
    authenticationEnabled = true;
  }

  if (authenticationEnabled) {
    log.info('🔐 Authentication ENABLED - Protecting routes');
    const { authenticate, authenticateWeb } = await import('../middleware/auth.js');

    // Protect API routes (returns 401 JSON)
    app.use('/api', authenticate);

    // Protect web routes (redirects to /login.html)
    app.use('/', authenticateWeb);
  } else {
    log.warn('⚠️  ⚠️  ⚠️  Authentication DISABLED - All routes are public ⚠️  ⚠️  ⚠️');
    log.warn('   This should ONLY happen in local development. Never deploy this way.');
  }

  // ===== MOUNT ROUTES (AFTER AUTHENTICATION) =====
  // PHI imaging static mounts — require auth (patient X-rays / clinic photos)
  app.use('/DolImgs', express.static(workingDir(), {
      setHeaders: (res, filePath) => {
          if (/\.i\d+$/i.test(filePath)) {
              res.setHeader('Content-Type', 'image/jpeg');
              // The gallery always requests these with a `?v={mtime}` token, so a
              // given URL is immutable (a re-render changes the mtime → a new URL).
              // Cache hard to kill the per-image revalidation round-trip on every
              // revisit. `private` keeps this PHI out of shared/CDN caches (the
              // off-LAN cloudflared edge) — auth lives at our origin.
              res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
          }
      }
  }));
  app.use('/clinic-assets', express.static(clinicRoot()));

  // All SSE — mounted under /api so they inherit the auth gate above, and a
  // dropped session closes the stream with a 401 instead of a login redirect.
  app.use('/api/sse', createAppointmentsSseRouter(wsEmitter));
  app.use('/api/sse', createWhatsappSseRouter(wsEmitter));
  app.use('/api/sse', createChairDisplaySseRouter(wsEmitter));

  // Reference data (cost presets + lookups). Mounted BEFORE apiRoutes to keep the
  // precedence they had when they were pre-gate, so path resolution is unchanged;
  // the only difference is that they now require a staff session. They were public
  // for no reason — the portal, the chair kiosk, the TV signage and login.html
  // never read them. cost-preset's mutations keep their own inline
  // authenticate/authorize(ADMIN_ROLES): redundant now, but they state the tier.
  app.use('/api', costPresetRoutes);
  app.use('/api', lookupRoutes);

  app.use('/api', apiRoutes);
  app.use('/api/calendar', calendarRoutes);
  app.use('/api/email', emailApiRoutes);
  app.use('/api/users', userManagementRoutes); // User management (admin only)
  // Both /api/admin routers carry their OWN gate (lookup-admin: FINANCE_ROLES,
  // admin: ADMIN_ROLES) and claim disjoint sub-paths, so registration order
  // between them is not load-bearing. Keep it that way: a router mounted here
  // that relies on a sibling's gate is the F6.7 bug.
  app.use('/api/admin', lookupAdminRoutes); // Lookup table admin routes
  app.use('/api/admin', adminRoutes);       // Google Drive/Contacts OAuth redirects
  // NB: no /api/holidays mount here — holidayRoutes is registered by the API
  // aggregator (routes/api/index.ts), which mounts first and therefore always
  // won. A second mount at the same path was dead weight.
  app.use('/api/sync', syncWebhookRoutes);

  // Serve built SPA files (AFTER auth check, so protected)
  app.use(express.static('./dist'));

  // Final catch-all for SPA routing
  app.use('/', webRoutes);

  // CSRF failure → conformant 403 envelope (audit H2). Must precede the global
  // handler, which would otherwise flatten the http-errors 403 to a 500.
  app.use(csrfErrorHandler);

  // Global error handler — must be LAST (after every route mount). Catches
  // anything that propagates out of a route via next(err) or an unhandled
  // throw inside an async handler that Express turns into next(err).
  app.use(errorHandler);
}
