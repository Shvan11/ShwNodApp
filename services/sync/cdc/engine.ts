/**
 * Unified CDC — per-sink drain engine.
 *
 * Reads this sink's slice of `change_log` (WHERE sink = name), applies each change via the sink,
 * then removes the entry with a version guard (changed_at) so a change that arrives mid-flight is
 * not lost — at-least-once delivery, which is safe because every sink.upsert is idempotent.
 *
 * Resilience / anti-bloat (identical guarantees per sink):
 *  - Destination down → applies throw, the cycle logs and retries next tick; rows are NOT deleted.
 *  - Destination down AT START → sink.init() throws, so the engine retries the start on a backoff
 *    rather than abandoning the sink for the whole process lifetime. Boot order is NOT a given: the
 *    Dolphin SQL Server is a Windows DELAYED auto-start service and comes up ~2min AFTER this app,
 *    so a one-shot start left that sink dead on every boot while capture kept filling change_log.
 *  - Coalescing (UNIQUE(sink,tbl,pk)) bounds the backlog to distinct rows touched, not writes.
 *  - Circuit breaker: backlog past maxBacklog disables this sink's capture and flags it stale
 *    (full reload required), protecting the local disk during a pathological outage. It lives in
 *    the exported enforceCaptureBound() rather than inline in the drain cycle, so index.ts can run
 *    the SAME bound on a timer for a sink whose capture is on but which has no engine — the one
 *    case a drain-cycle breaker can never cover, since it needs a drain cycle to fire.
 *  - Capture is DECOUPLED from the drainer's process lifetime: start() enables it, but stop()
 *    does NOT disable it. Recording a change is a cheap, coalesced (UNIQUE(sink,tbl,pk)), bounded
 *    trigger insert that must survive a restart / SIGHUP / crash so the next boot drains it —
 *    otherwise writes made while the engine is momentarily down (or by a sibling instance sharing
 *    the DB) are silently lost from the mirror. Capture turns OFF on exactly two events: the
 *    circuit breaker on overflow (flags stale → reload), or the manual kill switch
 *    (UPDATE cdc_sink_control SET enabled=false). Never from a per-process env flag — see
 *    startCdc(), and the 2026-09-08 blackout it caused.
 *  - start() never CLEARS `stale`. That flag means "changes were lost, a full reload is required";
 *    clearing it on boot laundered a standing alarm back to green on the next restart, which is
 *    exactly why the blackout above went unnoticed for a week. Only an operator clears it.
 */
import type { Pool } from 'pg';
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

/** A sink whose destination is not reachable yet retries its start on this backoff (doubling). */
const START_RETRY_MIN_MS = 5_000;
const START_RETRY_MAX_MS = 300_000;

/**
 * A backlog whose OLDEST entry is older than this is not a transient outage — it is a sink that is
 * failing to make progress (a poison row whose FK parent will never arrive, a destination that
 * accepts connections but rejects every write). Age is the signal that size cannot give: seven rows
 * stuck for three days reads as `backlog: 7` — indistinguishable from healthy — which is precisely
 * what the /supabase-status card showed throughout the 2026-09-08 divergence.
 */
const STUCK_BACKLOG_WARN_SEC = 3_600;

/** ...and say so at most this often per sink, so a permanent condition cannot flood the log. */
const STUCK_WARN_THROTTLE_MS = 15 * 60_000;

/** Per-sink timestamp of the last stuck-backlog warning (throttle state for the above). */
const lastStuckWarnAt = new Map<string, number>();

/**
 * A deferred row is normal for one cycle — coalescing can order a child ahead of its parent, and the
 * next pass fixes it. A row still deferring after many cycles is something else: its parent is never
 * arriving (lost to a capture blackout), and it will fail on every tick for the rest of the process's
 * life. The engine logged one warn per cycle regardless, so seven such rows produced a warn every
 * 5 s forever — `logs/combined4.log` held 13,987 identical lines, rotating real diagnostics out of a
 * 5 MB x 5 Winston window. So: a NEWLY failing row always warns at once (that is the signal), and a
 * set that is merely still failing repeats at most this often.
 */
const DEFER_WARN_THROTTLE_MS = 15 * 60_000;

/** How many of the worst offenders to name in that warning. */
const DEFER_WARN_TOP_N = 3;

/** One capture-bound check. `null` counts mean capture was already off, so nothing was counted. */
export interface CaptureBoundCheck {
  /** Rows waiting in this sink's change_log slice. */
  backlog: number | null;
  /** Age of the oldest pending change, in seconds (null when the backlog is empty). */
  oldestAgeSec: number | null;
  /** True when THIS call tripped the breaker and turned capture off. */
  tripped: boolean;
}

