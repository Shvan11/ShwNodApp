// index.ts - Enhanced with resource management, health checks, and graceful shutdown

// Default to production for safety (before any other code runs)
process.env.NODE_ENV ??= 'production';

// Pin the process timezone to the clinic wall-clock before any module reads it.
// MUST stay the first import (ESM evaluates the first import before later ones).
import './config/timezone.js';

import express, { Request, Response } from 'express';
import path from 'path';
import { createServer, Server as HTTPServer } from 'http';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import config from './config/config.js';
import {
  createAppointmentsSseRouter,
  createChairDisplaySseRouter,
  teardownSseBroadcaster,
} from './services/messaging/sse-broadcaster.js';
import {
  createWhatsappSseRouter,
  teardownWhatsappSseBroadcaster,
} from './services/messaging/sse-whatsapp.js';
import { setupMiddleware, errorHandler } from './middleware/index.js';
import {
  staffCsrfProtection,
  portalCsrfProtection,
  staffCsrfTokenHandler,
  portalCsrfTokenHandler,
  csrfErrorHandler,
} from './middleware/csrf.js';
import apiRoutes from './routes/api/index.js';
import webRoutes from './routes/web.js';
import calendarRoutes from './routes/calendar.js';
import adminRoutes from './routes/admin.js';
import syncWebhookRoutes from './routes/sync-webhook.js';
import emailApiRoutes from './routes/email-api.js';
import authRoutes from './routes/auth.js';
import userManagementRoutes from './routes/user-management.js';
import costPresetRoutes from './routes/api/cost-preset.routes.js';
import lookupRoutes from './routes/api/lookup.routes.js';
import lookupAdminRoutes from './routes/api/lookup-admin.routes.js';
import holidayRoutes from './routes/api/holiday.routes.js';
import publicVideoRoutes from './routes/public/video.routes.js';
import portalRoutes from './routes/portal.js';
import whatsappService from './services/messaging/whatsapp.js';
import session from 'express-session';
import pgSession from 'connect-pg-simple';
import { getPgPool } from './services/database/kysely.js';
import driveClient from './services/google-drive/google-drive-client.js';
import messageState from './services/state/messageState.js';
import { MessageStatus } from './services/messaging/message-status.js';
import { InternalEmitterEvents } from './services/messaging/websocket-events.js';
import { EventEmitter } from 'events';

// ===== ADDED: Import new infrastructure components =====
import HealthCheck from './services/monitoring/HealthCheck.js';
import { testConnection, testConnectionWithRetry, shutdown as shutdownDatabase } from './services/database/index.js';
import { clinicRoot, workingDir } from './services/files/clinic-paths.js';
import { startCdc, stopCdc } from './services/sync/cdc/index.js';
import { teardownSupabasePools } from './services/sync/cdc/supabase-pool.js';
import { localsendService } from './services/localsend/index.js';
import ResourceManager from './services/core/ResourceManager.js';
import { log } from './utils/logger.js';
import { requestTimeout, TIMEOUTS } from './middleware/timeout.js';

// ===========================================
// TYPES
// ===========================================

/**
 * Person data for WhatsApp messaging
 */
interface MessagePerson {
  messageId: string;
  name: string;
  number: string;
  appointmentId?: number;
  error?: string;
  success?: string;
  [key: string]: unknown;
}

/**
 * WhatsApp client status
 */
interface WhatsAppStatus {
  state?: string;
  hasClient?: boolean;
}

/**
 * Database test result
 */
interface DbTestResult {
  success: boolean;
  error?: string;
}

/**
 * Application initialization result
 */
interface AppInitResult {
  wsEmitter: EventEmitter;
}

// ===========================================
// SETUP
// ===========================================

// Get current file and directory name for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables (silent mode - config is loaded by config.js)
dotenv.config({ debug: false });

// Create Express app
const app = express();
const port = config.server.port || 3000;

// Create HTTP server
const server: HTTPServer = createServer(app);
log.info('🌐 HTTP server created');

// ===========================================
// INITIALIZATION
// ===========================================

/**
 * Enhanced startup sequence with error handling
 */
