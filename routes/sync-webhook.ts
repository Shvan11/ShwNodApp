/**
 * Webhook endpoint for Supabase → SQL Server sync
 * Receives webhooks when doctors edit data in the portal
 */

import { Router, type Request, type Response } from 'express';
import pg from 'pg';
import { log } from '../utils/logger.js';
import { postgresToSql, type WebhookPayload } from '../services/sync/sync-engine.js';
import { drainCdcNow } from '../services/sync/cdc/index.js';
import { stripSslMode } from '../services/sync/cdc/failover-sink.js';
import { getPgPool } from '../services/database/kysely.js';
import { promises as fs } from 'fs';
import path from 'path';

const { Pool: PgPool } = pg;

const router = Router();

interface SyncTriggerBody {
  direction?: 'sql-to-postgres' | 'postgres-to-sql';
}

interface SyncState {
  lastSyncTimestamp: string | null;
}

/**
 * Supabase webhook endpoint
 * POST /api/sync/webhook
 */
router.post(
  '/api/sync/webhook',
  async (
    req: Request<unknown, unknown, WebhookPayload>,
    res: Response
  ): Promise<void> => {
    try {
      const payload = req.body;

      log.info('Received Supabase webhook', {
        table: payload.table,
        type: payload.type
      });

      // Verify webhook signature (optional but recommended)
      const webhookSecret = process.env.SUPABASE_WEBHOOK_SECRET;
      if (webhookSecret) {
        // TODO: Implement signature verification
        // For now, we'll trust the webhook (fine for internal network)
      }

      // Process the webhook
      const result = await postgresToSql.handleWebhook(payload);

      if (result.success) {
        res.json({ success: true, message: 'Webhook processed successfully' });
      } else {
        res.status(500).json({ success: false, error: result.error });
      }
    } catch (error) {
      log.error('Webhook processing error', { error: (error as Error).message });
      res.status(500).json({
        success: false,
        error: 'Internal server error processing webhook'
      });
    }
  }
);

/**
 * Manual sync trigger endpoint (for testing/debugging)
 * POST /api/sync/trigger
 */
router.post(
  '/api/sync/trigger',
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
 * Live reachability check for the two Supabase sinks (read-only; never mutates anything).
 *
 *  - portal:   GET the PostgREST root (`/rest/v1/`) with the service-role key — 200 ⇒ reachable.
 *  - failover: open a one-shot pg pool to the failover replica and `SELECT 1`, then close it.
 *
 * A failed ping is a normal result (`reachable:false` + `error`), not a thrown error, so the
 * status endpoint always answers 200 even when Supabase is down.
 */
interface PingResult {
  reachable: boolean;
  latencyMs: number | null;
  error: string | null;
}

async function pingPortal(): Promise<PingResult> {
  const url = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url || !key) return { reachable: false, latencyMs: null, error: 'not configured' };
  const start = Date.now();
  try {
    const res = await fetch(`${url}/rest/v1/`, {
      method: 'GET',
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5000),
    });
    const latencyMs = Date.now() - start;
    return res.ok
      ? { reachable: true, latencyMs, error: null }
      : { reachable: false, latencyMs, error: `HTTP ${res.status}` };
  } catch (e) {
    return { reachable: false, latencyMs: Date.now() - start, error: (e as Error).message };
  }
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
 * Supabase sync status — read-only health view of the two Supabase CDC sinks (portal + failover).
 * Combines the `cdc_sink_control` flags + `change_log` backlog with a live reachability ping.
 * GET /api/sync/supabase-status
 */
router.get(
  '/api/sync/supabase-status',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const local = getPgPool();

      const control = (
        await local.query<SinkControlRow>(
          `SELECT sink, enabled, stale, note, updated_at::text AS updated_at
             FROM cdc_sink_control
            WHERE sink IN ('portal', 'failover')`
        )
      ).rows;
      const controlBySink = new Map(control.map((r) => [r.sink, r]));

      const backlog = (
        await local.query<{ sink: string; n: number }>(
          `SELECT sink, count(*)::int AS n
             FROM change_log
            WHERE sink IN ('portal', 'failover')
            GROUP BY sink`
        )
      ).rows;
      const backlogBySink = new Map(backlog.map((r) => [r.sink, r.n]));

      const [portalPing, failoverPing] = await Promise.all([pingPortal(), pingFailover()]);

      const build = (sink: 'portal' | 'failover', ping: PingResult, configured: boolean, envEnabled: boolean) => {
        const c = controlBySink.get(sink);
        return {
          sink,
          configured,
          envEnabled, // sync flag set at boot (SYNC_ENABLED / FAILOVER_SYNC_ENABLED)
          enabled: c?.enabled ?? false, // authoritative runtime capture flag the engine maintains
          stale: c?.stale ?? false,
          note: c?.note ?? null,
          updatedAt: c?.updated_at ?? null,
          backlog: backlogBySink.get(sink) ?? 0,
          reachable: configured ? ping.reachable : null,
          latencyMs: configured ? ping.latencyMs : null,
          error: configured ? ping.error : null,
        };
      };

      const portalConfigured = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
      const failoverConfigured = !!process.env.SUPABASE_FAILOVER_DB_URL;

      res.json({
        success: true,
        checkedAt: new Date().toISOString(),
        sinks: [
          build('portal', portalPing, portalConfigured, process.env.SYNC_ENABLED === 'true'),
          build('failover', failoverPing, failoverConfigured, process.env.FAILOVER_SYNC_ENABLED === 'true'),
        ],
      });
    } catch (error) {
      log.error('Supabase status error', { error: (error as Error).message });
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  }
);

export default router;
