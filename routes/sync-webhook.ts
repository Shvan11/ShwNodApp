/**
 * Sync control + status endpoints for the unified CDC forward sync (PostgreSQL → the single
 * Supabase mirror). The reverse Supabase → local path and its webhook were retired along with the
 * curated portal projection; only the raw mirror remains.
 *
 * MOUNTING: this router is mounted at `/` (index.ts) but self-prefixes `/api/...`, so it rides
 * `app.use('/api', authenticate)` — every route here already requires a staff session. The
 * `authorize(ADMIN_ROLES)` below adds the missing ROLE tier: kicking a drain is infrastructure
 * control, not a clinical or front-desk action.
 */

import { Router, type Request, type Response } from 'express';
import pg from 'pg';
import type { Pool } from 'pg';
import { z } from 'zod';
import { log } from '../utils/logger.js';
import { ErrorResponses } from '../utils/error-response.js';
import { drainCdcNow } from '../services/sync/cdc/index.js';
import { stripSslMode, getReverseReadPool } from '../services/sync/cdc/supabase-pool.js';
import { getPgPool } from '../services/database/kysely.js';
import { validate } from '../middleware/validate.js';
import { authorize } from '../middleware/auth.js';
import { ADMIN_ROLES } from '../shared/auth/roles.js';
import { promises as fs } from 'fs';
import path from 'path';
import sql from 'mssql';
import config from '../config/config.js';
import resourceManager from '../utils/resource-manager.js';

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
  '/trigger',
  authorize(ADMIN_ROLES),
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
      ErrorResponses.internalError(res, 'Failed to trigger the sync drain', error as Error);
    }
  }
);

/**
 * Sync drain notification webhook
 * POST /api/sync/queue-notify
 * Optional low-latency nudge to drain the forward CDC immediately (it also drains on an interval).
 */
router.post(
  '/queue-notify',
  authorize(ADMIN_ROLES),
  async (_req: Request, res: Response): Promise<void> => {
    try {
      log.info('Received sync drain notification');

      // Forward sync is the unified CDC; kick an immediate drain.
      drainCdcNow();

      res.json({ success: true, message: 'CDC drain triggered' });
    } catch (error) {
      log.error('Queue notification error', { error: (error as Error).message });
      ErrorResponses.internalError(res, 'Failed to trigger the sync drain', error as Error);
    }
  }
);

/**
 * Sync status endpoint
 * GET /api/sync/status
 */