async function initializeApplication(): Promise<AppInitResult> {
  try {
    log.info('🚀 Starting Shwan Orthodontics Application...');
    log.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    log.info(`Port: ${port}`);

    // ===== ADDED: Test database connectivity with retry logic =====
    log.info('📊 Testing database connectivity...');
    const dbTest = await testConnectionWithRetry() as DbTestResult;
    if (!dbTest.success) {
      log.error('❌ Database connection failed after retries:', { error: dbTest.error });
      log.info('💡 Please check your database configuration and ensure the server is running');
      log.info('🔄 Application will continue to retry database connection in background');
      // Start background retry mechanism
      startBackgroundDatabaseRetry();
    } else {
      log.info('✅ Database connection successful');
    }

    // Setup middleware
    log.info('⚙️  Setting up middleware...');
    setupMiddleware(app);

    // ===== ADDED: Session configuration for authentication =====
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
    app.use((req, res, next) => {
      if (req.path === '/portal'
        || req.path.startsWith('/portal/')
        || req.path.startsWith('/api/portal')
        || req.path.startsWith('/api/aligner-portal')) {
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

    // ===== ADDED: Request timeout configuration =====
    log.info('⏱️  Setting up request timeout middleware...');
    // Set global timeout for all requests (30 seconds default)
    app.use(requestTimeout(TIMEOUTS.DEFAULT));
    log.info(`✅ Global request timeout set to ${TIMEOUTS.DEFAULT}ms (30 seconds)`);

    log.info('📁 Setting up static file serving...');

    // NOTE: do NOT mount ./data as static — it holds runtime state/config (and formerly the
    // SQLite session DBs, now migrated to PostgreSQL). Templates under ./data/templates are read
    // via fs.readFile in the receipt service, never served over HTTP.
    app.use('/images', express.static('./public/images')); // Serve images directory for production mode

    // Set up the in-process event bus that fans real-time updates into the
    // SSE broadcasters. Replaces the legacy WebSocket server; the API is the
    // same `EventEmitter` shape so route + service emit sites are unchanged.
    log.info('📡 Setting up real-time event bus...');
    const wsEmitter = new EventEmitter();

    // Inject the emitter into API routes that fan out (appointments, chair-display).
    const { setWebSocketEmitter } = await import('./routes/api/index.js');
    setWebSocketEmitter(wsEmitter);

    // chair-display SSE is the only public SSE route — kiosk has no session
    // and matches the legacy WS posture. Appointments + WhatsApp SSE mount
    // after the auth gate below.
    log.info('📡 Setting up SSE broadcasters...');
    app.use('/sse', createChairDisplaySseRouter(wsEmitter));

    // Use routes
    log.info('🛣️  Setting up routes...');

    // ===== AUTHENTICATION MIDDLEWARE (MUST BE BEFORE ROUTES) =====
    // Public routes - NO authentication required
    app.use('/api/auth', authRoutes);
    // Reference-data routes mounted BEFORE the auth gate so their GETs are public.
    // costPresetRoutes' mutations (POST/PUT/DELETE) self-guard with inline
    // authenticate/authorize(['admin']); lookupRoutes is read-only. These are the
    // only mount points — the post-gate router (routes/api/index.ts) does not remount them.
    app.use('/api', costPresetRoutes);
    app.use('/api', lookupRoutes);
    app.use('/v', publicVideoRoutes); // Public video sharing (no auth - educational content)
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
        if (err) res.sendFile(srcPath);
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
      const { authenticate, authenticateWeb } = await import('./middleware/auth.js');

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
            }
        }
    }));
    app.use('/clinic-assets', express.static(clinicRoot()));

    // Appointments + WhatsApp SSE — mounted under /api so they inherit the
    // auth gate above. Chair-display SSE is the only public SSE route (kiosk
    // has no session and matches the legacy WS posture).
    app.use('/api/sse', createAppointmentsSseRouter(wsEmitter));
    app.use('/api/sse', createWhatsappSseRouter(wsEmitter));

    app.use('/api', apiRoutes);
    app.use('/api/calendar', calendarRoutes);
    app.use('/api/email', emailApiRoutes);
    app.use('/api/users', userManagementRoutes); // User management (admin only)
    app.use('/api/admin', lookupAdminRoutes); // Lookup table admin routes
    app.use('/api/holidays', holidayRoutes); // Holiday management routes
    app.use('/', syncWebhookRoutes);
    app.use('/', adminRoutes);

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

    // ===== ADDED: Initialize health monitoring =====
    log.info('🏥 Starting health monitoring...');
    HealthCheck.start();

    // Initialize Google Drive client
    log.info('📁 Initializing Google Drive client...');
    const driveInitialized = driveClient.initialize();
    if (driveInitialized) {
      log.info('✅ Google Drive client initialized successfully');
    } else {
      log.info('⚠️  Google Drive not configured. PDF upload will be disabled.');
      log.info('💡 To enable PDF uploads, configure Google Drive credentials in .env');
    }

    // Connect WhatsApp service to WebSocket emitter
    log.debug('About to connect WhatsApp service...');
    log.info('Connecting WhatsApp service...');
    whatsappService.setEmitter(wsEmitter);
    log.debug('WhatsApp service connected');

    // Set up comprehensive WhatsApp event handlers
    whatsappService.on('MessageSent', async (person: MessagePerson) => {
        log.info("MessageSent event fired:", { person });
        try {
            await messageState.addPerson(person);

            if (wsEmitter) {
                wsEmitter.emit(InternalEmitterEvents.WHATSAPP_MESSAGE_STATUS, {
                    messageId: person.messageId,
                    status: MessageStatus.SERVER,
                    patientName: person.name,
                    phone: person.number,
                    timeSent: new Date().toISOString(),
                    message: '',
                    appointmentId: person.appointmentId
                });

                const stats = messageState.dump();
                wsEmitter.emit(InternalEmitterEvents.WHATSAPP_SENDING_PROGRESS, {
                    sent: stats.sentMessages,
                    failed: stats.failedMessages,
                    finished: stats.finishedSending
                });
            }

            log.info("MessageSent processed successfully");
        } catch (error) {
            log.error("Error handling MessageSent event:", { error });
        }
    });

    whatsappService.on('MessageFailed', async (person: MessagePerson) => {
        log.info("MessageFailed event fired:", { person });
        try {
            person.success = '&times;';
            await messageState.addPerson(person);

            if (wsEmitter) {
                wsEmitter.emit(InternalEmitterEvents.WHATSAPP_MESSAGE_STATUS, {
                    messageId: person.messageId || `failed_${Date.now()}`,
                    status: MessageStatus.ERROR,
                    patientName: person.name,
                    phone: person.number,
                    timeSent: null,
                    message: '',
                    error: person.error,
                    appointmentId: person.appointmentId
                });

                const stats = messageState.dump();
                wsEmitter.emit(InternalEmitterEvents.WHATSAPP_SENDING_PROGRESS, {
                    sent: stats.sentMessages,
                    failed: stats.failedMessages,
                    finished: stats.finishedSending
                });
            }

            log.info("MessageFailed processed successfully");
        } catch (error) {
            log.error("Error handling MessageFailed event:", { error });
        }
    });

    whatsappService.on('finishedSending', async () => {
        log.info("finishedSending event fired");
        try {
            await messageState.setFinishedSending(true);

            if (wsEmitter) {
                const stats = messageState.dump();
                wsEmitter.emit(InternalEmitterEvents.WHATSAPP_SENDING_FINISHED, {
                    finished: true,
                    sent: stats.sentMessages,
                    failed: stats.failedMessages,
                    total: stats.sentMessages + stats.failedMessages
                });
            }
        } catch (error) {
            log.error("Error handling finishedSending event:", { error });
        }
    });

    whatsappService.on('ClientIsReady', async () => {
        log.info("ClientIsReady event fired");
        try {
            await messageState.setClientReady(true);

            if (wsEmitter) {
                wsEmitter.emit(InternalEmitterEvents.WHATSAPP_CLIENT_READY, { clientReady: true });
            }

            log.info("✅ WhatsApp client is ready and state updated");
        } catch (error) {
            log.error("❌ Error updating WhatsApp client ready state:", { error });
        }
    });

    whatsappService.on('qr', async (qr: string) => {
        log.info("QR event fired");
        try {
            await messageState.setQR(qr);

            // Only broadcast if there are active viewers
            if (messageState.activeQRViewers > 0 && wsEmitter) {
                wsEmitter.emit(InternalEmitterEvents.WHATSAPP_QR_UPDATED, {
                    qr,
                    clientReady: false
                });
            }
        } catch (error) {
            log.error("Error handling QR event:", { error });
        }
    });

    // ===== Enhanced error handling =====
    // An uncaught *exception* can leave the process in an unknown/corrupted
    // state, so we still tear down cleanly. (Node's own default would crash
    // anyway — gracefulShutdown just lets long-lived services close first.)
    process.on('uncaughtException', (error: Error) => {
      log.error('💥 Uncaught Exception:', { error: error.message, stack: error.stack });
      gracefulShutdown('uncaughtException');
    });

    // An unhandled *rejection* must NOT bring down the production server. These
    // almost always originate in a peripheral, self-healing subsystem (e.g. the
    // WhatsApp client's init timeout / reconnect loop) that has its own retry
    // and circuit-breaker logic — killing the whole clinic app over one is a
    // far worse outcome than the stray rejection itself. Log it loudly and keep
    // serving; the owning subsystem recovers on its own.
    process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
      log.error('💥 Unhandled Rejection (ignored — server stays up):', {
        promise: String(promise),
        reason: reason instanceof Error ? reason.stack ?? reason.message : String(reason),
      });
    });

    // Start server
    log.debug('About to start HTTP server...');
    log.info('About to start HTTP server...');
    await startServer();
    log.debug('startServer() completed');

    // ===== ADDED: Automatic WhatsApp client initialization =====
    await initializeWhatsAppOnStartup();

    log.info('🎉 Application started successfully!');
    log.info(`🌐 Server running at http://localhost:${port}`);
    log.info(`🔒 HTTPS available via Caddy at https://local.shwan-orthodontics.com`);
    log.info(`📊 Health check available at http://localhost:${port}/api/health`);

    return { wsEmitter };

  } catch (error) {
    log.error('💥 Failed to initialize application:', { error: (error as Error).message });
    log.info('🔄 Attempting graceful shutdown...');
    await gracefulShutdown('initialization-error');
    process.exit(1);
  }
}

