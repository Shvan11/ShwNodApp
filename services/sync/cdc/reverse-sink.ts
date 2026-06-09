/**
 * Unified CDC — the REVERSE sink (sink name 'reverse'). The symmetric mirror image of FailoverSink:
 * it drains the Supabase-side `change_log(sink='reverse')` (written by Supabase's cdc_capture_remote
 * on genuine web/portal edits) and applies each change to LOCAL Postgres.
 *
 * Direction & isolation:
 *  - READS the current Supabase row over the SHARED reverse-read pool (supabase-pool.ts).
 *  - WRITES to local through a DEDICATED small pool (max 2) so reverse applies can never contend
 *    with the app's 10-connection pool. The local hot path is untouched (no new local triggers,
 *    no new local columns).
 *
 * Loop break + version preservation: every local apply runs in a txn that sets
 * `SET LOCAL app.cdc_origin='reverse'`, which makes BOTH local triggers skip it — cdc_capture()
 * (no forward echo) AND set_updated_at() (the incoming Supabase `updated_at` is preserved verbatim
 * instead of re-stamped, so whole-row LWW stays correct).
 *
 * Conflict resolution: reverse-set tables all carry `updated_at`, so the upsert rides the
 * last-write-wins `ON CONFLICT … WHERE` guard with `>` — Supabase overwrites local only when
 * STRICTLY newer (ties go to local, matching the forward sink's `>=`). Deletes are unconditional.
 *
 * Metadata (PK / generated cols / updated_at set) is resolved from the LOCAL catalog given DDL
 * parity — identical on both DBs.
 */
import pg from 'pg';
import type { Pool } from 'pg';
import { getPgPool } from '../../database/kysely.js';
import config from '../../../config/config.js';
import { log } from '../../../utils/logger.js';
import {
  qIdent,
  loadPks,
  loadGeneratedCols,
  loadUpdatedAtTables,
  lwwUpdateClause,
} from './cdc-schema.js';
import { getReverseReadPool } from './supabase-pool.js';
import type { SyncSink } from './types.js';

const { Pool: PgPool } = pg;

export class ReverseSink implements SyncSink {
  readonly name = 'reverse';
  /** Dedicated LOCAL write pool (max 2) — keeps reverse applies off the app's 10-conn pool. */
  private writePool: Pool | null = null;
  private pkCache: Map<string, string> | null = null;
  private genColsCache: Map<string, Set<string>> | null = null;
  private genColsSeen: Set<string> | null = null;
  private updatedAtCache: Set<string> | null = null;
  private updatedAtSeen: Set<string> | null = null;

  async init(): Promise<void> {
    const c = config.databasePg;
    this.writePool = new PgPool({
      host: c.host,
      port: c.port,
      database: c.database,
      user: c.user,
      password: c.password,
      max: 2, // small + dedicated: reverse applies never contend with the app pool
      connectionTimeoutMillis: c.connectionTimeoutMillis,
      idleTimeoutMillis: c.idleTimeoutMillis,
    });
    this.writePool.on('error', (e: Error) => log.error('[cdc:reverse] local write pool error', { error: e.message }));
    this.pkCache = null;
    this.genColsCache = null;
    this.genColsSeen = null;
    this.updatedAtCache = null;
    this.updatedAtSeen = null;
  }

  async close(): Promise<void> {
    // End our OWN dedicated local write pool (NOT the shared reverse-read pool — that's torn down
    // centrally by teardownSupabasePools()).
    if (this.writePool) {
      try {
        await this.writePool.end();
      } catch {
        /* already closing */
      }
      this.writePool = null;
    }
  }

  // ── Metadata (resolved from the LOCAL catalog; identical on both DBs given parity) ──────────────

  private async pkFor(table: string): Promise<string | undefined> {
    const local = getPgPool();
    if (!this.pkCache) this.pkCache = await loadPks(local);
    if (!this.pkCache.has(table)) this.pkCache = await loadPks(local); // refresh once for a new trigger
    return this.pkCache.get(table);
  }

