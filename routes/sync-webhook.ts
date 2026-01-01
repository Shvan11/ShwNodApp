/**
 * Webhook endpoint for Supabase → SQL Server sync
 * Receives webhooks when doctors edit data in the portal
 */

import { Router, type Request, type Response } from 'express';
import { postgresToSql, type WebhookPayload } from '../services/sync/sync-engine.js';
import { processAllPendingSyncs } from '../services/sync/unified-sync-processor.js';
import fs from 'fs';
import path from 'path';

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

      console.log('📥 Received Supabase webhook:', {
        table: payload.table,
        type: payload.type,
        timestamp: new Date().toISOString()
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
      console.error('❌ Webhook processing error:', error);
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

      console.log(`🔄 Manual sync triggered: ${direction || 'sql-to-postgres'}`);

      if (direction === 'sql-to-postgres' || !direction) {
        // Use new unified sync processor (queue-based)
        const result = await processAllPendingSyncs();
        res.json({ success: true, message: 'Sync completed', result });
      } else {
        res.status(400).json({ success: false, error: 'Invalid direction' });
      }
    } catch (error) {
      console.error('❌ Manual sync error:', error);
      res.status(500).json({
        success: false,
        error: (error as Error).message
      });
    }
  }
);

/**
 * SQL Server queue notification webhook
 * POST /api/sync/queue-notify
 * Called by SQL Server when new items are added to SyncQueue
 */
router.post(
  '/api/sync/queue-notify',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      console.log('📥 Received queue notification from SQL Server');

      // Import queue processor dynamically
      const queueProcessor = await import(
        '../services/sync/queue-processor.js'
      );

      // Process queue immediately
      queueProcessor.default.processQueueOnce();

      res.json({ success: true, message: 'Queue processing triggered' });
    } catch (error) {
      console.error('❌ Queue notification error:', error);
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
      if (fs.existsSync(stateFile)) {
        state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
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

export default router;