// ===========================================
// SERVER STARTUP
// ===========================================

/**
 * Promisified server startup
 */
function startServer(): Promise<HTTPServer> {
  return new Promise((resolve, reject) => {
    const serverInstance = server.listen(port, () => {
      log.debug('server.listen callback fired');
      log.info(`Server listening on port: ${port}`);

      // Unified CDC forward sync (one change feed → the single Supabase mirror). Self-gates per
      // sink: FAILOVER_SYNC_ENABLED → raw mirror, DOLPHIN_SYNC_ENABLED → Dolphin SQL Server.
      startCdc();

      // LocalSend LAN file-sharing sender (off unless LOCALSEND_ENABLED=true).
      if (config.localsend.enabled) {
        try {
          localsendService.start();
        } catch (error) {
          log.warn('⚠️  LocalSend failed to start:', { error: (error as Error).message });
        }
      }

      resolve(serverInstance);
    });

    // Handle server errors
    serverInstance.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        log.error(`❌ Port ${port} is already in use`);
        log.info('💡 Please check if another instance is running or use a different port');
      } else {
        log.error('❌ Server error:', { error: error.message });
      }
      reject(error);
    });
  });
}

// ===========================================
// GRACEFUL SHUTDOWN
// ===========================================

/**
 * Comprehensive graceful shutdown
 */
