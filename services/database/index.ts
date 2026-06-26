/**
 * Database service — PostgreSQL (node-postgres + Kysely).
 *
 * As of migration Phase 9 the app is PostgreSQL-only: the dual-driver dispatcher,
 * the legacy mssql facade, and the `executeQuery`/`executeStoredProcedure`/`TYPES`/`sql`
 * bridge shim are gone. Query modules talk to PG directly via `getKysely()` /
 * `withPgTransaction()` (see `./kysely.js`); this module only exposes connection
 * diagnostics + lifecycle used by boot (`index.ts`) and the health monitor
 * (`services/monitoring/HealthCheck.ts`).
 *
 * (The `mssql` package + `./pool.ts` survive solely for the one-way migration scripts
 * under `scripts/` — ETL + parity harnesses needed for the Phase 10 prod cutover.)
 */
import config from '../../config/config.js';
import { getPgPool } from './kysely.js';
import { log } from '../../utils/logger.js';

// ── Public result types (driver-agnostic shapes) ───────────────────────────────

export interface PoolStats {
  totalConnections: number;
  activeConnections: number;
  waitingRequests: number;
  maxConnections: number;
  isShuttingDown: boolean;
}

export interface DatabaseStats {
  connectionPool: PoolStats;
  timestamp: number;
  healthy: boolean;
}

export interface ConnectionTestResult {
  version?: string;
  currentTime?: Date;
}

export interface TestResult {
  success: boolean;
  message: string;
  data?: ConnectionTestResult;
  error?: string;
  poolStats?: PoolStats;
}

export interface HealthCheckResult {
  healthy: boolean;
  message: string;
  error?: string;
  details: DatabaseStats & { connectionTest?: TestResult };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

let shuttingDown = false;

function getPoolStats(): PoolStats {
  const pool = getPgPool();
  const total = pool.totalCount ?? 0;
  const idle = pool.idleCount ?? 0;
  return {
    totalConnections: total,
    activeConnections: Math.max(0, total - idle),
    waitingRequests: pool.waitingCount ?? 0,
    maxConnections: config.databasePg.max,
    isShuttingDown: shuttingDown,
  };
}

// ── Diagnostics / lifecycle ─────────────────────────────────────────────────────

export async function testConnection(): Promise<TestResult> {
  try {
    const pool = getPgPool();
    const result = await pool.query('SELECT version() AS version, now() AS "currentTime"');
    const row = (result.rows[0] ?? {}) as { version?: string; currentTime?: Date };

    log.info('PostgreSQL connection test successful');
    return {
      success: true,
      message: 'Database connection successful',
      data: { version: row.version, currentTime: row.currentTime },
      poolStats: getPoolStats(),
    };
  } catch (error) {
    log.error('PostgreSQL connection test failed:', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      message: 'Database connection failed',
      error: error instanceof Error ? error.message : String(error),
      poolStats: getPoolStats(),
    };
  }
}

export async function testConnectionWithRetry(maxRetries = 5, retryDelay = 15000): Promise<TestResult> {
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      log.info(`Database connection attempt ${attempt}/${maxRetries}...`);
      const result = await testConnection();
      if (result.success) {
        if (attempt > 1) log.info(`Database connection successful after ${attempt} attempts`);
        return result;
      }
      lastError = result.error || null;
    } catch (error) {
      lastError = (error as Error).message;
      log.error(`Database connection attempt ${attempt} failed:`, { error: (error as Error).message });
    }

    if (attempt < maxRetries) {
      log.info(`Waiting ${retryDelay / 1000}s before retry...`);
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
  }

  return {
    success: false,
    message: `Database connection failed after ${maxRetries} attempts`,
    error: lastError || 'Unknown error',
  };
}

export function getDatabaseStats(): DatabaseStats {
  const poolStats = getPoolStats();
  return {
    connectionPool: poolStats,
    timestamp: Date.now(),
    healthy: !poolStats.isShuttingDown,
  };
}

export async function healthCheck(): Promise<HealthCheckResult> {
  try {
    const stats = getDatabaseStats();

    if (!stats.healthy) {
      return {
        healthy: false,
        message: 'Database connection pool is not healthy',
        details: stats,
      };
    }

    const connectionTest = await testConnection();
    return {
      healthy: connectionTest.success,
      message: connectionTest.success
        ? 'Database is healthy and responsive'
        : 'Database connectivity issues detected',
      details: { ...stats, connectionTest },
    };
  } catch (error) {
    return {
      healthy: false,
      message: 'Database health check failed',
      error: (error as Error).message,
      details: getDatabaseStats(),
    };
  }
}

export async function shutdown(): Promise<void> {
  shuttingDown = true;
  // The pg pool / Kysely instance are torn down by the ResourceManager 'pg-pool' cleanup
  // registered in kysely.ts (called from gracefulShutdown after this). Nothing to do here.
  log.info('PostgreSQL database service shutdown (pool teardown handled by ResourceManager)');
}