/**
 * The disk bound on `change_log`, hoisted out of the drain cycle so that it holds even when no
 * drainer is running.
 *
 * `change_log` is self-limiting by design — UNIQUE(sink,tbl,pk) coalesces, so it can never exceed
 * one row per distinct row in the database — but "the size of the database" is not a bound anyone
 * wants to discover on a clinic's disk. maxBacklog is the real ceiling, and turning capture off is
 * how it is enforced: past that point the sink needs a full reload regardless, so there is nothing
 * left to protect by continuing to record.
 *
 * Deliberately NOT a bound on AGE. An old backlog means the sink is broken, but disabling capture
 * because of it would *widen* the divergence it is reporting — every subsequent write would go
 * unrecorded too. Age gets a throttled warning here and a number on the status card; the operator
 * decides. Only size, which is the thing that actually consumes disk, trips the breaker.
 *
 * Skips the count entirely when capture is already off (never provisioned, breaker already tripped,
 * operator kill switch): nothing can be accumulating, so the watchdog costs one indexed PK read per
 * tick on the installs — the majority, commercially — that mirror nothing at all.
 */
export async function enforceCaptureBound(pool: Pool, sink: string, maxBacklog: number): Promise<CaptureBoundCheck> {
  const control = (
    await pool.query<{ enabled: boolean }>('SELECT enabled FROM cdc_sink_control WHERE sink = $1', [sink])
  ).rows[0];
  if (!control?.enabled) return { backlog: null, oldestAgeSec: null, tripped: false };

  // count + oldest in ONE statement, both served by idx_change_log_drain (sink, changed_at, id).
  // LOCALTIMESTAMP, not clock_timestamp(): changed_at is `timestamp WITHOUT time zone` and the
  // schema is single-clinic wall-clock throughout (see CLAUDE.md §Database), so mixing in a
  // timestamptz here would silently offset the age by the UTC delta.
  const row = (
    await pool.query<{ n: string; age_sec: string | null }>(
      `SELECT count(*)::text AS n,
              EXTRACT(EPOCH FROM (LOCALTIMESTAMP - min(changed_at)))::bigint::text AS age_sec
         FROM change_log
        WHERE sink = $1`,
      [sink]
    )
  ).rows[0];
  const backlog = Number(row.n);
  const oldestAgeSec = row.age_sec === null ? null : Number(row.age_sec);

  if (backlog > maxBacklog) {
    const note = `auto-disabled: backlog ${backlog} > maxBacklog ${maxBacklog}; full reload required`;
    await pool.query(
      `UPDATE cdc_sink_control SET enabled = false, stale = true, note = $1, updated_at = now() WHERE sink = $2`,
      [note, sink]
    );
    log.error(`[cdc:${sink}] ${note} — capture OFF, sink flagged stale`);
    return { backlog, oldestAgeSec, tripped: true };
  }

  if (oldestAgeSec !== null && oldestAgeSec >= STUCK_BACKLOG_WARN_SEC) {
    const now = Date.now();
    if (now - (lastStuckWarnAt.get(sink) ?? 0) >= STUCK_WARN_THROTTLE_MS) {
      lastStuckWarnAt.set(sink, now);
      log.warn(
        `[cdc:${sink}] backlog is not draining — oldest of ${backlog} pending change(s) is ${Math.round(
          oldestAgeSec / 3600
        )}h old`
      );
    }
  } else {
    lastStuckWarnAt.delete(sink); // drained: the next stall warns immediately rather than waiting out the throttle
  }

  return { backlog, oldestAgeSec, tripped: false };
}

export class CdcEngine {
  private timer: NodeJS.Timeout | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private retryDelayMs = 0;
  private draining = false;
  /** A drainNow() that landed mid-cycle; replayed once the running cycle finishes. */
  private kickPending = false;
  private stopped = true;
  private breaker = false;

  /**
   * Consecutive failed apply attempts per pending change, keyed `tbl/pk`. In memory on purpose:
   * this is diagnostic state about THIS process's retries, not a fact about the change, so it must
   * not take a `change_log` column (which is a queue row the sink re-reads, and which any other
   * drainer shares). Cleared per row on success, and pruned to the live backlog whenever a cycle
   * sees the whole of it.
   */
  private readonly deferrals = new Map<string, number>();

  /** Timestamp of the last deferral warning, for DEFER_WARN_THROTTLE_MS. */
  private lastDeferWarnAt = 0;

  constructor(
    private readonly sink: SyncSink,
    private readonly opts: EngineOpts
  ) {}

