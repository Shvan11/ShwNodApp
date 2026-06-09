/**
 * Unified CDC — shared Supabase connection pools for the symmetric forward/reverse sinks.
 *
 * Both sinks talk to the SAME Supabase database (the single mirror) over SUPABASE_FAILOVER_DB_URL,
 * but with different session semantics, so they get two lazily-created module singletons:
 *
 *  - forward-write pool — the `failover` sink's mirror writes. Every connection is tagged
 *    `SET app.cdc_origin = 'failover'`, which makes BOTH Supabase triggers skip the write: the
 *    capture trigger (no `change_log(reverse)` echo) AND the version trigger (the mirrored
 *    `updated_at` travels verbatim instead of being re-stamped). The GUC is free per-write on the
 *    session pooler (port 5432) / a direct connection — which is what the configured URL uses.
 *    Fallback if a TRANSACTION pooler is ever used: drop the connect GUC and wrap each reverse-set
 *    forward upsert in `BEGIN; SET LOCAL app.cdc_origin='failover'; …` (overhead stays on the
 *    Supabase write side, never on the local hot path).
 *
 *  - reverse-read pool — plain (NO origin GUC). The reverse engine drains the Supabase-side
 *    `change_log`/`cdc_sink_control` through it and the reverse sink reads current Supabase rows
 *    through it.
 *
 * Ownership: these pools are shared, so a single engine's `sink.close()` must NOT `end()` them (the
 * other sink may still be using one). Lifetime is centralized — `teardownSupabasePools()` ends both
 * and is called once from gracefulShutdown (index.ts) AFTER stopCdc().
 */
import pg from 'pg';
import type { Pool } from 'pg';
import { log } from '../../../utils/logger.js';

const { Pool: PgPool } = pg;

/**
 * Drop any `sslmode=` query param from a PG connection string, preserving everything else
 * (credentials included). Newer pg-connection-string coerces `sslmode=require` → `verify-full`,
 * which overrides our explicit `ssl: { rejectUnauthorized: false }` and fails the TLS handshake
 * against the Supabase pooler's self-signed chain. Removing it lets the ssl object win — the
 * connection stays encrypted, just without chain validation. Exported so the status-ping in
 * routes/sync-webhook.ts builds its one-shot pool identically and reports faithful reachability.
 */
export function stripSslMode(connStr: string): string {
  return connStr
    .replace(/([?&])sslmode=[^&]*/gi, '$1') // drop the param, keep its leading separator
    .replace(/\?&/g, '?')
    .replace(/&&/g, '&') // collapse separators left behind
    .replace(/[?&]$/g, ''); // trim a dangling separator
}

function buildSupabasePool(max: number): Pool {
  const url = process.env.SUPABASE_FAILOVER_DB_URL ?? '';
  if (!url) throw new Error('SUPABASE_FAILOVER_DB_URL not set');
  return new PgPool({
    connectionString: stripSslMode(url),
    ssl: { rejectUnauthorized: false }, // Supabase pooler terminates TLS; chain not validated here
    max,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });
}

let forwardWritePool: Pool | null = null;
let reverseReadPool: Pool | null = null;

/** The `failover` sink's mirror-write pool — every connection tagged origin='failover'. */
export function getForwardWritePool(): Pool {
  if (!forwardWritePool) {
    const p = buildSupabasePool(4);
    // Tag every connection as a forward (failover) write. node-postgres runs a client's query queue
    // FIFO and the connect handler enqueues this SET before the acquiring caller's first query, so
    // the GUC is in effect for every mirror write on the connection.
    p.on('connect', (c) => {
      c.query("SET app.cdc_origin = 'failover'").catch((e: Error) =>
        log.error('[cdc:failover] could not set origin GUC on forward-write connection', { error: e.message })
      );
    });
    p.on('error', (e: Error) => log.error('[cdc:failover] forward-write pool error', { error: e.message }));
    forwardWritePool = p;
  }
  return forwardWritePool;
}

/** The reverse engine/sink's plain Supabase read+drain pool (no origin GUC). */
export function getReverseReadPool(): Pool {
  if (!reverseReadPool) {
    const p = buildSupabasePool(3);
    p.on('error', (e: Error) => log.error('[cdc:reverse] reverse-read pool error', { error: e.message }));
    reverseReadPool = p;
  }
  return reverseReadPool;
}

/**
 * End both shared Supabase pools. Called once from gracefulShutdown AFTER stopCdc() — the sinks'
 * own close() must NOT end these (they're shared). Idempotent.
 */
export async function teardownSupabasePools(): Promise<void> {
  const pools = [forwardWritePool, reverseReadPool];
  forwardWritePool = null;
  reverseReadPool = null;
  for (const p of pools) {
    if (p) {
      try {
        await p.end();
      } catch {
        /* already closing */
      }
    }
  }
}
