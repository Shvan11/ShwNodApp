/**
 * PostgreSQL data-access foundation (Kysely + node-postgres).
 *
 * Phase 1 scaffold of the SQL Server → PostgreSQL migration: owns the pg connection pool
 * and the Kysely query-builder instance. Inert until the app runs with DB_DRIVER=pg; the
 * legacy mssql facade (services/database/index.ts) stays the default during the transition.
 * Nothing imports this module yet, so it has zero effect on the running app today.
 */
import pg from 'pg';
import type { Pool } from 'pg';
import { Kysely, PostgresDialect, type Transaction } from 'kysely';
import type { DB } from '../../types/db.js';
import config from '../../config/config.js';
import ResourceManager from '../core/ResourceManager.js';
import { log } from '../../utils/logger.js';

const { Pool: PgPool, types: pgTypes } = pg;

// ── Type parsers: preserve the app's wall-clock / date-only semantics (mssql ran useUTC:false). ──
// Centralized here so ETL (Phase 6) and runtime agree; parity-validated in Phase 7.
// pg invokes a parser only for non-NULL values, so the input is always a string.
// DATE (oid 1082) → raw 'YYYY-MM-DD' string (matches utils/date.ts#toDateOnly; avoids Date/UTC drift).
pgTypes.setTypeParser(1082, (v: string) => v);
// TIMESTAMP WITHOUT TIME ZONE (oid 1114) → local wall-clock Date, NOT UTC.
pgTypes.setTypeParser(1114, (v: string) => new Date(v.replace(' ', 'T')));
// NUMERIC / DECIMAL (oid 1700) → JS number (mssql returned numbers for decimal/money).
pgTypes.setTypeParser(1700, (v: string) => Number.parseFloat(v));
// BIGINT (oid 20) → JS number (ids here are well within Number.MAX_SAFE_INTEGER).
pgTypes.setTypeParser(20, (v: string) => Number.parseInt(v, 10));

/**
 * Generated database schema (kysely-codegen → types/db.d.ts). Regenerate with `npm run db:codegen`
 * after every migration so the query-builder types track the live PG schema.
 */
export type Database = DB;

let pool: Pool | null = null;
let db: Kysely<Database> | null = null;

function buildPool(): Pool {
  const c = config.databasePg;
  return new PgPool({
    host: c.host,
    port: c.port,
    database: c.database,
    user: c.user,
    password: c.password,
    max: c.max,
    connectionTimeoutMillis: c.connectionTimeoutMillis,
    idleTimeoutMillis: c.idleTimeoutMillis,
  });
}

/** Lazily-created node-postgres pool. */
export function getPgPool(): Pool {
  if (!pool) {
    pool = buildPool();
    pool.on('error', (err: Error) => log.error('PG pool error', { error: err.message }));
  }
  return pool;
}

/** Lazily-created Kysely instance over the pg pool. */
export function getKysely(): Kysely<Database> {
  if (!db) {
    db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: getPgPool() }) });
  }
  return db;
}

/** Run `cb` inside one Kysely transaction (PG counterpart of the legacy facade's withTransaction). */
export function withPgTransaction<T>(cb: (trx: Transaction<Database>) => Promise<T>): Promise<T> {
  return getKysely().transaction().execute(cb);
}

// Graceful shutdown — mirrors services/database/pool.ts. Destroying Kysely closes the pool.
ResourceManager.register('pg-pool', null, async () => {
  if (db) {
    await db.destroy();
    db = null;
    pool = null;
    log.info('PostgreSQL pool closed');
  } else if (pool) {
    await pool.end();
    pool = null;
    log.info('PostgreSQL pool closed');
  }
});
