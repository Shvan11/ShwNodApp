/**
 * Unified CDC — the mirror sink (sink name 'failover', kept for the live cdc_sink_control/change_log
 * rows). Raw 1:1 mirror: every captured local row is upserted byte-for-byte into the single Supabase
 * database over the session pooler. This mirror is the only Supabase sink and the aligner portal's
 * future serving source (the curated portal projection was retired) — it is the primary mirror, not
 * a fallback.
 *
 * Table → PK is auto-discovered from the live schema (tables carrying trg_cdc_capture with a
 * single-column PK) via the shared SchemaMetaCache, so the set tracks the trigger migrations with no
 * list here. The row read + upsert construction are shared with ReverseSink (cdc-schema.ts); this
 * file owns only what is direction-specific.
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
import { qIdent, SchemaMetaCache, buildRowUpsert, readRowAsJson } from './cdc-schema.js';
import { getForwardWritePool } from './supabase-pool.js';
import type { SyncSink } from './types.js';

export class FailoverSink implements SyncSink {
  readonly name = 'failover';
  private pool: Pool | null = null;
  /** PK / generated-column / updated_at facts, resolved from the LOCAL catalog (DDL parity). */
  private readonly meta = new SchemaMetaCache(getPgPool);

  async init(): Promise<void> {
    // Shared forward-write pool (origin='failover' tagged). Lazily created on first use.
    this.pool = getForwardWritePool();
    this.meta.reset();
  }

  async close(): Promise<void> {
    // No-op: the forward-write pool is SHARED (the reverse engine may also be live) and is torn down
    // centrally by teardownSupabasePools() on graceful shutdown. Just drop our reference + caches.
    this.pool = null;
    this.meta.reset();
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
    const pkCol = await this.meta.pkFor(table);
    if (!pkCol) {
      log.warn(`[cdc:failover] no single-PK trigger for "${table}" — skipping`);
      return;
    }
    const row = await readRowAsJson(getPgPool(), table, pkCol, pk);
    if (!row) {
      await this.remove(table, pk);
      return;
    }
    // Whole-row last-write-wins with `>=`: the mirror is overwritten when the local row is at least
    // as new (local wins ties). The forward GUC keeps `updated_at` verbatim on the mirror.
    const stmt = await buildRowUpsert(this.meta, table, pkCol, row, '>=');
    await this.writeTagged(stmt.sql, stmt.params);
  }

  async remove(table: string, pk: string): Promise<void> {
    const pkCol = await this.meta.pkFor(table);
    if (!pkCol) return;
    await this.writeTagged(`DELETE FROM ${qIdent(table)} WHERE ${qIdent(pkCol)} = $1`, [pk]);
  }
}
