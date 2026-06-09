/**
 * Sync control + status endpoints for the unified CDC forward sync (PostgreSQL → the single
 * Supabase mirror). The reverse Supabase → local path and its webhook were retired along with the
 * curated portal projection; only the raw mirror remains.
 */

import { Router, type Request, type Response } from 'express';
import pg from 'pg';
import type { Pool } from 'pg';
import { z } from 'zod';
import { log } from '../utils/logger.js';
import { drainCdcNow } from '../services/sync/cdc/index.js';
import { stripSslMode, getReverseReadPool } from '../services/sync/cdc/supabase-pool.js';
import { getPgPool } from '../services/database/kysely.js';
import { validate } from '../middleware/validate.js';
import { promises as fs } from 'fs';
import path from 'path';

const { Pool: PgPool } = pg;

const router = Router();

// Strict Zod schema → `z.infer` SSoT (replacing the hand-written interface) and
// wired to `validate()` below (internal debug trigger; an unknown `direction`
// 400s instead of falling through).
const syncTriggerBody = z.object({
  direction: z.enum(['sql-to-postgres', 'postgres-to-sql']).optional(),
});
type SyncTriggerBody = z.infer<typeof syncTriggerBody>;

interface SyncState {
  lastSyncTimestamp: string | null;
}

/**
 * Manual sync trigger endpoint (for testing/debugging)
 * POST /api/sync/trigger
 */
router.post(
  '/api/sync/trigger',
  validate({ body: syncTriggerBody }),
  async (
    req: Request<unknown, unknown, SyncTriggerBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { direction } = req.body;

      log.info(`Manual sync triggered: ${direction || 'sql-to-postgres'}`);

      if (direction === 'sql-to-postgres' || !direction) {
        // Forward sync is the unified CDC; kick an immediate drain of all running sinks.
        drainCdcNow();
        res.json({ success: true, message: 'CDC drain triggered' });
      } else {
        res.status(400).json({ success: false, error: 'Invalid direction' });
      }
    } catch (error) {
      log.error('Manual sync error', { error: (error as Error).message });
      res.status(500).json({
        success: false,
        error: (error as Error).message
      });
    }
  }
);

/**
 * Sync drain notification webhook
 * POST /api/sync/queue-notify
 * Optional low-latency nudge to drain the forward CDC immediately (it also drains on an interval).
 */
router.post(
  '/api/sync/queue-notify',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      log.info('Received sync drain notification');

      // Forward sync is the unified CDC; kick an immediate drain.
      drainCdcNow();

      res.json({ success: true, message: 'CDC drain triggered' });
    } catch (error) {
      log.error('Queue notification error', { error: (error as Error).message });
      res.status(500).json({
        success: false,
        error: (error as Error).message
      });
    }
  }
);

/**
 * Sync status endpoint
 * GET /api/sync/status
 */
router.get(
  '/api/sync/status',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const stateFile = path.join(process.cwd(), 'data', 'sync-state.json');

      let state: SyncState = { lastSyncTimestamp: null };
      try {
        state = JSON.parse(await fs.readFile(stateFile, 'utf8'));
      } catch (err) {
        // No state file yet (ENOENT) → keep the default; re-throw anything else.
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }

      res.json({
        success: true,
        state: {
          lastSync: state.lastSyncTimestamp,
          isHealthy: state.lastSyncTimestamp
            ? Date.now() - new Date(state.lastSyncTimestamp).getTime() <
              30 * 60 * 1000 // within 30 min
            : false
        }
      });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  }
);

/**
 * Live reachability check for the single Supabase mirror (read-only; never mutates anything):
 * open a one-shot pg pool to the mirror and `SELECT 1`, then close it.
 *
 * A failed ping is a normal result (`reachable:false` + `error`), not a thrown error, so the
 * status endpoint always answers 200 even when Supabase is down.
 */
interface PingResult {
  reachable: boolean;
  latencyMs: number | null;
  error: string | null;
}

