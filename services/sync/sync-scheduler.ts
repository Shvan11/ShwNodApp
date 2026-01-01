/**
 * @deprecated This scheduler is deprecated in favor of unified-sync-processor.js
 *
 * OLD Scheduled Sync Service
 * - This used the old direct-query sync method
 * - Now replaced by SyncQueue + triggers + unified-sync-processor
 * - To run periodic syncs, schedule: node scripts/sync.js (uses unified processor)
 */

import { sqlToPostgres } from './sync-engine.js';
import fs from 'fs/promises';
import path from 'path';
import { log } from '../../utils/logger.js';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Sync state stored in file
 */
interface SyncState {
  lastSyncTimestamp: string | null;
  lastSyncDate?: string;
}

/**
 * Sync results from engine
 */
interface SyncResults {
  sets: { synced: number };
  batches: { synced: number };
  payments: { synced: number };
}

// =============================================================================
// CONSTANTS
// =============================================================================

const SYNC_STATE_FILE = path.join(process.cwd(), 'data', 'sync-state.json');
const SYNC_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

// =============================================================================
// SCHEDULER CLASS
// =============================================================================

class SyncScheduler {
  private isRunning: boolean;
  private lastSyncTimestamp: Date | null;
  private syncInterval: NodeJS.Timeout | null;

  constructor() {
    this.isRunning = false;
    this.lastSyncTimestamp = null;
    this.syncInterval = null;
    this.loadState();
  }

  /**
   * Load last sync timestamp from file
   * Async version to prevent blocking the event loop
   */
  async loadState(): Promise<void> {
    try {
      const data = await fs.readFile(SYNC_STATE_FILE, 'utf8');
      const state: SyncState = JSON.parse(data);
      this.lastSyncTimestamp = state.lastSyncTimestamp ? new Date(state.lastSyncTimestamp) : null;
      log.info(`📂 Loaded sync state. Last sync: ${this.lastSyncTimestamp || 'Never'}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.warn('Could not load sync state', { error: (error as Error).message });
      }
    }
  }

  /**
   * Save last sync timestamp to file
   * Async version to prevent blocking the event loop
   */
  async saveState(): Promise<void> {
    try {
      const dir = path.dirname(SYNC_STATE_FILE);
      // Ensure directory exists (recursive creates parents if needed)
      await fs.mkdir(dir, { recursive: true });

      const state: SyncState = {
        lastSyncTimestamp: this.lastSyncTimestamp?.toISOString() || null,
        lastSyncDate: new Date().toISOString(),
      };

      await fs.writeFile(SYNC_STATE_FILE, JSON.stringify(state, null, 2));
    } catch (error) {
      log.error('❌ Could not save sync state:', (error as Error).message);
    }
  }

  /**
   * Run a single sync cycle
   */
  async runSync(): Promise<SyncResults | undefined> {
    if (this.isRunning) {
      log.info('⚠️  Sync already running, skipping this cycle');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      log.info(`\n⏰ Scheduled sync triggered at ${new Date().toLocaleString()}`);

      // Run incremental sync (only changes since last sync)
      const results = await sqlToPostgres.syncToPostgres(this.lastSyncTimestamp);

      // Update last sync timestamp
      this.lastSyncTimestamp = new Date();
      await this.saveState();

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      log.info(`⏱️  Sync completed in ${duration}s\n`);

      return results;
    } catch (error) {
      log.error('❌ Sync failed:', error);
      // Don't update lastSyncTimestamp on failure - retry will get the same data
      return undefined;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Start scheduled sync
   */
  start(): void {
    log.info(`🚀 Starting sync scheduler (every ${SYNC_INTERVAL_MS / 1000 / 60} minutes)`);

    // Run immediately on start
    this.runSync();

    // Then schedule periodic runs
    this.syncInterval = setInterval(() => {
      this.runSync();
    }, SYNC_INTERVAL_MS);

    log.info('✅ Sync scheduler started\n');
  }

  /**
   * Stop scheduled sync
   */
  stop(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      log.info('🛑 Sync scheduler stopped');
    }
  }

  /**
   * Force a sync now (manual trigger)
   */
  async forceSync(): Promise<SyncResults | undefined> {
    log.info('🔄 Manual sync triggered');
    return await this.runSync();
  }
}

// Create singleton instance
const scheduler = new SyncScheduler();

// Handle graceful shutdown
process.on('SIGINT', () => {
  log.info('\n🛑 Shutting down sync scheduler...');
  scheduler.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  log.info('\n🛑 Shutting down sync scheduler...');
  scheduler.stop();
  process.exit(0);
});

export default scheduler;
