/**
 * Database facade — mssql-backed, preserves public API for all 17 query modules.
 */
import sql from 'mssql';
import type { ColumnValue } from '../../types/database.types.js';
import { getPool, getStats as getPoolStats } from './pool.js';
import { log } from '../../utils/logger.js';

// ── Public types ──────────────────────────────────────────────────────────────

export type MssqlType = sql.ISqlType | (() => sql.ISqlType);
export type TediousType = MssqlType; // back-compat alias used by query modules
export type SqlParam = [string, MssqlType, unknown];
export type SqlOutputParam = [string, MssqlType];
export type RowMapper<T> = (columns: ColumnValue[]) => T;
export type ResultMapper<T, R> = (result: T[], outputParams: OutputParam[]) => R;

interface OutputParam {
  parameterName: string;
  value: unknown;
}

interface PoolStats {
  totalConnections: number;
  activeConnections: number;
  waitingRequests: number;
  maxConnections: number;
  isShuttingDown: boolean;
}

interface DatabaseStats {
  connectionPool: PoolStats;
  timestamp: number;
  healthy: boolean;
}

interface ConnectionTestResult {
  version?: string;
  currentTime?: Date;
  quotedIdentifier?: number;
  ansiNulls?: number;
}

interface TestResult {
  success: boolean;
  message: string;
  data?: ConnectionTestResult;
  error?: string;
  poolStats?: PoolStats;
}

interface HealthCheckResult {
  healthy: boolean;
  message: string;
  error?: string;
  details: DatabaseStats & { connectionTest?: TestResult };
}

interface QueryResult<T> extends Array<T> {
  rowsAffected?: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function applyInputs(req: sql.Request, params: SqlParam[]): void {
  for (const [name, type, value] of params) {
    // Detect TVP: { columns, rows }
    if (
      type === sql.TYPES.TVP &&
      value !== null &&
      typeof value === 'object' &&
      'columns' in value &&
      'rows' in value
    ) {
      const tvpDef = value as { columns: { name: string; type: any }[]; rows: any[][] };
      const tvp = new sql.Table();
      for (const col of tvpDef.columns) (tvp.columns as any).add(col.name, col.type);
      for (const row of tvpDef.rows) tvp.rows.add(...row);
      (req as any).input(name, tvp);
    } else {
      (req as any).input(name, type, value);
    }
  }
}

/**
 * Rebuild tedious-style ColumnValue[] from an mssql recordset row.
 * Sort by column index so positional access (columns[0], columns[1]…) works.
 */
function buildColumns(row: Record<string, unknown>, recordsetColumns: sql.IColumnMetadata): ColumnValue[] {
  const entries = Object.entries(recordsetColumns).sort(
    ([, a], [, b]) => (a as sql.IColumnMetadata[string]).index - (b as sql.IColumnMetadata[string]).index
  );
  return entries.map(([key, meta]) => ({
    value: row[key],
    metadata: {
      colName: (meta as sql.IColumnMetadata[string] & { name?: string }).name ?? key,
      // Populate required ColumnMetadata fields with safe defaults
      type: { name: 'unknown' },
      nullable: true,
      caseSensitive: false,
    },
  }));
}

function shimRows<T>(
  recordset: sql.IRecordSet<Record<string, unknown>> | undefined | null,
  rowMapper?: RowMapper<T>
): QueryResult<T> {
  const result: QueryResult<T> = [] as unknown as QueryResult<T>;
  if (!recordset) return result;
  if (rowMapper) {
    for (const row of recordset) {
      result.push(rowMapper(buildColumns(row, recordset.columns)));
    }
  } else {
    for (const row of recordset) {
      result.push(row as unknown as T);
    }
  }
  return result;
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

    const pool = await getPool();
    const req = pool.request();
    applyInputs(req, params);
    const result = await req.query<Record<string, unknown>>(query);

    const rows = shimRows<T>(result.recordset, rowMapper);
    const rowsAffected = Array.isArray(result.rowsAffected)
      ? result.rowsAffected.reduce((a, b) => a + b, 0)
      : (result.rowsAffected ?? 0);
    rows.rowsAffected = rowsAffected;

    const mapped = resultMapper(rows, []) as R & { rowsAffected?: number };
    if (mapped && typeof mapped === 'object' && mapped !== (rows as unknown)) {
      mapped.rowsAffected = rowsAffected;
    }
    return mapped;
  })().catch((err: Error) => {
    log.error('Query execution error', {
      error: err.message,
      query: query.substring(0, 100) + (query.length > 100 ? '...' : ''),
    });
    throw err;
  });
}