  private async generatedColsFor(table: string): Promise<Set<string>> {
    const local = getPgPool();
    if (!this.genColsCache || !this.genColsSeen) {
      this.genColsCache = await loadGeneratedCols(local);
      this.genColsSeen = new Set();
    }
    if (!this.genColsSeen.has(table)) {
      this.genColsCache = await loadGeneratedCols(local);
      this.genColsSeen.add(table);
    }
    return this.genColsCache.get(table) ?? new Set();
  }

  private async isUpdatedAtTable(table: string): Promise<boolean> {
    const local = getPgPool();
    if (!this.updatedAtCache || !this.updatedAtSeen) {
      this.updatedAtCache = await loadUpdatedAtTables(local);
      this.updatedAtSeen = new Set();
    }
    if (!this.updatedAtSeen.has(table)) {
      this.updatedAtCache = await loadUpdatedAtTables(local);
      this.updatedAtSeen.add(table);
    }
    return this.updatedAtCache.has(table);
  }

  /**
   * Run one DML against local inside a txn tagged `app.cdc_origin='reverse'` on a SINGLE checked-out
   * client (SET LOCAL only affects the running txn on that exact session). Rolls back on error.
   */
  private async applyLocal(sqlText: string, params: unknown[]): Promise<void> {
    const client = await this.writePool!.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL app.cdc_origin = 'reverse'");
      await client.query(sqlText, params);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  // ── Apply (Supabase → local) ────────────────────────────────────────────────────────────────────

  async upsert(table: string, pk: string): Promise<void> {
    const pkCol = await this.pkFor(table);
    if (!pkCol) {
      log.warn(`[cdc:reverse] no single-PK trigger for "${table}" — skipping`);
      return;
    }
    // Read the CURRENT Supabase row (to_jsonb → wall-clock timestamps as text, no UTC drift).
    const found = await getReverseReadPool().query<{ r: Record<string, unknown> }>(
      `SELECT to_jsonb(t.*) AS r FROM ${qIdent(table)} t WHERE ${qIdent(pkCol)} = $1`,
      [pk]
    );
    if (found.rows.length === 0) {
      // Vanished on Supabase between capture and drain → propagate as a delete.
      await this.remove(table, pk);
      return;
    }
    const row = found.rows[0].r;
    const generated = await this.generatedColsFor(table);
    const cols = Object.keys(row).filter((c) => !generated.has(c));
    const colList = cols.map(qIdent).join(', ');
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');

    let conflict: string;
    if (await this.isUpdatedAtTable(table)) {
      // Whole-row LWW: Supabase overwrites local only when STRICTLY newer (ties → local).
      conflict = lwwUpdateClause(table, pkCol, cols, '>');
    } else {
      // Defensive: a reverse change for a non-updated_at table shouldn't occur (cdc_capture_remote
      // is attached only to updated_at tables), but if it does, fall back to a blind upsert.
      const setList = cols
        .filter((c) => c !== pkCol)
        .map((c) => `${qIdent(c)} = EXCLUDED.${qIdent(c)}`)
        .join(', ');
      conflict = setList
        ? `ON CONFLICT (${qIdent(pkCol)}) DO UPDATE SET ${setList}`
        : `ON CONFLICT (${qIdent(pkCol)}) DO NOTHING`;
    }
    await this.applyLocal(
      `INSERT INTO ${qIdent(table)} (${colList}) VALUES (${placeholders}) ${conflict}`,
      cols.map((c) => row[c])
    );
  }

  async remove(table: string, pk: string): Promise<void> {
    const pkCol = await this.pkFor(table);
    if (!pkCol) return;
    await this.applyLocal(`DELETE FROM ${qIdent(table)} WHERE ${qIdent(pkCol)} = $1`, [pk]);
  }
}
