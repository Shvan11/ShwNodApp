/**
 * Graceful shutdown + process-level crash/signal handlers, lifted out of
 * `index.ts` (C3 — pure move).
 *
 * Teardown ORDER is load-bearing (SSE first, WhatsApp/Puppeteer second, HTTP
 * server third…) — every step's comment says why it sits where it does. Do not
 * reorder without reading them.
 */
import type { Server as HTTPServer } from 'http';
import whatsappService from '../services/messaging/whatsapp.js';
import messageState from '../services/messaging/messageState.js';
import { teardownSseBroadcaster } from '../services/messaging/sse-broadcaster.js';
import { teardownWhatsappSseBroadcaster } from '../services/messaging/sse-whatsapp.js';
import HealthCheck from '../services/monitoring/HealthCheck.js';
import { shutdown as shutdownDatabase } from '../services/database/index.js';
import { stopCdc } from '../services/sync/cdc/index.js';
import { teardownSupabasePools } from '../services/sync/cdc/supabase-pool.js';
import { localsendService } from '../services/localsend/index.js';
import ResourceManager from '../utils/resource-manager.js';
import { log } from '../utils/logger.js';

/**
 * The HTTP server to drain, handed over once `index.ts` has created it.
 * Kept as module state (rather than a parameter) because the signal handlers
 * below are registered before the server exists.
 */
let server: HTTPServer | null = null;

export function setShutdownServer(httpServer: HTTPServer): void {
  server = httpServer;
}

/**
 * Comprehensive graceful shutdown
 */
let shuttingDown = false;
export async function gracefulShutdown(signal: string): Promise<void> {
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

    // Tear the WhatsApp client (Puppeteer/Chrome) down FIRST, on a tight leash.
    // A graceful client.destroy() closes Chrome and flushes WA Web's IndexedDB; if
    // the overall 15 s shutdown watchdog (above) force-exits before that flush
    // finishes, Puppeteer's exit handler SIGKILLs Chrome mid-write and POISONS the
    // session ("authenticated but never ready" on next boot — docs §7.1). Done
    // last it routinely started with too little budget left; first, the normally
    // 1-3 s close gets the most time. The 8 s cap stops a hung Chrome from starving
    // the CDC/DB teardown that follows (it can't flush anyway once hung). Safe to
    // move early: nothing here depends on the WhatsApp client (sends are
    // fire-and-forget; its SSE channel is already torn down above).
    if (whatsappService) {
      log.info('💬 Shutting down WhatsApp service (priority — clean session flush)...');
      try {
        await Promise.race([
          whatsappService.gracefulShutdown(),
          new Promise<void>((resolve) => setTimeout(resolve, 8000)),
        ]);
      } catch (error) {
        log.warn('⚠️  WhatsApp shutdown error:', { error: (error as Error).message });
      }
    }

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

    // (WhatsApp client already torn down early — see the priority teardown above.)

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

/**
 * SIGTERM/SIGINT (+ SIGHUP on Windows). Registered from `index.ts`'s module
 * body, before initialization starts, so a Ctrl-C during boot still tears down.
 */
export function installSignalHandlers(): void {
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
}

/**
 * uncaughtException / unhandledRejection. Registered mid-initialization (the
 * same point they were registered at when this lived in `index.ts`).
 */
export function installCrashHandlers(): void {
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
}
