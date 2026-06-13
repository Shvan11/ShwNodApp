/**
 * Unified CDC — the mirror sink (sink name 'failover', kept for the live cdc_sink_control/change_log
 * rows). Raw 1:1 mirror: every captured local row is upserted byte-for-byte into the single Supabase
 * database over the session pooler. This mirror is the only Supabase sink and the aligner portal's
 * future serving source (the curated portal projection was retired) — it is the primary mirror, not
 * a fallback.
 *
 * Table → PK is auto-discovered from the live schema (tables carrying trg_cdc_capture with a
 * single-column PK), so the set tracks the trigger migrations with no list here.
 *
 * Two-way-sync notes:
 *  - Writes go through the SHARED forward-write pool (supabase-pool.ts), whose connections are tagged
 *    `app.cdc_origin='failover'` so the Supabase capture + version triggers skip them (no reverse
 *    echo; the mirrored `updated_at` is preserved verbatim instead of re-stamped).
 *  - For tables carrying `updated_at` (the whole-row-LWW set), the upsert rides the last-write-wins
 *    `ON CONFLICT … WHERE` guard with `>=` (local wins ties); all other tables keep the blind upsert.
 *  - close() is a NO-OP: the pool is shared and centrally torn down (teardownSupabasePools()).
 */
import type { Pool } from 'pg';
import { getPgPool } from '../../database/kysely.js';
import { log } from '../../../utils/logger.js';
import {
  qIdent,
  loadPks,
  loadGeneratedCols,
  loadUpdatedAtTables,
  lwwUpdateClause,
} from './cdc-schema.js';
import { getForwardWritePool, stripSslMode } from './supabase-pool.js';
import type { SyncSink } from './types.js';

// Re-exported for routes/sync-webhook.ts's status-ping pool (kept here to minimize churn; the
// definition now lives in supabase-pool.ts alongside the shared pools).
export { stripSslMode };

export class FailoverSink implements SyncSink {
  readonly name = 'failover';
  private pool: Pool | null = null;
  private pkCache: Map<string, string> | null = null;
  private genColsCache: Map<string, Set<string>> | null = null;
  // Tables whose generated-cols we've already resolved. A table absent from
  // genColsCache means "no generated columns" (the load query only returns
  // tables that have them), so we can't use cache membership to detect a
  // newly-captured table — track seen tables explicitly and refresh once each.
  private genColsSeen: Set<string> | null = null;
  // Same shape for the updated_at (LWW) set: absence means "no updated_at column", so a separate
  // seen-set drives the refresh-once-per-new-table behaviour.
  private updatedAtCache: Set<string> | null = null;
  private updatedAtSeen: Set<string> | null = null;

  async init(): Promise<void> {
    // Shared forward-write pool (origin='failover' tagged). Lazily created on first use.
    this.pool = getForwardWritePool();
    this.pkCache = null;
    this.genColsCache = null;
    this.genColsSeen = null;
    this.updatedAtCache = null;
    this.updatedAtSeen = null;
  }

  async close(): Promise<void> {
    // No-op: the forward-write pool is SHARED (the reverse engine may also be live) and is torn down
    // centrally by teardownSupabasePools() on graceful shutdown. Just drop our reference + caches.
    this.pool = null;
    this.pkCache = null;
    this.genColsCache = null;
    this.genColsSeen = null;
    this.updatedAtCache = null;
    this.updatedAtSeen = null;
  }

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
      // First time seeing this table — refresh once in case it was captured
      // after init (mirrors the pkCache new-trigger refresh).
      this.genColsCache = await loadGeneratedCols(local);
      this.genColsSeen.add(table);
    }
    return this.genColsCache.get(table) ?? new Set();
  }

  /** Whether `table` carries an `updated_at` column → use the whole-row LWW conflict clause. */
  private async isUpdatedAtTable(table: string): Promise<boolean> {
    const local = getPgPool();
    if (!this.updatedAtCache || !this.updatedAtSeen) {
      this.updatedAtCache = await loadUpdatedAtTables(local);
      this.updatedAtSeen = new Set();
    }
    if (!this.updatedAtSeen.has(table)) {
      // Refresh once on first sighting in case the table gained updated_at after init.
      this.updatedAtCache = await loadUpdatedAtTables(local);
      this.updatedAtSeen.add(table);
    }
    return this.updatedAtCache.has(table);
  }

  /**
   * Run a single forward-mirror write with the origin GUC set on the SAME connection, sequentially
   * before the write. Replaces a pool.on('connect') SET, which raced the acquiring query on a
   * freshly-connected client (pg "already executing a query" deprecation) and — if the write won the
   * race — could skip the GUC and leak a reverse echo / updated_at restamp into the mirror. Runtime
   * `SET` of the custom GUC is pooler-agnostic (the `-c` startup option is not — the Supabase pooler
   * drops it). SET is session-scoped + idempotent, so re-setting on a reused connection is harmless;
   * with the GUC live, BOTH Supabase triggers skip the write (no reverse echo, updated_at verbatim).
   */
  private async writeTagged(sqlText: string, params: unknown[]): Promise<void> {
    const client = await this.pool!.connect();
    try {
      await client.query("SET app.cdc_origin = 'failover'");
      await client.query(sqlText, params);
    } finally {
      client.release();
    }
  }

  async upsert(table: string, pk: string): Promise<void> {
    const pkCol = await this.pkFor(table);
    if (!pkCol) {
      log.warn(`[cdc:failover] no single-PK trigger for "${table}" — skipping`);
      return;
    }
    const local = getPgPool();
    // to_jsonb so wall-clock timestamps transfer as text without UTC drift.
    const found = await local.query<{ r: Record<string, unknown> }>(
      `SELECT to_jsonb(t.*) AS r FROM ${qIdent(table)} t WHERE ${qIdent(pkCol)} = $1`,
      [pk]
    );
    if (found.rows.length === 0) {
      await this.remove(table, pk);
      return;
    }
    const row = found.rows[0].r;
    // Drop stored generated columns (e.g. tblappointments."AppDay") — PG rejects an explicit
    // value for them; the replica recomputes them from the same generation expression.
    const generated = await this.generatedColsFor(table);
    const cols = Object.keys(row).filter((c) => !generated.has(c));
    const colList = cols.map(qIdent).join(', ');
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');

    let conflict: string;
    if (await this.isUpdatedAtTable(table)) {
      // Whole-row last-write-wins: overwrite the mirror only when the local row is >= the stored
      // one (local wins ties). The forward GUC keeps `updated_at` verbatim on the mirror.
      conflict = lwwUpdateClause(table, pkCol, cols, '>=');
    } else {
      const setList = cols
        .filter((c) => c !== pkCol)
        .map((c) => `${qIdent(c)} = EXCLUDED.${qIdent(c)}`)
        .join(', ');
      conflict = setList
        ? `ON CONFLICT (${qIdent(pkCol)}) DO UPDATE SET ${setList}`
        : `ON CONFLICT (${qIdent(pkCol)}) DO NOTHING`;
    }
    await this.writeTagged(
      `INSERT INTO ${qIdent(table)} (${colList}) VALUES (${placeholders}) ${conflict}`,
      cols.map((c) => row[c])
    );
  }

  async remove(table: string, pk: string): Promise<void> {
    const pkCol = await this.pkFor(table);
    if (!pkCol) return;
    await this.writeTagged(`DELETE FROM ${qIdent(table)} WHERE ${qIdent(pkCol)} = $1`, [pk]);
  }
}
