/**
 * Unified CDC — per-sink drain engine.
 *
 * Reads this sink's slice of `change_log` (WHERE sink = name), applies each change via the sink,
 * then removes the entry with a version guard (changed_at) so a change that arrives mid-flight is
 * not lost — at-least-once delivery, which is safe because every sink.upsert is idempotent.
 *
 * Resilience / anti-bloat (identical guarantees per sink):
 *  - Destination down → applies throw, the cycle logs and retries next tick; rows are NOT deleted.
 *  - Coalescing (UNIQUE(sink,tbl,pk)) bounds the backlog to distinct rows touched, not writes.
 *  - Circuit breaker: backlog past maxBacklog disables this sink's capture and flags it stale
 *    (full reload required), protecting the local disk during a pathological outage.
 *  - Capture is tied to the engine lifetime: enabled on start(), disabled on stop().
 */
import { getPgPool } from '../../database/kysely.js';
import { log } from '../../../utils/logger.js';
import type { SyncSink, EngineOpts } from './types.js';

interface ChangeRow {
  id: string;
  tbl: string;
  pk: string;
  op: string;
  changed_at_text: string;
}

export class CdcEngine {
  private timer: NodeJS.Timeout | null = null;
  private draining = false;
  private stopped = true;
  private breaker = false;

  constructor(
    private readonly sink: SyncSink,
    private readonly opts: EngineOpts
  ) {}

  private async setControl(enabled: boolean, extra: { stale?: boolean; note?: string } = {}): Promise<void> {
    await getPgPool().query(
      `UPDATE cdc_sink_control
          SET enabled = $1, stale = COALESCE($2, stale), note = COALESCE($3, note), updated_at = now()
        WHERE sink = $4`,
      [enabled, extra.stale ?? null, extra.note ?? null, this.sink.name]
    );
  }

  async start(): Promise<void> {
    if (this.timer) return;
    this.stopped = false;
    this.breaker = false;
    await this.sink.init();
    await this.setControl(true, { stale: false, note: 'engine started' });
    log.info(`✅ CDC sink "${this.sink.name}" started — capture ON, draining every ${this.opts.intervalMs}ms`);
    this.timer = setInterval(() => void this.drainOnce(), this.opts.intervalMs);
    void this.drainOnce();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    try {
      await this.setControl(false, { note: 'engine stopped' });
    } catch (e) {
      log.warn(`[cdc:${this.sink.name}] could not disable capture on stop`, { error: (e as Error).message });
    }
    try {
      await this.sink.close();
    } catch {
      /* already closing */
    }
    log.info(`🛑 CDC sink "${this.sink.name}" stopped — capture OFF`);
  }

  /** Kick an immediate drain (webhook/admin trigger); harmless if one is already running. */
  drainNow(): void {
    void this.drainOnce();
  }

  private async drainOnce(): Promise<void> {
    if (this.draining || this.stopped || this.breaker) return;
    this.draining = true;
    try {
      const local = getPgPool();

      // Breaker first, so it trips even while applies are failing (e.g. no internet).
      const backlog = Number(
        (
          await local.query<{ n: string }>('SELECT count(*)::text AS n FROM change_log WHERE sink = $1', [
            this.sink.name,
          ])
        ).rows[0].n
      );
      if (backlog > this.opts.maxBacklog) {
        this.breaker = true;
        const note = `auto-disabled: backlog ${backlog} > maxBacklog ${this.opts.maxBacklog}; full reload required`;
        await this.setControl(false, { stale: true, note });
        log.error(`[cdc:${this.sink.name}] ${note} — capture OFF, sink flagged stale`);
        return;
      }

      const { rows } = await local.query<ChangeRow>(
        `SELECT id::text AS id, tbl, pk, op, changed_at::text AS changed_at_text
           FROM change_log
          WHERE sink = $1
          ORDER BY changed_at, id
          LIMIT $2`,
        [this.sink.name, this.opts.batchSize]
      );
      if (rows.length === 0) return;

      let applied = 0;
      for (const r of rows) {
        if (this.stopped) break;
        if (r.op === 'D') await this.sink.remove(r.tbl, r.pk);
        else await this.sink.upsert(r.tbl, r.pk);
        // Version-guarded delete: skipped (→ reprocessed) if the row was re-touched since we read it.
        await local.query('DELETE FROM change_log WHERE id = $1 AND changed_at = $2::timestamp', [
          r.id,
          r.changed_at_text,
        ]);
        applied++;
      }
      if (applied > 0) log.info(`[cdc:${this.sink.name}] replicated ${applied} change(s)`);

      if (rows.length === this.opts.batchSize && !this.stopped) setTimeout(() => void this.drainOnce(), 50);
    } catch (err) {
      log.warn(`[cdc:${this.sink.name}] drain cycle failed (will retry)`, { error: (err as Error).message });
    } finally {
      this.draining = false;
    }
  }
}