async function pingFailover(): Promise<PingResult> {
  const url = process.env.SUPABASE_FAILOVER_DB_URL ?? '';
  if (!url) return { reachable: false, latencyMs: null, error: 'not configured' };
  const start = Date.now();
  const pool = new PgPool({
    connectionString: stripSslMode(url), // match FailoverSink's TLS handling so the verdict is faithful
    ssl: { rejectUnauthorized: false }, // Supabase pooler terminates TLS; chain not validated here
    max: 1,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 1000,
  });
  pool.on('error', () => {}); // swallow pool-level errors; the query result is what we report
  try {
    await pool.query('SELECT 1');
    return { reachable: true, latencyMs: Date.now() - start, error: null };
  } catch (e) {
    return { reachable: false, latencyMs: Date.now() - start, error: (e as Error).message };
  } finally {
    await pool.end().catch(() => {});
  }
}

interface SinkControlRow {
  sink: string;
  enabled: boolean;
  stale: boolean;
  note: string | null;
  updated_at: string;
}

/**
 * Read a sink's runtime control flags + pending backlog from the DB that holds its feed. The forward
 * 'failover' feed lives LOCAL; the 'reverse' feed lives on Supabase (reverse-read pool). Returns the
 * control row (or undefined) + the change_log backlog. Never swallows — callers guard the reverse
 * read so a Supabase outage degrades gracefully instead of 500ing the status endpoint.
 */
async function readSinkStatus(
  pool: Pool,
  sink: string
): Promise<{ control: SinkControlRow | undefined; backlog: number }> {
  const control = (
    await pool.query<SinkControlRow>(
      `SELECT sink, enabled, stale, note, updated_at::text AS updated_at
         FROM cdc_sink_control
        WHERE sink = $1`,
      [sink]
    )
  ).rows[0];
  const backlog =
    (await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM change_log WHERE sink = $1`, [sink])).rows[0]
      ?.n ?? 0;
  return { control, backlog };
}

/**
 * Supabase sync status — read-only health view of the two CDC sinks against the single Supabase DB:
 * 'failover' (local → Supabase mirror; feed local) and 'reverse' (Supabase → local; feed on
 * Supabase). Combines each `cdc_sink_control` row + `change_log` backlog with one live reachability
 * ping (both sinks target the same Supabase DB). Always answers 200 — a Supabase outage degrades the
 * reverse card rather than failing the endpoint.
 * GET /api/sync/supabase-status
 */
router.get(
  '/api/sync/supabase-status',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const configured = !!process.env.SUPABASE_FAILOVER_DB_URL;

      // Forward feed is LOCAL — always readable.
      const fwd = await readSinkStatus(getPgPool(), 'failover');

      // Reverse feed lives ON Supabase — guard so an outage doesn't fail the whole status read.
      let rev: { control: SinkControlRow | undefined; backlog: number } = { control: undefined, backlog: 0 };
      let revError: string | null = null;
      if (configured) {
        try {
          rev = await readSinkStatus(getReverseReadPool(), 'reverse');
        } catch (e) {
          revError = (e as Error).message;
        }
      }

      const ping = await pingFailover();

      res.json({
        success: true,
        checkedAt: new Date().toISOString(),
        sinks: [
          {
            sink: 'failover',
            configured,
            envEnabled: process.env.FAILOVER_SYNC_ENABLED === 'true', // sync flag set at boot
            enabled: fwd.control?.enabled ?? false, // authoritative runtime capture flag the engine maintains
            stale: fwd.control?.stale ?? false,
            note: fwd.control?.note ?? null,
            updatedAt: fwd.control?.updated_at ?? null,
            backlog: fwd.backlog,
            reachable: configured ? ping.reachable : null,
            latencyMs: configured ? ping.latencyMs : null,
            error: configured ? ping.error : null,
          },
          {
            sink: 'reverse',
            configured,
            envEnabled: process.env.REVERSE_SYNC_ENABLED === 'true',
            enabled: rev.control?.enabled ?? false,
            stale: rev.control?.stale ?? false,
            note: rev.control?.note ?? (revError ? `status read failed: ${revError}` : null),
            updatedAt: rev.control?.updated_at ?? null,
            backlog: rev.backlog,
            reachable: configured ? ping.reachable : null,
            latencyMs: configured ? ping.latencyMs : null,
            error: configured ? (ping.error ?? revError) : null,
          },
        ],
      });
    } catch (error) {
      log.error('Supabase status error', { error: (error as Error).message });
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  }
);

export default router;
