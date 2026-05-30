/**
 * Database facade — driver dispatcher.
 *
 * This is the single entry point every query module / route / service imports
 * (`executeQuery`, `withTransaction`, `TYPES`, …). It routes each call to one of two
 * implementations based on `config.dbDriver` (the `DB_DRIVER` env var):
 *   - `mssql` (default) → `mssql-facade.ts` (legacy SQL Server, unchanged behavior)
 *   - `pg`              → `pg-facade.ts`    (PostgreSQL bridge, migration Phases 3+)
 *
 * Public signatures are identical across both facades, so callers and their positional
 * `ColumnValue[]` mappers don't change as the driver is swapped. `sql` / `TYPES` are kept
 * mssql-sourced so the existing `TYPES.*` param tuples and `new sql.Request(tx)` sites
 * still compile under either driver; the pg facade ignores the mssql type hints when it
 * translates `@name` params to `$n` placeholders. (Retiring the mssql `TYPES`/`sql`
 * re-exports for a pure pg shim is deferred to Phase 9, once mssql is removed.)
 */
import sql from 'mssql';
import config from '../../config/config.js';
import * as mssqlFacade from './mssql-facade.js';
import * as pgFacade from './pg-facade.js';

// ── Public types (sourced from the mssql facade; identical shape for both drivers) ──
export type {
  MssqlType,
  TediousType,
  SqlParam,
  SqlOutputParam,
  RowMapper,
  ResultMapper,
  PoolStats,
  DatabaseStats,
  ConnectionTestResult,
  TestResult,
  HealthCheckResult,
} from './mssql-facade.js';

import type {
  SqlParam,
  SqlOutputParam,
  RowMapper,
  ResultMapper,
  DatabaseStats,
  TestResult,
  HealthCheckResult,
} from './mssql-facade.js';

const usePg = config.dbDriver === 'pg';

// ── Core facade functions (thin generic wrappers preserving exact signatures) ──

export function executeQuery<T = Record<string, unknown>, R = T[]>(
  query: string,
  params?: SqlParam[],
  rowMapper?: RowMapper<T>,
  resultMapper?: ResultMapper<T, R>
): Promise<R & { rowsAffected?: number }> {
  return usePg
    ? pgFacade.executeQuery<T, R>(query, params, rowMapper, resultMapper)
    : mssqlFacade.executeQuery<T, R>(query, params, rowMapper, resultMapper);
}

export function executeStoredProcedure<T, R = T[]>(
  procedureName: string,
  params: SqlParam[],
  outputs?: SqlOutputParam[] | ((req: never) => void),
  rowMapper?: RowMapper<T>,
  resultMapper?: ResultMapper<T, R>
): Promise<R> {
  return usePg
    ? pgFacade.executeStoredProcedure<T, R>(procedureName, params, outputs, rowMapper, resultMapper)
    : mssqlFacade.executeStoredProcedure<T, R>(procedureName, params, outputs, rowMapper, resultMapper);
}

export function executeMultipleResultSets<T extends object>(
  procedureName: string,
  params?: SqlParam[]
): Promise<T[][]> {
  return usePg
    ? pgFacade.executeMultipleResultSets<T>(procedureName, params)
    : mssqlFacade.executeMultipleResultSets<T>(procedureName, params);
}

export function withRequest<T>(cb: (req: sql.Request) => Promise<T>): Promise<T> {
  return usePg ? pgFacade.withRequest<T>(cb) : mssqlFacade.withRequest<T>(cb);
}

export function withTransaction<T>(cb: (tx: sql.Transaction) => Promise<T>): Promise<T> {
  return usePg ? pgFacade.withTransaction<T>(cb) : mssqlFacade.withTransaction<T>(cb);
}

// ── Diagnostics / lifecycle ───────────────────────────────────────────────────

export function testConnection(): Promise<TestResult> {
  return usePg ? pgFacade.testConnection() : mssqlFacade.testConnection();
}

export function testConnectionWithRetry(maxRetries?: number, retryDelay?: number): Promise<TestResult> {
  return usePg
    ? pgFacade.testConnectionWithRetry(maxRetries, retryDelay)
    : mssqlFacade.testConnectionWithRetry(maxRetries, retryDelay);
}

export function getDatabaseStats(): DatabaseStats {
  return usePg ? pgFacade.getDatabaseStats() : mssqlFacade.getDatabaseStats();
}

export function healthCheck(): Promise<HealthCheckResult> {
  return usePg ? pgFacade.healthCheck() : mssqlFacade.healthCheck();
}

export function shutdown(): Promise<void> {
  return usePg ? pgFacade.shutdown() : mssqlFacade.shutdown();
}

// Re-export TYPES/sql (mssql-sourced) so query modules don't import mssql directly and
// `TYPES.*` param tuples / `new sql.Request(tx)` sites keep compiling under either driver.
export { sql };
export const TYPES = sql.TYPES;
