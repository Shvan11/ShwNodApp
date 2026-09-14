// index.ts — application entry point: boot sequence, HTTP server, shutdown wiring.
//
// The bulky pieces live next door in `app/` (C3): `app/sessions.ts` (session +
// CSRF), `app/mount-routes.ts` (the whole route table — registration order IS
// the routing contract), `app/whatsapp-events.ts` (service ↔ event-bus wiring +
// startup auto-init) and `app/shutdown.ts` (graceful teardown + process
// handlers). What stays here is the ORDER those pieces run in.

// Process-level env defaults (NODE_ENV, TZ). MUST stay the first import: ESM
// evaluates every import before any statement in this module's body, so setting
// them here in the body would be too late for csrf.ts / logger.ts / config.ts.
import './config/process-env.js';

import express from 'express';
import { createServer, Server as HTTPServer } from 'http';
import { EventEmitter } from 'events';
import config from './config/config.js';
import { setupMiddleware } from './middleware/index.js';
import { requestTimeout, TIMEOUTS } from './middleware/timeout.js';
import { configureSessions } from './app/sessions.js';
import { mountRoutes } from './app/mount-routes.js';
import { wireWhatsappEvents, initializeWhatsAppOnStartup } from './app/whatsapp-events.js';
import {
  gracefulShutdown,
  setShutdownServer,
  installSignalHandlers,
  installCrashHandlers,
} from './app/shutdown.js';
import driveClient from './services/google-drive/google-drive-client.js';
import {
  isDoctorEmailListSyncEnabled,
  scheduleDoctorEmailListSync,
} from './services/cloudflare/doctor-email-list.js';
import HealthCheck from './services/monitoring/HealthCheck.js';
import { testConnection, testConnectionWithRetry } from './services/database/index.js';
import { assertRoleConstraintMatchesRegistry } from './services/database/role-constraint-check.js';
import { startCdc } from './services/sync/cdc/index.js';
import { localsendService } from './services/localsend/index.js';
import ResourceManager from './utils/resource-manager.js';
import { log } from './utils/logger.js';

// ===========================================
// TYPES
// ===========================================

/**
 * Application initialization result
 */
interface AppInitResult {
  wsEmitter: EventEmitter;
}

// ===========================================
// SETUP
// ===========================================

// Create Express app
const app = express();
const port = config.server.port || 3000;

// Create HTTP server
const server: HTTPServer = createServer(app);
setShutdownServer(server);
log.info('🌐 HTTP server created');

// Termination signals are handled from here on, so a Ctrl-C during the boot
// sequence below still runs the graceful teardown instead of hard-killing.
installSignalHandlers();

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
    const dbTest = await testConnectionWithRetry();
    if (!dbTest.success) {
      log.error('❌ Database connection failed after retries:', { error: dbTest.error });
      log.info('💡 Please check your database configuration and ensure the server is running');
      log.info('🔄 Application will continue to retry database connection in background');
      // Start background retry mechanism
      startBackgroundDatabaseRetry();
    } else {
      log.info('✅ Database connection successful');
      // Drift guard: the role allowed-set lives in three places (DB CHECK,
      // contract enum, shared registry) with no FK linking them. Verify the
      // live CHECK still matches ALL_ROLES; logs loudly on drift, never blocks boot.
      await assertRoleConstraintMatchesRegistry();
    }

    // Setup middleware
    log.info('⚙️  Setting up middleware...');
    setupMiddleware(app);

    // Sessions (staff + portal) and CSRF — see app/sessions.ts.
    configureSessions(app);

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

    // Every route, static mount and error handler — see app/mount-routes.ts.
    // All three SSE routers mount there, AFTER the auth gate. Chair-display used
    // to be mounted here, public, on the premise that "the kiosk has no session";
    // it does have one (the kiosk runs the staff SPA at /chair-display, whose
    // shell is served by routes/web.ts behind authenticateWeb — its /DolImgs
    // images only render because the session cookie is sent). The stream carries
    // patient name + intraoral images + visit summary, and `chairId` is 1-10, so a
    // public mount published PHI to anyone who could reach the server — including
    // through the cloudflared tunnel, which forwards every path to :3000.
    await mountRoutes(app, wsEmitter);

    // ===== ADDED: Initialize health monitoring =====
    log.info('🏥 Starting health monitoring...');
    HealthCheck.start();

    // Initialize Google Drive client
    log.info('📁 Initializing Google Drive client...');
    const driveInitialized = driveClient.initialize();
    if (driveInitialized) {
      log.info('✅ Google Drive client initialized successfully');
      // A DB-stored refresh token (connected via Settings → Integrations) takes
      // precedence over the env-configured one — apply it before any upload runs.
      const usedStoredCredentials = await driveClient.loadStoredCredentials();
      if (usedStoredCredentials) {
        log.info('📁 Using Google Drive credentials from Settings → Integrations');
      }
    } else {
      log.info('⚠️  Google Drive not configured. PDF upload will be disabled.');
      log.info('💡 To enable PDF uploads, configure Google Drive credentials in .env');
    }

    // Cloudflare Zero Trust: reconcile the aligner-portal Access email list with
    // aligner_doctors at boot — heals any sync missed while Cloudflare was
    // unreachable during a doctor edit. Fire-and-forget; never blocks startup.
    if (isDoctorEmailListSyncEnabled()) {
      log.info('☁️  Cloudflare doctor email-list sync enabled — reconciling at boot');
      scheduleDoctorEmailListSync('boot reconcile');
    }

    // WhatsApp service → event bus → SSE (see app/whatsapp-events.ts).
    wireWhatsappEvents(wsEmitter);

    // uncaughtException / unhandledRejection (see app/shutdown.ts).
    installCrashHandlers();

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
// DATABASE RETRY
// ===========================================

/**
 * Simple background database retry mechanism.
 *
 * Registered with ResourceManager and `unref`-ed: the timer must not be the
 * reason the process stays alive, and a shutdown that runs before the DB comes
 * back has to clear it rather than rely on `process.exit` to take it down.
 */
function startBackgroundDatabaseRetry(): void {
  const retryInterval = setInterval(async () => {
    try {
      const dbTest = await testConnection();
      if (dbTest.success) {
        log.info('✅ Database connection restored!');
        clearInterval(retryInterval);
        ResourceManager.unregister('db-retry-interval');
      }
    } catch {
      // Silent retry - only log success
    }
  }, 60000); // Check every 60 seconds
  retryInterval.unref();
  ResourceManager.register('db-retry-interval', retryInterval, (timer) => clearInterval(timer));
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
  • WhatsApp Status: http://localhost:${port}/api/wa/initial-state
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