router.get(
  '/status',
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
      log.error('Sync status error', { error: (error as Error).message });
      ErrorResponses.internalError(res, 'Failed to read sync status', error as Error);
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

/**
 * The ping pool is built ONCE and reused, not per request.
 *
 * The Settings sync panel polls `/supabase-status` every 10 seconds while it is
 * open, and this used to construct a `pg.Pool`, complete a full TCP connect + TLS
 * handshake to the Supabase pooler, and tear it all down again on every tick.
 * A pool with `idleTimeoutMillis` gives the same answer without that: the
 * connection stays warm across a burst of polls and pg drops it on its own once
 * the panel is closed, so an idle server holds nothing open. `max: 1` and the
 * 5 s connect timeout are unchanged, so a down Supabase still fails fast and
 * still reports `reachable:false` rather than throwing.
 */
let failoverPingPool: Pool | null = null;

function getFailoverPingPool(url: string): Pool {
  if (!failoverPingPool) {
    failoverPingPool = new PgPool({
      connectionString: stripSslMode(url), // match FailoverSink's TLS handling so the verdict is faithful
      ssl: { rejectUnauthorized: false }, // Supabase pooler terminates TLS; chain not validated here
      max: 1,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30_000,
    });
    failoverPingPool.on('error', () => {}); // swallow pool-level errors; the query result is what we report
    resourceManager.register('sync-status-failover-ping-pool', failoverPingPool, async (pool) => {
      await pool.end().catch(() => {});
    });
  }
  return failoverPingPool;
}

async function pingFailover(): Promise<PingResult> {
  const url = process.env.SUPABASE_FAILOVER_DB_URL ?? '';
  if (!url) return { reachable: false, latencyMs: null, error: 'not configured' };
  const start = Date.now();
  try {
    await getFailoverPingPool(url).query('SELECT 1');
    return { reachable: true, latencyMs: Date.now() - start, error: null };
  } catch (e) {
    return { reachable: false, latencyMs: Date.now() - start, error: (e as Error).message };
  }
}

/**
 * Live reachability check for the legacy Dolphin Imaging SQL Server (the 'dolphin' sink's write
 * target). Mirrors pingFailover: a one-shot short-timeout mssql connection + `SELECT 1`, then close.
 * A failed ping is a normal result, never a throw, so the status endpoint always answers 200 even
 * when the Dolphin server is offline. Builds its own short-lived pool (5 s timeout) rather than the
 * app's long-lived `getPool()` singleton (30 s connect timeout) so a down server can't stall the poll.
 */
let dolphinPingPool: sql.ConnectionPool | null = null;

async function pingDolphin(): Promise<PingResult> {
  const db = config.database;
  if (!db?.server) return { reachable: false, latencyMs: null, error: 'not configured' };
  const start = Date.now();
  try {
    // Reused across polls, like the Supabase pool above — the Settings panel ticks
    // every 10 s and this used to open and close a whole mssql ConnectionPool each
    // time. `min: 0` + a 30 s idle timeout means the connection is dropped once
    // polling stops, so a closed panel costs nothing. Still its own short-timeout
    // pool rather than the app's `getPool()` singleton (30 s connect timeout), so a
    // down Dolphin server can't stall the poll.
    if (!dolphinPingPool) {
      const pool = new sql.ConnectionPool({
        server: db.server,
        database: db.database,
        user: db.authentication.options.userName,
        password: db.authentication.options.password,
        options: {
          instanceName: db.options.instanceName,
          encrypt: false,
          trustServerCertificate: true,
          useUTC: false,
        },
        connectionTimeout: 5000,
        requestTimeout: 5000,
        pool: { max: 1, min: 0, idleTimeoutMillis: 30_000 },
      });
      pool.on('error', () => {}); // pool-level errors are reported through the query result
      dolphinPingPool = pool;
      resourceManager.register('sync-status-dolphin-ping-pool', pool, async (p) => {
        await p.close().catch(() => {});
      });
    }
    // `connect()` resolves immediately once the pool is already connected.
    if (!dolphinPingPool.connected && !dolphinPingPool.connecting) {
      await dolphinPingPool.connect();
    }
    await dolphinPingPool.request().query('SELECT 1');
    return { reachable: true, latencyMs: Date.now() - start, error: null };
  } catch (e) {
    // A failed connect leaves the pool unusable; drop it so the next poll rebuilds.
    if (dolphinPingPool && !dolphinPingPool.connected) {
      const dead = dolphinPingPool;
      dolphinPingPool = null;
      resourceManager.unregister('sync-status-dolphin-ping-pool');
      await dead.close().catch(() => {});
    }
    return { reachable: false, latencyMs: Date.now() - start, error: (e as Error).message };
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
  '/supabase-status',
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
      ErrorResponses.internalError(res, 'Failed to read Supabase sink status', error as Error);
    }
  }
);

/**
 * Dolphin sync status — read-only health view of the one-way 'dolphin' sink (native timepoints/images
 * → the legacy Dolphin Imaging SQL Server). Its feed lives LOCAL (same `cdc_sink_control` /
 * `change_log` as 'failover'), so the control row + backlog come from the local pool; the live
 * reachability ping targets the Dolphin mssql server. Always answers 200 — a Dolphin outage degrades
 * the card (reachable:false) rather than failing the endpoint. Shape matches /supabase-status so the
 * client card renders identically.
 * GET /api/sync/dolphin-status
 */
router.get(
  '/dolphin-status',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const configured = !!config.database?.server;

      // Dolphin feed is LOCAL — always readable.
      const dol = await readSinkStatus(getPgPool(), 'dolphin');

      const ping = configured ? await pingDolphin() : { reachable: false, latencyMs: null, error: 'not configured' };

      res.json({
        success: true,
        checkedAt: new Date().toISOString(),
        sinks: [
          {
            sink: 'dolphin',
            configured,
            envEnabled: process.env.DOLPHIN_SYNC_ENABLED === 'true', // sync flag set at boot
            enabled: dol.control?.enabled ?? false, // authoritative runtime capture flag the engine maintains
            stale: dol.control?.stale ?? false,
            note: dol.control?.note ?? null,
            updatedAt: dol.control?.updated_at ?? null,
            backlog: dol.backlog,
            reachable: configured ? ping.reachable : null,
            latencyMs: configured ? ping.latencyMs : null,
            error: configured ? ping.error : null,
          },
        ],
      });
    } catch (error) {
      log.error('Dolphin status error', { error: (error as Error).message });
      ErrorResponses.internalError(res, 'Failed to read Dolphin sink status', error as Error);
    }
  }
);

export default router;
