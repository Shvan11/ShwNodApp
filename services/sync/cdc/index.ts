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
import { CdcEngine, enforceCaptureBound } from './engine.js';
import { startDriftWatch, stopDriftWatch } from './drift-check.js';
import { startClockWatch, stopClockWatch } from './clock-check.js';
import { FailoverSink } from './failover-sink.js';
import { DolphinSink } from './dolphin-sink.js';
import { ReverseSink } from './reverse-sink.js';
import { getReverseReadPool, buildOneShotSupabasePool } from './supabase-pool.js';
import { getPgPool } from '../../database/kysely.js';
import { log } from '../../../utils/logger.js';
import type { SyncSink, EngineOpts } from './types.js';

function num(v: string | undefined, d: number): number {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : d;
}

/**
 * How often the no-drainer watchdog re-checks an unmanned sink's backlog against its bound.
 * A minute is far tighter than the bound can plausibly be crossed in, and the check costs one
 * indexed PK read when capture is off — which, on an install that mirrors nothing, it always is.
 */
const CAPTURE_WATCHDOG_INTERVAL_MS = 60_000;

/**
 * The reverse sink's feed lives on Supabase, so its watchdog check needs a remote connection. It
 * runs on every Nth tick (≈10 min) over a ONE-SHOT pool rather than every minute over a held one:
 * an install with reverse sync switched off must not carry an idle Supabase connection for the
 * whole process lifetime just to poll a counter. Its bound is a remote disk anyway — slower is fine.
 */
const REMOTE_WATCHDOG_EVERY_NTH_TICK = 10;

/**
 * Sinks with NO engine in this process (their env flag is off) whose capture may nevertheless still
 * be ON in the shared control row.
 *
 * This list exists because of what startCdc() deliberately no longer does. Until 2026-09-15 an
 * env-disabled sink had its capture switched off in `cdc_sink_control` at boot, on the reasoning
 * that capture with no drainer just grows change_log. But that row is SHARED by every process
 * pointing at the database — a `tsx` one-off, a test run, a second checkout, a dev box on the same
 * host — and cdc_capture() records NOTHING while it is false, with no catch-up scan anywhere. So one
 * sibling process booting without FAILOVER_SYNC_ENABLED silently blinded the live Windows service,
 * and every row written during that window is missing from the mirror permanently. That is the
 * 2026-09-08 blackout: 162 rows across 14 tables, unrecoverable.
 *
 * An env flag describes THIS process, so it may only decide whether THIS process drains. What it may
 * not do is reach across and stop the database recording. The growth that reasoning was protecting
 * against is real, but it is a disk bound, and a disk bound belongs on a watchdog that measures the
 * disk — enforceCaptureBound below — not on a boot-time guess about who else is running.
 */
interface UnmannedSink {
  name: string;
  maxBacklog: number;
  /** Feed (and control row) lives on Supabase rather than locally. */
  remote: boolean;
}

const unmannedSinks: UnmannedSink[] = [];
let watchdogTimer: NodeJS.Timeout | null = null;
let watchdogTick = 0;

/** One watchdog pass over every unmanned sink. Never throws — a failed check retries next tick. */
async function runCaptureWatchdog(): Promise<void> {
  watchdogTick += 1;
  for (const s of unmannedSinks) {
    try {
      if (!s.remote) {
        await enforceCaptureBound(getPgPool(), s.name, s.maxBacklog);
        continue;
      }
      if (watchdogTick % REMOTE_WATCHDOG_EVERY_NTH_TICK !== 1) continue;
      const pool = buildOneShotSupabasePool();
      try {
        await enforceCaptureBound(pool, s.name, s.maxBacklog);
      } finally {
        await pool.end().catch(() => {});
      }
    } catch (e) {
      log.warn(`[cdc:${s.name}] capture watchdog check failed (will retry)`, { error: (e as Error).message });
    }
  }
}

/** Start the watchdog if any sink in this process is unmanned. unref()'d: never holds boot open. */
function startCaptureWatchdog(): void {
  if (watchdogTimer || unmannedSinks.length === 0) return;
  watchdogTimer = setInterval(() => void runCaptureWatchdog(), CAPTURE_WATCHDOG_INTERVAL_MS);
  watchdogTimer.unref();
  void runCaptureWatchdog();
}

const engines: CdcEngine[] = [];

/** Start an engine for each enabled sink (no-op for a sink whose flag is off). */
export function startCdc(): void {
  // The clock-alignment guard (clock-check.ts) runs on EVERY install: its app-server-vs-local half
  // needs no mirror, and a new deployment inherits whatever zone its installers picked.
  startClockWatch();

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
      // Capture is deliberately LEFT AS IT IS — see UnmannedSink above. If it is already off (the
      // usual case: an install that has never mirrored) nothing accumulates; if it is on, another
      // process is presumably draining it, and if nothing is, the watchdog enforces the bound.
      log.info(`⏭️  CDC sink "${d.sink.name}" disabled by env — no drainer in this process (capture unchanged)`);
      const remote = d.sink.name === 'reverse';
      // A remote check needs SUPABASE_FAILOVER_DB_URL; without it there is nothing to connect to.
      if (!remote || process.env.SUPABASE_FAILOVER_DB_URL) {
        unmannedSinks.push({ name: d.sink.name, maxBacklog: d.opts.maxBacklog, remote });
      }
      continue;
    }
    const engine = new CdcEngine(d.sink, d.opts);
    engines.push(engine);
    engine.start().catch((e) => log.error(`[cdc:${d.sink.name}] failed to start`, { error: (e as Error).message }));
    // The mirror's row-count sweep — the only signal that can see a change that was never CAPTURED
    // (see drift-check.ts). Tied to the failover engine running HERE: an install that mirrors nothing
    // has nothing to compare, and a sibling process must not duplicate the sweep.
    if (d.sink.name === 'failover') startDriftWatch();
  }

  startCaptureWatchdog();
}

/**
 * Stop all running engines, the capture watchdog, the mirror drift check and the clock guard. Capture is deliberately left ON in
 * cdc_sink_control — a change recorded while we are down must survive the restart so the next boot
 * drains it. See the CdcEngine header: capture is turned off only on purpose (the circuit breaker
 * or the manual kill switch), never by a normal stop and never by an env flag.
 */
export async function stopCdc(): Promise<void> {
  stopDriftWatch();
  stopClockWatch();
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
  unmannedSinks.length = 0;
  await Promise.all(engines.map((e) => e.stop().catch(() => {})));
  engines.length = 0;
}

/** Kick an immediate drain on all running engines (webhook / admin trigger). */
export function drainCdcNow(): void {
  for (const e of engines) e.drainNow();
}
