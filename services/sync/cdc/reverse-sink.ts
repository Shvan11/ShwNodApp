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
 * Metadata (PK / generated cols / updated_at set) and the upsert construction are shared with
 * FailoverSink via cdc-schema.ts, resolved from the LOCAL catalog given DDL parity.
 */
import pg from 'pg';
import type { Pool } from 'pg';
import { getPgPool, getKysely } from '../../database/kysely.js';
import { recomputePatientType } from '../../database/queries/patient-type-classifier.js';
import config from '../../../config/config.js';
import { log } from '../../../utils/logger.js';
import { qIdent, SchemaMetaCache, buildRowUpsert, readRowAsJson } from './cdc-schema.js';
import { getReverseReadPool } from './supabase-pool.js';
import type { SyncSink } from './types.js';

const { Pool: PgPool } = pg;

export class ReverseSink implements SyncSink {
  readonly name = 'reverse';
  /** Dedicated LOCAL write pool (max 2) — keeps reverse applies off the app's 10-conn pool. */
  private writePool: Pool | null = null;
  /** PK / generated-column / updated_at facts, resolved from the LOCAL catalog (DDL parity). */
  private readonly meta = new SchemaMetaCache(getPgPool);

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
    this.meta.reset();
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
    this.meta.reset();
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
    const pkCol = await this.meta.pkFor(table);
    if (!pkCol) {
      log.warn(`[cdc:reverse] no single-PK trigger for "${table}" — skipping`);
      return;
    }
    // Read the CURRENT Supabase row.
    const row = await readRowAsJson(getReverseReadPool(), table, pkCol, pk);
    if (!row) {
      // Vanished on Supabase between capture and drain → propagate as a delete.
      await this.remove(table, pk);
      return;
    }
    // Whole-row LWW with `>`: Supabase overwrites local only when STRICTLY newer (ties → local).
    // A reverse change for a non-updated_at table shouldn't occur (cdc_capture_remote is attached
    // only to updated_at tables); buildRowUpsert falls back to a blind upsert if one ever does.
    const stmt = await buildRowUpsert(this.meta, table, pkCol, row, '>');
    await this.applyLocal(stmt.sql, stmt.params);

    // A portal works change (new case / edit) arrived via reverse CDC, bypassing the
    // query-layer classifier hooks. Reclassify the owning patient — person_id is already
    // in the fetched Supabase row.
    if (table === 'works') {
      await this.recomputeWorksPatientType(row['person_id']);
    }
  }

  async remove(table: string, pk: string): Promise<void> {
    const pkCol = await this.meta.pkFor(table);
    if (!pkCol) return;
    // For a works delete, capture the owning patient BEFORE the local DELETE (the row
    // is about to vanish) so we can reclassify them afterwards.
    let worksPersonId: unknown = null;
    if (table === 'works') {
      const owner = await getKysely()
        .selectFrom('works')
        .select('person_id')
        .where('work_id', '=', Number(pk))
        .executeTakeFirst();
      worksPersonId = owner?.person_id ?? null;
    }
    await this.applyLocal(`DELETE FROM ${qIdent(table)} WHERE ${qIdent(pkCol)} = $1`, [pk]);
    if (table === 'works' && worksPersonId != null) {
      await this.recomputeWorksPatientType(worksPersonId);
    }
  }

  /**
   * Recompute a patient's derived type after a reverse works upsert/delete. Runs on the
   * NORMAL app pool via getKysely() — NOT the reverse write pool — so it carries no
   * `app.cdc_origin='reverse'` tag: set_updated_at + cdc_capture fire and the new
   * patient_type_id forwards to the mirror on the next forward drain. Log-only: never
   * throw into the drain loop (idempotent + at-least-once safe; the backfill is the
   * correctness backstop).
   */
  private async recomputeWorksPatientType(personIdRaw: unknown): Promise<void> {
    const personId = Number(personIdRaw);
    if (!Number.isFinite(personId) || personId <= 0) return;
    try {
      await recomputePatientType(getKysely(), personId);
    } catch (e) {
      log.error('[cdc:reverse] patient-type recompute failed', {
        personId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}
