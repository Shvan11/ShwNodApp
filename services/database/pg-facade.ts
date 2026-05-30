/**
 * PostgreSQL facade bridge — Phase 3 of the SQL Server → PostgreSQL migration.
 *
 * Re-implements the legacy mssql facade's public surface (see `mssql-facade.ts`) on top
 * of node-postgres + Kysely, preserving every signature so the ~30 callers and their
 * positional `ColumnValue[]` row mappers keep working UNCHANGED during the driver swap.
 * Active only when `DB_DRIVER=pg`; the dispatcher in `index.ts` routes to it.
 *
 * What works here:
 *  - `executeQuery` — the SELECT/INSERT/UPDATE path used by most modules. It translates
 *    `@name` tuple params to `$n` placeholders and rebuilds the tedious-style positional
 *    `ColumnValue[]` from pg's `result.fields`, so existing mappers are untouched. Raw
 *    T-SQL strings themselves are still rewritten per-module in Phase 4.
 *
 * What does NOT work yet (deliberate, rejecting stubs — un-stubbed as later phases land):
 *  - `executeStoredProcedure` / `executeMultipleResultSets` → procs move to TS in Phase 5.
 *  - `withRequest` / `withTransaction` → the facade-bypasser modules embed SQL-Server-only
 *    T-SQL (TOP, WITH (UPDLOCK), OUTPUT INSERTED, @@ROWCOUNT) inside them; Phase 4 rewrites
 *    those modules directly onto Kysely (`getKysely()` / `withPgTransaction` from `./kysely.js`).
 */
import type sql from 'mssql';
import type { ColumnValue } from '../../types/database.types.js';
import type {
  SqlParam,
  SqlOutputParam,
  RowMapper,
  ResultMapper,
  TestResult,
  HealthCheckResult,
  DatabaseStats,
  PoolStats,
} from './mssql-facade.js';
import config from '../../config/config.js';
import { getPgPool } from './kysely.js';
import { log } from '../../utils/logger.js';