export function executeStoredProcedure<T, R = T[]>(
  procedureName: string,
  params: SqlParam[],
  outputs?: SqlOutputParam[] | ((req: never) => void),
  rowMapper?: RowMapper<T>,
  resultMapper?: ResultMapper<T, R>
): Promise<R> {
  // Back-compat: if outputs is a function (old beforeExec callback), ignore it and
  // warn — callers that still pass beforeExec must be migrated to outputs array.
  const outputsList: SqlOutputParam[] = typeof outputs === 'function' ? [] : (outputs ?? []);
  if (typeof outputs === 'function') {
    log.warn(`executeStoredProcedure called with beforeExec callback for '${procedureName}' — migrate to outputs array`);
  }

  return (async () => {
    if (!procedureName || typeof procedureName !== 'string') {
      throw new Error('Procedure name must be a non-empty string');
    }

    const pool = await getPool();
    const req = pool.request();
    applyInputs(req, params);
    for (const [n, t] of outputsList) {
      (req as any).output(n, t);
    }

    const result = await req.execute<Record<string, unknown>>(procedureName);

    const rows = shimRows<T>(result.recordset, rowMapper);
    const outParams: OutputParam[] = Object.entries(result.output ?? {}).map(
      ([parameterName, value]) => ({ parameterName, value })
    );

    return resultMapper ? resultMapper(rows, outParams) : (rows as unknown as R);
  })().catch((err: Error) => {
    log.error('Stored procedure execution error', {
      error: err.message,
      procedure: procedureName,
    });
    throw err;
  });
}

export function executeMultipleResultSets<T extends object>(
  procedureName: string,
  params: SqlParam[] = []
): Promise<T[][]> {
  return (async () => {
    const pool = await getPool();
    const req = pool.request();
    applyInputs(req, params);
    const result = await req.execute<T>(procedureName);
    return result.recordsets as T[][];
  })().catch((err: Error) => {
    log.error('Stored procedure execution error', {
      error: err.message,
      procedure: procedureName,
    });
    throw err;
  });
}

export function withRequest<T>(cb: (req: sql.Request) => Promise<T>): Promise<T> {
  return getPool().then((pool) => cb(pool.request()));
}

export async function withTransaction<T>(cb: (tx: sql.Transaction) => Promise<T>): Promise<T> {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const result = await cb(tx);
    await tx.commit();
    return result;
  } catch (e) {
    try { await tx.rollback(); } catch { /* tx may have auto-aborted */ }
    throw e;
  }
}

// ── Diagnostics / lifecycle ───────────────────────────────────────────────────

export async function testConnection(): Promise<TestResult> {
  try {
    const testResult = await executeQuery<ConnectionTestResult>(
      `SELECT
        @@VERSION as Version,
        GETDATE() as CurrentTime,
        SESSIONPROPERTY('QUOTED_IDENTIFIER') as QUOTED_IDENTIFIER,
        SESSIONPROPERTY('ANSI_NULLS') as ANSI_NULLS`,
      [],
      (columns: ColumnValue[]) => ({
        version: columns[0].value as string,
        currentTime: columns[1].value as Date,
        quotedIdentifier: columns[2].value as number,
        ansiNulls: columns[3].value as number,
      })
    );

    log.info('Database connection test successful');
    return {
      success: true,
      message: 'Database connection successful',
      data: testResult[0],
      poolStats: getPoolStats(),
    };
  } catch (error) {
    log.error('Database connection test failed:', { error: error instanceof Error ? error.message : String(error) });
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
  log.info('Initiating database service shutdown');
  try {
    const pool = await getPool().catch(() => null);
    if (pool) await pool.close();
    log.info('Database service shutdown completed');
  } catch (error) {
    log.error('Error during database service shutdown:', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

// Re-export TYPES so query modules don't need to import mssql directly
export { sql };
export const TYPES = sql.TYPES;
