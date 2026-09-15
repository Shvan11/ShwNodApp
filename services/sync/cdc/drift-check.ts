/**
 * Unified CDC — the scheduled divergence detector for the `failover` mirror.
 *
 * WHY THIS EXISTS. CDC guarantees that a *recorded* change reaches the mirror; it guarantees nothing
 * about a change that was never recorded. `cdc_capture()` inserts nothing while
 * `cdc_sink_control.enabled = false`, and there is no catch-up scan anywhere — so a window with
 * capture off is simply gone from the mirror, permanently and silently. That is the 2026-09-08
 * blackout (audit finding F1a): 162 rows across 14 tables, with every health signal green, found a
 * week later only because somebody counted rows by hand.
 *
 * Counting rows by hand is therefore the missing mechanism, and this is it on a timer. Its output is
 * the one number none of the other signals can produce: **is the mirror actually the same size as
 * local**. Backlog says what is queued, `stale` says what an operator was told, reachability says the
 * socket opens — none of them can see a row that was never captured.
 *
 * REPORT-ONLY, ON PURPOSE. Repairing is `scripts/reconcile-mirror.mjs --apply`, an operator command.
 * The repair itself is safe and idempotent (a `change_log` pointer row, which the sink resolves by
 * re-reading the live local row), but auto-repairing on a timer would quietly paper over a capture
 * fault that needs a human to find its cause — the divergence would keep coming back, repaired each
 * night, reported by nothing. So this alarms, names the tables, and prints the command.
 *
 * COST. One `count(*)` per captured table per side per run — an index-only scan on the PK, and the
 * mirror half is the only network traffic. At the product's documented ceiling (~2M appointments)
 * that stays a seconds-scale job, which is why it can be a plain interval rather than a schedule.
 * The exact-set check (equal counts, different rows — needs a missing AND an extra row to hide) is
 * the script's `md5(string_agg(pk))` fingerprint; it is opt-in here behind FAILOVER_DRIFT_DEEP
 * because that one does scan every row on both sides.
 */
import type { Pool } from 'pg';
import { getPgPool } from '../../database/kysely.js';
import { buildOneShotSupabasePool } from './supabase-pool.js';
import { loadPks, qIdent } from './cdc-schema.js';
import { log } from '../../../utils/logger.js';

/** A table whose two sides disagree. `missing`/`extra` are counts only — see the module header. */
export interface TableDrift {
  tbl: string;
  local: number;
  mirror: number;
  /** local − mirror when positive: rows local has that the mirror does not. */
  missing: number;
  /** mirror − local when positive: rows only the mirror has (portal writes not yet reversed, or a lost delete). */
  extra: number;
  /** Set membership differs although the counts match — only ever set by the deep (fingerprint) pass. */
  setMismatch?: boolean;
}

export interface DriftReport {
  /** Wall-clock ISO of the run that produced this. */
  checkedAt: string;
  /** Captured tables compared (a table that errored on either side is skipped, not counted). */
  tablesChecked: number;
  /** Rows local holds that the mirror does not, summed. The headline number. */
  missing: number;
  /** Rows only the mirror holds, summed. Reported, never repaired — see reconcile-mirror.mjs. */
  extra: number;
  /** The diverging tables, worst first. Empty when the two sides agree. */
  tables: TableDrift[];
  /** Set when the run could not complete (mirror unreachable, credentials missing). */
  error: string | null;
}

/** Default cadence. Daily is well inside the window in which a divergence is still explainable. */
const DEFAULT_INTERVAL_HOURS = 24;

/**
 * Delay before the FIRST run. Boot is the busiest moment a clinic server has (pool warm-up, WhatsApp
 * client, the first drain cycle); a 73-table count sweep does not belong in it.
 */
const FIRST_RUN_DELAY_MS = 5 * 60_000;

let timer: NodeJS.Timeout | null = null;
let firstRunTimer: NodeJS.Timeout | null = null;
let running = false;
let lastReport: DriftReport | null = null;

/** The most recent completed run, for GET /api/sync/supabase-status. Null until the first one finishes. */
export function getLastDriftReport(): DriftReport | null {
  return lastReport;
}

function intervalMs(): number {
  const raw = Number(process.env.FAILOVER_DRIFT_CHECK_HOURS ?? DEFAULT_INTERVAL_HOURS);
  if (!Number.isFinite(raw) || raw < 0) return DEFAULT_INTERVAL_HOURS * 3_600_000;
  return raw * 3_600_000; // 0 disables — see startDriftWatch
}

/** `count(*)` for every captured table on one side, as table → count. A table that errors is omitted. */
async function countAll(pool: Pool, tables: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  // One statement for the lot: 73 round trips over the internet would dominate the run, and a single
  // UNION ALL lets the planner run the index-only scans back to back on the server.
  // Identifiers come from pg_catalog, not from a request — but they are still interpolated, so both
  // the literal and the identifier go through an escape rather than relying on that provenance.
  const sql = tables
    .map((t) => `SELECT '${t.replace(/'/g, "''")}' AS tbl, count(*)::int AS n FROM ${qIdent(t)}`)
    .join(' UNION ALL ');
  const { rows } = await pool.query<{ tbl: string; n: number }>(sql);
  for (const r of rows) counts.set(r.tbl, r.n);
  return counts;
}

/**
 * Exact set comparison in 32 bytes per table, the same fingerprint `scripts/reconcile-mirror.mjs`
 * uses. `COLLATE "C"` is load-bearing: local is PG18 and the mirror PG17, and a collation-version
 * difference orders the same text differently, hashing two IDENTICAL sets to different digests.
 */
