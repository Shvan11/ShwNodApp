/**
 * Unified CDC — registry / lifecycle. One change feed per direction (DB triggers → change_log)
 * drained by one engine per enabled sink:
 *   - failover (raw 1:1 mirror, local → the single Supabase database) gated by FAILOVER_SYNC_ENABLED
 *   - dolphin  (TEMPORARY, local → Dolphin SQL Server)                gated by DOLPHIN_SYNC_ENABLED
 *   - reverse  (Supabase → local, the symmetric two-way path)         gated by REVERSE_SYNC_ENABLED
 *
 * The raw "failover" mirror is the primary Supabase mirror (the portal's future serving source). The
 * "reverse" sink is its mirror image: it drains a `change_log` that lives ON Supabase and applies web
 * /portal edits back to local through a dedicated small pool. Both Supabase pools are shared and torn
 * down centrally (teardownSupabasePools()); the reverse sink's feed mechanics run against the Supabase
 * reverse-read pool via EngineOpts.source.
 *
 * Wired into index.ts boot + gracefulShutdown.
 */
import type { Pool } from 'pg';
import { CdcEngine } from './engine.js';
import { FailoverSink } from './failover-sink.js';
import { DolphinSink } from './dolphin-sink.js';
import { ReverseSink } from './reverse-sink.js';
import { getReverseReadPool } from './supabase-pool.js';
import { getPgPool } from '../../database/kysely.js';
import { log } from '../../../utils/logger.js';
import type { SyncSink, EngineOpts } from './types.js';

function num(v: string | undefined, d: number): number {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : d;
}

/**
 * Turn a sink's capture OFF in its cdc_sink_control row. Called at boot for a sink whose env flag is
 * off: with no drainer running, leaving capture on would let change_log grow with nothing consuming
 * it. (Capture is otherwise never disabled on a normal stop — see engine.ts.) Leaves `stale`
 * untouched. `source` selects which DB holds the row — local for failover/dolphin, the Supabase
 * reverse-read pool for the reverse sink (its control row lives on Supabase).
 */
async function disableSinkCapture(sink: string, source?: () => Pool): Promise<void> {
  const pool = source?.() ?? getPgPool();
  await pool.query(
    `UPDATE cdc_sink_control SET enabled = false, note = 'sink disabled by env', updated_at = now() WHERE sink = $1`,
    [sink]
  );
}

const engines: CdcEngine[] = [];

/** Start an engine for each enabled sink (no-op for a sink whose flag is off). */
export function startCdc(): void {
  const defs: Array<{ on: boolean; sink: SyncSink; opts: EngineOpts }> = [
    {
      on: process.env.FAILOVER_SYNC_ENABLED === 'true',
      sink: new FailoverSink(),
      opts: {
        intervalMs: num(process.env.FAILOVER_SYNC_INTERVAL_MS, 5000),
        batchSize: num(process.env.FAILOVER_SYNC_BATCH_SIZE, 200),
        maxBacklog: num(process.env.FAILOVER_SYNC_MAX_BACKLOG, 100000),
      },
    },
    {
      // TEMPORARY: PostgreSQL → Dolphin Imaging SQL Server. Off by default; delete with the sink.
      on: process.env.DOLPHIN_SYNC_ENABLED === 'true',
      sink: new DolphinSink(),
      opts: {
        intervalMs: num(process.env.DOLPHIN_SYNC_INTERVAL_MS, 5000),
        batchSize: num(process.env.DOLPHIN_SYNC_BATCH_SIZE, 100),
        maxBacklog: num(process.env.DOLPHIN_SYNC_MAX_BACKLOG, 100000),
      },
    },
    {
      // Two-way path: Supabase → local. Its change_log + cdc_sink_control live ON Supabase, so the
      // engine's feed mechanics run against the reverse-read pool (opts.source). Off by default.
      on: process.env.REVERSE_SYNC_ENABLED === 'true',
      sink: new ReverseSink(),
      opts: {
        intervalMs: num(process.env.REVERSE_SYNC_INTERVAL_MS, 10000),
        batchSize: num(process.env.REVERSE_SYNC_BATCH_SIZE, 100),
        maxBacklog: num(process.env.REVERSE_SYNC_MAX_BACKLOG, 100000),
        source: () => getReverseReadPool(),
      },
    },
  ];

  for (const d of defs) {
    if (!d.on) {
      log.info(`⏭️  CDC sink "${d.sink.name}" disabled — turning capture OFF (no drainer will run)`);
      // The reverse sink's control row lives on Supabase → disable it there (d.opts.source).
      void disableSinkCapture(d.sink.name, d.opts.source).catch((e) =>
        log.warn(`[cdc:${d.sink.name}] could not disable capture for off sink`, { error: (e as Error).message })
      );
      continue;
    }
    const engine = new CdcEngine(d.sink, d.opts);
    engines.push(engine);
    engine.start().catch((e) => log.error(`[cdc:${d.sink.name}] failed to start`, { error: (e as Error).message }));
  }
}

/** Stop all running engines (turns each sink's capture off). */
export async function stopCdc(): Promise<void> {
  await Promise.all(engines.map((e) => e.stop().catch(() => {})));
  engines.length = 0;
}

/** Kick an immediate drain on all running engines (webhook / admin trigger). */
export function drainCdcNow(): void {
  for (const e of engines) e.drainNow();
}
