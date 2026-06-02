/**
 * Unified CDC — registry / lifecycle. One change feed (DB triggers → change_log) drained by one
 * engine per enabled sink:
 *   - failover (raw 1:1 mirror → the single Supabase database) gated by FAILOVER_SYNC_ENABLED
 *   - dolphin  (TEMPORARY → Dolphin SQL Server)                gated by DOLPHIN_SYNC_ENABLED
 *
 * The raw "failover" mirror is now the ONLY Supabase sink and the portal's future serving source
 * (the curated snake_case projection + reverse-sync path were retired). The `failover` name is kept
 * for the live cdc_sink_control/change_log rows; it's the primary mirror now, not a fallback.
 *
 * Wired into index.ts boot + gracefulShutdown.
 */
import { CdcEngine } from './engine.js';
import { FailoverSink } from './failover-sink.js';
import { DolphinSink } from './dolphin-sink.js';
import { log } from '../../../utils/logger.js';
import type { SyncSink, EngineOpts } from './types.js';

function num(v: string | undefined, d: number): number {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : d;
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
  ];

  for (const d of defs) {
    if (!d.on) {
      log.info(`⏭️  CDC sink "${d.sink.name}" disabled`);
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