async function fingerprint(pool: Pool, tbl: string, pk: string): Promise<string> {
  const { rows } = await pool.query<{ h: string }>(
    `SELECT md5(coalesce(string_agg(k, ',' ORDER BY k COLLATE "C"), '')) AS h
       FROM (SELECT ${qIdent(pk)}::text AS k FROM ${qIdent(tbl)}) s`
  );
  return rows[0].h;
}

/**
 * One comparison pass. Never throws — a failure is recorded in the report's `error` so the status
 * card can show "last check failed" rather than silently keeping a stale green result.
 */
export async function runDriftCheck(): Promise<DriftReport> {
  const started = new Date();
  const base: DriftReport = {
    checkedAt: started.toISOString(),
    tablesChecked: 0,
    missing: 0,
    extra: 0,
    tables: [],
    error: null,
  };
  if (!process.env.SUPABASE_FAILOVER_DB_URL) {
    return { ...base, error: 'SUPABASE_FAILOVER_DB_URL not set' };
  }

  // A one-shot pool, not the shared forward-write singleton: this runs once a day and must not tag
  // its session with app.cdc_origin (that pool's writes are origin-tagged) nor hold a connection open
  // between runs. Ended in the finally below.
  // Bounded on BOTH sides: this one scans rather than reading a counter, and an unanswered
  // statement against the pooler would otherwise hang the check (and its pool) indefinitely.
  const mirror = buildOneShotSupabasePool({ statement_timeout: 120_000, query_timeout: 130_000 });
  try {
    const local = getPgPool();
    const pks = await loadPks(local);
    const tables = [...pks.keys()].sort();
    if (tables.length === 0) return { ...base, error: 'no cdc-captured tables found' };

    const [mine, theirs] = await Promise.all([countAll(local, tables), countAll(mirror, tables)]);

    const drifts: TableDrift[] = [];
    let checked = 0;
    for (const tbl of tables) {
      const a = mine.get(tbl);
      const b = theirs.get(tbl);
      if (a === undefined || b === undefined) continue; // absent on one side: a DDL-parity problem, not drift
      checked++;
      if (a !== b) {
        drifts.push({ tbl, local: a, mirror: b, missing: Math.max(0, a - b), extra: Math.max(0, b - a) });
      }
    }

    // Opt-in exact-set pass over the tables whose counts AGREED — the only place a set difference can
    // still hide, and it needs one missing row and one extra row to do so.
    if (process.env.FAILOVER_DRIFT_DEEP === 'true') {
      const equal = tables.filter((t) => mine.get(t) !== undefined && mine.get(t) === theirs.get(t));
      for (const tbl of equal) {
        const pk = pks.get(tbl);
        if (!pk) continue;
        const [h1, h2] = await Promise.all([fingerprint(local, tbl, pk), fingerprint(mirror, tbl, pk)]);
        if (h1 !== h2) {
          const n = mine.get(tbl) ?? 0;
          drifts.push({ tbl, local: n, mirror: n, missing: 0, extra: 0, setMismatch: true });
        }
      }
    }

    drifts.sort((x, y) => y.missing + y.extra - (x.missing + x.extra));
    const report: DriftReport = {
      ...base,
      tablesChecked: checked,
      missing: drifts.reduce((n, d) => n + d.missing, 0),
      extra: drifts.reduce((n, d) => n + d.extra, 0),
      tables: drifts,
      error: null,
    };
    logReport(report);
    return report;
  } catch (err) {
    const message = (err as Error).message;
    log.warn('[cdc:failover] drift check failed (will retry next interval)', { error: message });
    return { ...base, error: message };
  } finally {
    await mirror.end().catch(() => {});
  }
}

function logReport(r: DriftReport): void {
  if (r.tables.length === 0) {
    log.info(`[cdc:failover] drift check clean — ${r.tablesChecked} captured table(s) identical`);
    return;
  }
  const worst = r.tables
    .slice(0, 5)
    .map((d) => (d.setMismatch ? `${d.tbl} (same count, different rows)` : `${d.tbl} ${d.local}/${d.mirror}`))
    .join(', ');
  log.error(
    `[cdc:failover] MIRROR DIVERGED — ${r.missing} row(s) missing from the mirror, ${r.extra} extra, ` +
      `across ${r.tables.length} of ${r.tablesChecked} table(s): ${worst}. ` +
      `Repair: node scripts/reconcile-mirror.mjs (add --apply to enqueue).`
  );
}

/** Kick a run now (the boot delay and the interval both land here). Never overlaps itself. */
async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    lastReport = await runDriftCheck();
  } finally {
    running = false;
  }
}

/**
 * Start the daily check. Called from startCdc() only when a failover engine is actually running in
 * this process — an install that mirrors nothing has nothing to compare, and a second process that
 * merely shares the database must not duplicate the sweep.
 */
export function startDriftWatch(): void {
  if (timer || firstRunTimer) return;
  const every = intervalMs();
  if (every === 0) {
    log.info('[cdc:failover] drift check disabled (FAILOVER_DRIFT_CHECK_HOURS=0)');
    return;
  }
  firstRunTimer = setTimeout(() => {
    firstRunTimer = null;
    void tick();
    timer = setInterval(() => void tick(), every);
    timer.unref();
  }, FIRST_RUN_DELAY_MS);
  firstRunTimer.unref(); // never holds the event loop (or a graceful shutdown) open
  log.info(`[cdc:failover] drift check scheduled every ${Math.round(every / 3_600_000)}h`);
}

/** Stop the check. Idempotent; called from stopCdc(). */
export function stopDriftWatch(): void {
  if (firstRunTimer) clearTimeout(firstRunTimer);
  if (timer) clearInterval(timer);
  firstRunTimer = null;
  timer = null;
}