let shuttingDown = false;
async function gracefulShutdown(signal: string): Promise<void> {
  // Re-entrancy guard: a second signal (double Ctrl-C, or SIGTERM arriving during
  // an uncaughtException-triggered shutdown) must not re-run the whole teardown
  // and race two process.exit() calls against already-closing resources.
  if (shuttingDown) {
    log.warn(`Shutdown already in progress; ignoring ${signal}`);
    return;
  }
  shuttingDown = true;

  log.info(`\n🛑 Graceful shutdown initiated by ${signal}`);

  // Overall watchdog: if any teardown step hangs (Puppeteer/WhatsApp teardown is
  // the classic offender), force-exit so the process can never wedge forever
  // waiting on a stuck resource. unref() so it doesn't itself keep us alive.
  const watchdog = setTimeout(() => {
    log.error('⏱️  Graceful shutdown timed out after 15 s; forcing exit');
    process.exit(1);
  }, 15000);
  watchdog.unref();

  try {
    // End long-lived SSE streams FIRST. They set req/res.setTimeout(0), so they
    // never self-terminate — leaving them open makes server.close() block until
    // the 5 s forceExit fires on every shutdown that has a kiosk/appointments/
    // WhatsApp viewer connected. Tearing them down here lets server.close()
    // resolve as soon as genuine in-flight requests drain. (Teardown is
    // idempotent; the post-DB cleanup below no longer needs to repeat it.)
    log.info('📡 Stopping SSE broadcasters...');
    teardownSseBroadcaster();
    teardownWhatsappSseBroadcaster();

    // Stop accepting new connections; wait up to 5 s for in-flight requests.
    if (server) {
      log.info('🔌 Closing HTTP server...');
      await new Promise<void>((resolve) => {
        const forceExit = setTimeout(() => {
          log.warn('⚠️  HTTP server did not close within 5 s; proceeding with shutdown');
          resolve();
        }, 5000);
        server!.close(() => {
          clearTimeout(forceExit);
          log.info('✅ HTTP server closed');
          resolve();
        });
      });
    }

    // Stop health monitoring
    log.info('🏥 Stopping health monitoring...');
    HealthCheck.stop();

    // Stop the unified CDC sync (all sinks — forward, dolphin, reverse; turns capture OFF).
    try {
      log.info('🛑 Stopping CDC sync...');
      await stopCdc();
    } catch (error) {
      log.warn('⚠️  CDC shutdown error:', { error: (error as Error).message });
    }

    // End the SHARED Supabase pools AFTER every sink has closed — a single sink.close() must never
    // end() a shared pool (the other sink may still be draining). Idempotent no-op if neither the
    // failover nor reverse sink ever opened one.
    try {
      await teardownSupabasePools();
    } catch (error) {
      log.warn('⚠️  Supabase pool teardown error:', { error: (error as Error).message });
    }

    // Stop the LocalSend sender (closes the UDP socket + clears transfers).
    try {
      log.info('📤 Stopping LocalSend...');
      await localsendService.gracefulShutdown();
    } catch (error) {
      log.warn('⚠️  LocalSend shutdown error:', { error: (error as Error).message });
    }

    // Clean up WhatsApp service
    if (whatsappService) {
      log.info('💬 Shutting down WhatsApp service...');
      await whatsappService.gracefulShutdown();
    }

    // Clean up message state
    if (messageState) {
      log.info('📊 Cleaning up message state...');
      await messageState.cleanup();
    }

    // (SSE broadcasters already torn down before server.close() above.)

    // Close database connections
    log.info('🗄️  Closing database connections...');
    await shutdownDatabase();

    // Run remaining cleanup tasks registered with ResourceManager
    // (HealthCheck, db-pool, archform-db register themselves). These are
    // idempotent so duplicate teardown with the direct calls above is safe.
    log.info('🧹 Final resource cleanup...');
    await ResourceManager.gracefulShutdown(signal);

    log.info('✅ Graceful shutdown completed successfully');
    clearTimeout(watchdog);
    process.exit(0);

  } catch (error) {
    log.error('❌ Error during graceful shutdown:', { error: (error as Error).message });
    clearTimeout(watchdog);
    process.exit(1);
  }
}