interface QueryResult<T> extends Array<T> {
  rowsAffected?: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Translate `@name` tuple params into ordered `$n` placeholders + a positional values
 * array. A name reused in the query maps to the same `$n` (pg allows reusing a
 * placeholder). `@@SYSVAR` tokens (and any `@name` with no matching param) are left as-is.
 */
function translateParams(query: string, params: SqlParam[]): { text: string; values: unknown[] } {
  const placeholders = new Map<string, number>();
  const values: unknown[] = [];
  for (const [name, , value] of params) {
    if (
      value !== null &&
      typeof value === 'object' &&
      'columns' in (value as object) &&
      'rows' in (value as object)
    ) {
      throw new Error(
        `Table-valued parameter '${name}' is not supported on the PostgreSQL driver; ` +
        `pass an array and use unnest(...) in the rewritten query (migration Phase 4/5).`
      );
    }
    if (!placeholders.has(name)) {
      placeholders.set(name, values.length + 1);
      values.push(value);
    }
  }

  const text = query.replace(/@(\w+)/g, (match: string, name: string, offset: number, str: string) => {
    if (offset > 0 && str[offset - 1] === '@') return match; // leave @@SYSVAR alone
    const idx = placeholders.get(name);
    return idx === undefined ? match : `$${idx}`;
  });

  return { text, values };
}

function getPoolStats(): PoolStats {
  const pool = getPgPool();
  const total = pool.totalCount ?? 0;
  const idle = pool.idleCount ?? 0;
  return {
    totalConnections: total,
    activeConnections: Math.max(0, total - idle),
    waitingRequests: pool.waitingCount ?? 0,
    maxConnections: config.databasePg.max,
    isShuttingDown: false,
  };
}

// ── Core facade functions ─────────────────────────────────────────────────────

export function executeQuery<T = Record<string, unknown>, R = T[]>(
  query: string,
  params: SqlParam[] = [],
  rowMapper?: RowMapper<T>,
  resultMapper: ResultMapper<T, R> = ((r: T[]) => r) as unknown as ResultMapper<T, R>
): Promise<R & { rowsAffected?: number }> {
  return (async () => {
    if (!query || typeof query !== 'string') throw new Error('Query must be a non-empty string');

    const { text, values } = translateParams(query, params);
    const pool = getPgPool();
    // rowMode:'array' keeps column order + duplicate column names intact, which the
    // positional ColumnValue[] mappers (columns[0], columns[1]…) depend on.
    const result = await pool.query({ text, values, rowMode: 'array' });
    const fields = result.fields;
    const rawRows = result.rows as unknown as unknown[][];

    const rows: QueryResult<T> = [] as unknown as QueryResult<T>;
    if (rowMapper) {
      for (const arr of rawRows) {
        const columns: ColumnValue[] = fields.map((f, i) => ({
          value: arr[i],
          metadata: {
            colName: f.name,
            type: { name: 'unknown' },
            nullable: true,
            caseSensitive: false,
          },
        }));
        rows.push(rowMapper(columns));
      }
    } else {
      for (const arr of rawRows) {
        const obj: Record<string, unknown> = {};
        for (let i = 0; i < fields.length; i++) obj[fields[i].name] = arr[i];
        rows.push(obj as unknown as T);
      }
    }

    const rowsAffected = result.rowCount ?? 0;
    rows.rowsAffected = rowsAffected;

    const mapped = resultMapper(rows, []) as R & { rowsAffected?: number };
    if (mapped && typeof mapped === 'object' && mapped !== (rows as unknown)) {
      mapped.rowsAffected = rowsAffected;
    }
    return mapped;
  })().catch((err: Error) => {
    log.error('PG query execution error', {
      error: err.message,
      query: query.substring(0, 100) + (query.length > 100 ? '...' : ''),
    });
    throw err;
  });
}

export function executeStoredProcedure<T, R = T[]>(
  procedureName: string,
  _params: SqlParam[],
  _outputs?: SqlOutputParam[] | ((req: never) => void),
  _rowMapper?: RowMapper<T>,
  _resultMapper?: ResultMapper<T, R>
): Promise<R> {
  return Promise.reject(
    new Error(
      `Stored procedure '${procedureName}' is not yet ported to PostgreSQL (migration Phase 5). ` +
      `Run with DB_DRIVER=mssql, or reimplement this proc as a TypeScript service method.`
    )
  );
}

export function executeMultipleResultSets<T extends object>(
  procedureName: string,
  _params: SqlParam[] = []
): Promise<T[][]> {
  return Promise.reject(
    new Error(
      `Stored procedure '${procedureName}' (multiple result sets) is not yet ported to PostgreSQL ` +
      `(migration Phase 5). Run with DB_DRIVER=mssql, or reimplement it as a TypeScript service method.`
    )
  );
}

export function withRequest<T>(_cb: (req: sql.Request) => Promise<T>): Promise<T> {
  return Promise.reject(
    new Error(
      'withRequest is not available on the PostgreSQL driver (migration Phase 4 rewrites the ' +
      'facade-bypassers). Use getKysely() / withPgTransaction from services/database/kysely.ts.'
    )
  );
}

export function withTransaction<T>(_cb: (tx: sql.Transaction) => Promise<T>): Promise<T> {
  return Promise.reject(
    new Error(
      'withTransaction is not available on the PostgreSQL driver (migration Phase 4 rewrites the ' +
      'facade-bypassers). Use withPgTransaction from services/database/kysely.ts.'
    )
  );
}

// ── Diagnostics / lifecycle ───────────────────────────────────────────────────

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
  // The pg pool/Kysely instance are torn down by the ResourceManager 'pg-pool' cleanup
  // registered in kysely.ts (called from gracefulShutdown after this). Nothing to do here.
  log.info('PostgreSQL database service shutdown (pool teardown handled by ResourceManager)');
}