  /**
   * The pool the change-feed mechanics run against (cdc_sink_control + change_log). Forward/Dolphin
   * omit `opts.source` → the LOCAL pg pool (their feed is local). The reverse sink supplies the
   * Supabase reverse-read pool (its feed lives on Supabase). This is NOT where the sink applies a
   * change — the sink owns its own destination connection(s).
   */
  private source(): Pool {
    return this.opts.source?.() ?? getPgPool();
  }

  private async setControl(enabled: boolean, extra: { stale?: boolean; note?: string } = {}): Promise<void> {
    await this.source().query(
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
    this.clearRetry();
    try {
      await this.sink.init();
      // `stale` is deliberately NOT cleared. It means "changes were lost; a full reload is
      // required" — a standing alarm that outlives any number of restarts and is cleared only by
      // the operator who performs that reload. Clearing it here (as this did until 2026-09-15) let
      // one routine boot rewrite the row to enabled=t / stale=f / 'engine started', which is how a
      // sink 162 rows behind reported itself perfectly healthy for a week.
      await this.setControl(true, { note: 'engine started' });
    } catch (err) {
      // Destination not up yet (or a transient auth/network fault). Capture is left exactly as it
      // was, so change_log keeps coalescing and the retry drains it — nothing is lost by waiting.
      this.scheduleStartRetry(err as Error);
      return;
    }
    // stop() may have landed while init() was in flight — do not resurrect a stopped engine.
    if (this.stopped) return;
    this.retryDelayMs = 0;
    log.info(`✅ CDC sink "${this.sink.name}" started — capture ON, draining every ${this.opts.intervalMs}ms`);
    this.timer = setInterval(() => void this.drainOnce(), this.opts.intervalMs);
    void this.drainOnce();
  }

  /** Re-attempt a failed start on an exponential backoff until it succeeds or stop() is called. */
  private scheduleStartRetry(err: Error): void {
    if (this.stopped) return;
    this.retryDelayMs =
      this.retryDelayMs === 0 ? START_RETRY_MIN_MS : Math.min(this.retryDelayMs * 2, START_RETRY_MAX_MS);
    log.warn(`[cdc:${this.sink.name}] start failed — retrying in ${Math.round(this.retryDelayMs / 1000)}s`, {
      error: err.message,
    });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.stopped) void this.start();
    }, this.retryDelayMs);
  }

  private clearRetry(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.clearRetry();
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // Intentionally do NOT touch cdc_sink_control here — capture is left ON so the next
    // boot drains whatever was written while we were down (see the class header). A SIGHUP /
    // crash / sibling-instance shutdown can no longer silently stop capture. Capture is turned
    // off only deliberately: the breaker on overflow, or the manual kill switch.
    this.deferrals.clear();
    this.lastDeferWarnAt = 0;
    try {
      await this.sink.close();
    } catch {
      /* already closing */
    }
    log.info(`🛑 CDC sink "${this.sink.name}" stopped — capture left ON (drains on next start)`);
  }

  /**
   * Kick an immediate drain (webhook/admin trigger). If a cycle is already running the kick is
   * REMEMBERED, not dropped — the running cycle may already have read its batch before the change
   * that prompted the kick landed, so silently discarding it would push that change out to the next
   * interval tick, which is exactly the latency the webhook exists to avoid.
   */
  drainNow(): void {
    if (this.draining) {
      this.kickPending = true;
      return;
    }
    void this.drainOnce();
  }

  private async drainOnce(): Promise<void> {
    if (this.draining || this.stopped || this.breaker) return;
    this.draining = true;
    this.kickPending = false;
    try {
      // The change-feed pool: local for forward/dolphin, the Supabase reverse-read pool for reverse.
      const feed = this.source();

      // Breaker first, so it trips even while applies are failing (e.g. no internet). Shared with
      // the no-drainer watchdog in index.ts, so both paths enforce one identical bound.
      if ((await enforceCaptureBound(feed, this.sink.name, this.opts.maxBacklog)).tripped) {
        this.breaker = true;
        return;
      }

      const { rows } = await feed.query<ChangeRow>(
        `SELECT id::text AS id, tbl, pk, op, changed_at::text AS changed_at_text
           FROM change_log
          WHERE sink = $1
          ORDER BY changed_at, id
          LIMIT $2`,
        [this.sink.name, this.opts.batchSize]
      );
      if (rows.length === 0) return;

      let deferred = 0;
      /** A row that failed for the FIRST time this cycle — the one case that always warns. */
      let newlyDeferred = 0;
      let lastError: string | null = null;
      /** Keys seen in this window, so a full-backlog cycle can prune vanished deferrals. */
      const seen = new Set<string>();
      // Changelog entries whose apply succeeded, cleared in ONE statement at the end of the cycle.
      // A per-row DELETE round trip doubled the cycle's trips to the feed DB, which for the reverse
      // sink is an internet RTT away — that made a full batch latency-bound rather than work-bound.
      const doneIds: string[] = [];
      const doneStamps: string[] = [];
      for (const r of rows) {
        if (this.stopped) break;
        const key = `${r.tbl}/${r.pk}`;
        seen.add(key);
        // Apply each row independently. A single failure (e.g. an FK-parent that has not
        // been replicated yet — coalescing can reorder a child ahead of its parent) must NOT
        // abort the whole cycle: leave the offending row in change_log for the next pass and
        // keep going, so the parent later in this batch still lands and the child succeeds next
        // cycle. Persistent failures keep the backlog growing → the circuit breaker is the backstop.
        try {
          if (r.op === 'D') await this.sink.remove(r.tbl, r.pk);
          else await this.sink.upsert(r.tbl, r.pk);
          doneIds.push(r.id);
          doneStamps.push(r.changed_at_text);
          this.deferrals.delete(key);
        } catch (rowErr) {
          deferred++;
          const attempts = (this.deferrals.get(key) ?? 0) + 1;
          if (attempts === 1) newlyDeferred++;
          this.deferrals.set(key, attempts);
          lastError = (rowErr as Error).message;
        }
      }

      // Prune only when this window covered the WHOLE backlog: a short read means there is nothing
      // beyond it, so a tracked key that did not appear is gone (applied by a sibling drainer, or
      // its change_log row deleted). A full window says nothing about what lies past it.
      if (rows.length < this.opts.batchSize) {
        for (const key of this.deferrals.keys()) if (!seen.has(key)) this.deferrals.delete(key);
      }

      // Version-guarded delete, batched: an entry is cleared only if it still carries the
      // changed_at we read it with, so a row re-touched mid-cycle survives and is reprocessed
      // (at-least-once — every sink.upsert is idempotent). unnest() zips the two arrays into the
      // (id, changed_at) pairs to match, keeping the guard identical to the per-row form.
      const applied = doneIds.length;
      if (applied > 0) {
        await feed.query(
          `DELETE FROM change_log c
             USING unnest($1::bigint[], $2::timestamp[]) AS d(id, changed_at)
            WHERE c.id = d.id AND c.changed_at = d.changed_at`,
          [doneIds, doneStamps]
        );
      }
      if (applied > 0) log.info(`[cdc:${this.sink.name}] replicated ${applied} change(s)`);
      if (deferred > 0) this.warnDeferred(deferred, newlyDeferred, lastError);

      // Only fast-chain when we made progress; if the whole window failed (destination down, or
      // parents sit beyond this window) waiting for the next interval tick avoids a hot retry loop.
      // unref() so this fire-and-forget chain never holds the event loop open during
      // graceful shutdown (matches every other timer in the codebase).
      if (applied > 0 && rows.length === this.opts.batchSize && !this.stopped)
        setTimeout(() => void this.drainOnce(), 50).unref();
    } catch (err) {
      log.warn(`[cdc:${this.sink.name}] drain cycle failed (will retry)`, { error: (err as Error).message });
    } finally {
      this.draining = false;
      // Replay a kick that arrived while this cycle was running (see drainNow). unref() so the
      // fire-and-forget chain never holds the event loop open during graceful shutdown.
      if (this.kickPending && !this.stopped && !this.breaker) {
        this.kickPending = false;
        setTimeout(() => void this.drainOnce(), 0).unref();
      }
    }
  }

  /**
   * Report a cycle's deferrals, at most once per DEFER_WARN_THROTTLE_MS unless something is failing
   * that was not failing before. The line names the worst offenders with their attempt counts, so a
   * permanently stuck row is identifiable from the log alone — `visits/46667 x3412` is the whole
   * diagnosis, where 3,412 copies of "deferred 3 change(s)" were not.
   */
  private warnDeferred(deferred: number, newlyDeferred: number, lastError: string | null): void {
    const now = Date.now();
    if (newlyDeferred === 0 && now - this.lastDeferWarnAt < DEFER_WARN_THROTTLE_MS) return;
    this.lastDeferWarnAt = now;
    const worst = [...this.deferrals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, DEFER_WARN_TOP_N)
      .map(([key, attempts]) => `${key} x${attempts}`)
      .join(', ');
    log.warn(`[cdc:${this.sink.name}] deferred ${deferred} change(s) (will retry) — worst: ${worst}`, {
      error: lastError,
    });
  }
}