// ===========================================
// SIGNAL HANDLERS
// ===========================================

// Handle termination signals
process.on('SIGTERM', () => {
  log.info('\n📡 Received SIGTERM signal');
  gracefulShutdown('SIGTERM');
});

process.on('SIGINT', () => {
  log.info('\n📡 Received SIGINT signal (Ctrl+C)');
  gracefulShutdown('SIGINT');
});

// Handle Windows specific signals
if (process.platform === 'win32') {
  process.on('SIGHUP', () => {
    log.info('\n📡 Received SIGHUP signal');
    gracefulShutdown('SIGHUP');
  });
}

// ===========================================
// HEALTH ENDPOINT
// ===========================================

/**
 * Application health endpoint for monitoring
 */
app.get('/health/basic', (_req: Request, res: Response) => {
  const uptime = process.uptime();
  const memoryUsage = process.memoryUsage();

  res.json({
    status: 'healthy',
    uptime: Math.floor(uptime),
    memory: {
      used: Math.round(memoryUsage.heapUsed / 1024 / 1024),
      total: Math.round(memoryUsage.heapTotal / 1024 / 1024)
    },
    timestamp: Date.now(),
    version: process.version,
    environment: process.env.NODE_ENV || 'development'
  });
});

// ===========================================
// WHATSAPP INITIALIZATION
// ===========================================

