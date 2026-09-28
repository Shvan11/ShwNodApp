/**
 * Unified CDC — the clock-alignment guard.
 *
 * WHY THIS EXISTS. Every timestamp in this schema is `timestamp WITHOUT time zone`, single-clinic wall
 * clock (CLAUDE.md §Database), and three independent clocks produce or interpret those values:
 *   - the app server — Node's `TZ` (config/process-env.ts) turns every value it reads into a Date;
 *   - local PostgreSQL — its `TimeZone` (postgresql.conf) evaluates the LOCALTIMESTAMP defaults and
 *     set_updated_at();
 *   - the Supabase mirror — its `TimeZone` (a database-level setting there) evaluates the same
 *     defaults for every row the doctor portal inserts, and set_updated_at_remote() for every portal
 *     edit.
 * Nothing makes the three agree. Until 2026-09-27 the mirror ran UTC while local ran Asia/Baghdad
 * (audit FE-F5-1): every portal-stamped time arrived home 3 h behind, and reverse-sync last-write-wins
 * — which compares `updated_at` verbatim across the two sides — skipped a portal edit made within 3 h
 * of a staff edit of the same row, while the portal showed it saved. A new deployment inherits
 * whatever zone its installers picked, so this has to be checked, not remembered.
 *
 * HOW IT READS A DATABASE'S ZONE. The database-level default from `pg_db_role_setting` first, and the
 * session's own `TimeZone` only when there is none — because `ALTER DATABASE … SET timezone` reaches
 * NEW sessions only. A pooled connection opened before the change would otherwise report the old
 * zone for as long as it lives (the portal's PostgREST connection had been open for a month when
 * FE-F5-1 was found). Then the zone's offset at this instant, computed server-side, so the comparison
 * is by offset (see clock-compare.ts) and a DST zone is judged for the date it is actually stamping.
 *
 * REPORT-ONLY, like the drift check: changing a server's timezone moves every session on it, so this
 * alarms, says which clock is off and prints the fix; it never alters anything. Runs on EVERY install
 * (the app-server-vs-local half needs no mirror), a minute after boot and then every few hours — two
 * trivial statements, plus one short-lived mirror connection when a mirror is configured.
 */
import type { Pool } from 'pg';
import { getPgPool } from '../../database/kysely.js';
import { buildOneShotSupabasePool } from './supabase-pool.js';
import { compareClocks, formatOffset, type ClockReading } from './clock-compare.js';
import { log } from '../../../utils/logger.js';

export type { ClockReading } from './clock-compare.js';

export interface ClockReport {
  /** Wall-clock ISO of the run. */
  checkedAt: string;
  node: ClockReading;
  /** Null only when the local read failed (see `error`). */
  local: ClockReading | null;
  /** Null when no mirror is configured, or when its read failed (see `error`). */
  mirror: ClockReading | null;
  mirrorConfigured: boolean;
  /** One operator-facing sentence per disagreement, naming the fix. Empty when the clocks agree. */
  mismatches: string[];
  /** Set when a side could not be read; the sides that were read are still compared. */
  error: string | null;
}

const FIRST_RUN_DELAY_MS = 60_000;
const INTERVAL_MS = 6 * 3_600_000;

/** Database-level default zone (falling back to the session's), and its offset right now. */
const DB_CLOCK_SQL = `
  WITH d AS (
    SELECT COALESCE(
      (SELECT substr(cfg, strpos(cfg, '=') + 1)
         FROM pg_db_role_setting s, unnest(s.setconfig) AS cfg
        WHERE s.setrole = 0
          AND s.setdatabase = (SELECT oid FROM pg_database WHERE datname = current_database())
          AND lower(cfg) LIKE 'timezone=%'
        LIMIT 1),
      current_setting('TimeZone')) AS tz
  )
  SELECT tz, EXTRACT(EPOCH FROM (now() AT TIME ZONE tz) - (now() AT TIME ZONE 'UTC'))::int AS offset_sec
    FROM d`;

let timer: NodeJS.Timeout | null = null;
let firstRunTimer: NodeJS.Timeout | null = null;
let running = false;
let lastReport: ClockReport | null = null;

/** The most recent completed run, for GET /api/sync/supabase-status. Null until the first one finishes. */
export function getLastClockReport(): ClockReport | null {
  return lastReport;
}

function nodeClock(): ClockReading {
  return {
    tz: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
    offsetSec: -new Date().getTimezoneOffset() * 60,
  };
}

async function readDbClock(pool: Pool): Promise<ClockReading> {
  const { rows } = await pool.query<{ tz: string; offset_sec: number }>(DB_CLOCK_SQL);
  return { tz: rows[0].tz, offsetSec: rows[0].offset_sec };
}

/** One comparison pass. Never throws — a failed read is recorded in `error`. */
export async function runClockCheck(): Promise<ClockReport> {
  const node = nodeClock();
  const mirrorConfigured = !!process.env.SUPABASE_FAILOVER_DB_URL;
  const errors: string[] = [];

  let local: ClockReading | null = null;
  try {
    local = await readDbClock(getPgPool());
  } catch (err) {
    errors.push(`local: ${(err as Error).message}`);
  }

  let mirror: ClockReading | null = null;
  if (mirrorConfigured) {
    // One-shot, like the drift check: nothing here may hold a mirror connection between runs.
    const pool = buildOneShotSupabasePool({ statement_timeout: 15_000, query_timeout: 20_000 });
    try {
      mirror = await readDbClock(pool);
    } catch (err) {
      errors.push(`mirror: ${(err as Error).message}`);
    } finally {
      await pool.end().catch(() => {});
    }
  }

  const report: ClockReport = {
    checkedAt: new Date().toISOString(),
    node,
    local,
    mirror,
    mirrorConfigured,
    mismatches: compareClocks(node, local, mirror),
    error: errors.length ? errors.join('; ') : null,
  };
  logReport(report);
  return report;
}

function logReport(r: ClockReport): void {
  if (r.error) log.warn('[cdc:clock] clock check could not read every clock', { error: r.error });
  if (r.mismatches.length > 0) {
    for (const m of r.mismatches) log.error(`[cdc:clock] CLOCKS DISAGREE — ${m}`);
    return;
  }
  if (r.local) {
    const where = r.mirror ? 'app server, local database and mirror' : 'app server and local database';
    log.info(`[cdc:clock] clocks agree — ${r.local.tz} (${formatOffset(r.local.offsetSec)}) on the ${where}`);
  }
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    lastReport = await runClockCheck();
  } finally {
    running = false;
  }
}

/** Start the periodic check. Called from startCdc() on every install. Idempotent. */
export function startClockWatch(): void {
  if (timer || firstRunTimer) return;
  firstRunTimer = setTimeout(() => {
    firstRunTimer = null;
    void tick();
    timer = setInterval(() => void tick(), INTERVAL_MS);
    timer.unref();
  }, FIRST_RUN_DELAY_MS);
  firstRunTimer.unref(); // never holds the event loop (or a graceful shutdown) open
}

/** Stop the check. Idempotent; called from stopCdc(). */
export function stopClockWatch(): void {
  if (firstRunTimer) clearTimeout(firstRunTimer);
  if (timer) clearInterval(timer);
  firstRunTimer = null;
  timer = null;
}