/**
 * Initialize WhatsApp client automatically on startup
 * Can be controlled via WHATSAPP_AUTO_INIT environment variable
 */
async function initializeWhatsAppOnStartup(): Promise<void> {
  // Check if auto-initialization is enabled (default: true)
  const autoInit = process.env.WHATSAPP_AUTO_INIT !== 'false';

  if (!autoInit) {
    log.info('📱 WhatsApp auto-initialization disabled via WHATSAPP_AUTO_INIT=false');
    return;
  }

  log.info('📱 Starting automatic WhatsApp client initialization...');

  try {
    // Add a small delay to ensure all services are ready
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check if WhatsApp service is ready
    if (!whatsappService) {
      log.info('⚠️  WhatsApp service not available, skipping auto-initialization');
      return;
    }

    // Check current state
    const currentState: WhatsAppStatus = whatsappService.getStatus();
    log.info(`📱 Current WhatsApp state: ${currentState.state || 'unknown'}`);

    // Only initialize if client is disconnected
    if (currentState.state === 'DISCONNECTED' || currentState.state === 'ERROR') {
      // Check for existing session first
      const hasExistingSession = await whatsappService.checkExistingSession();

      if (hasExistingSession) {
        log.info('📱 Found existing session - initializing WhatsApp client...');
      } else {
        log.info('📱 No existing session - initializing WhatsApp client (will require QR scan)...');
      }

      // Initialize with a timeout
      const initPromise = whatsappService.initialize();
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Initialization timeout')), 60000)
      );

      await Promise.race([initPromise, timeoutPromise]);

      if (hasExistingSession) {
        log.info('✅ WhatsApp client initialization completed - session should be restored');
      } else {
        log.info('✅ WhatsApp client initialization started - waiting for QR scan');
      }

    } else if (currentState.state === 'CONNECTED') {
      log.info('✅ WhatsApp client already connected');
    } else if (currentState.state === 'INITIALIZING') {
      log.info('📱 WhatsApp client already initializing');
    } else {
      log.info(`📱 WhatsApp client in state: ${currentState.state}, skipping initialization`);
    }

  } catch (error) {
    // Don't fail the entire application if WhatsApp initialization fails
    log.warn('⚠️  WhatsApp auto-initialization failed (application will continue):', { error: (error as Error).message });
    log.info('💡 WhatsApp can be initialized manually later via the web interface');
  }
}

// ===========================================
// DATABASE RETRY
// ===========================================

/**
 * Simple background database retry mechanism
 */
function startBackgroundDatabaseRetry(): void {
  const retryInterval = setInterval(async () => {
    try {
      const dbTest = await testConnection() as DbTestResult;
      if (dbTest.success) {
        log.info('✅ Database connection restored!');
        clearInterval(retryInterval);
      }
    } catch {
      // Silent retry - only log success
    }
  }, 60000); // Check every 60 seconds
}

// ===========================================
// APPLICATION START
// ===========================================

// Start the application
const { wsEmitter } = await initializeApplication();

// Log application readiness
log.info('🎯 Application initialization complete - ready to serve requests');
log.info(`📋 Available endpoints:
  • Main Application: http://localhost:${port} (via Caddy: https://local.shwan-orthodontics.com)
  • API Health Check: http://localhost:${port}/api/health
  • Basic Health: http://localhost:${port}/health/basic
  • WhatsApp Status: http://localhost:${port}/api/wa/status
`);

// Optional performance monitoring in development
if (process.env.NODE_ENV === 'development') {
  // Log memory usage every 30 seconds in development
  setInterval(() => {
    const usage = process.memoryUsage();
    const uptime = process.uptime();
    log.info(`📊 Performance: Memory ${Math.round(usage.heapUsed / 1024 / 1024)}MB, Uptime ${Math.floor(uptime)}s`);
  }, 30000);
}

// ===========================================
// EXPORTS
// ===========================================

export { wsEmitter, gracefulShutdown };
