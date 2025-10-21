/**
 * @deprecated This scheduler is deprecated in favor of unified-sync-processor.js
 *
 * OLD Scheduled Sync Service
 * - This used the old direct-query sync method
 * - Now replaced by SyncQueue + triggers + unified-sync-processor
 * - To run periodic syncs, schedule: node scripts/sync.js (uses unified processor)
 */

import { sqlToPostgres } from './sync-engine.js';
import fs from 'fs';
import path from 'path';

const SYNC_STATE_FILE = path.join(process.cwd(), 'data', 'sync-state.json');
const SYNC_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

class SyncScheduler {
    constructor() {
        this.isRunning = false;
        this.lastSyncTimestamp = null;
        this.syncInterval = null;
        this.loadState();
    }

    /**
     * Load last sync timestamp from file
     */
    loadState() {
        try {
            if (fs.existsSync(SYNC_STATE_FILE)) {
                const state = JSON.parse(fs.readFileSync(SYNC_STATE_FILE, 'utf8'));
                this.lastSyncTimestamp = state.lastSyncTimestamp ? new Date(state.lastSyncTimestamp) : null;
                console.log(`📂 Loaded sync state. Last sync: ${this.lastSyncTimestamp || 'Never'}`);
            }
        } catch (error) {
            console.warn('⚠️  Could not load sync state:', error.message);
        }
    }

    /**
     * Save last sync timestamp to file
     */
    saveState() {
        try {
            const dir = path.dirname(SYNC_STATE_FILE);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            fs.writeFileSync(
                SYNC_STATE_FILE,
                JSON.stringify({
                    lastSyncTimestamp: this.lastSyncTimestamp,
                    lastSyncDate: new Date().toISOString()
                }, null, 2)
            );
        } catch (error) {
            console.error('❌ Could not save sync state:', error.message);
        }
    }

    /**
     * Run a single sync cycle
     */
    async runSync() {
        if (this.isRunning) {
            console.log('⚠️  Sync already running, skipping this cycle');
            return;
        }

        this.isRunning = true;
        const startTime = Date.now();

        try {
            console.log(`\n⏰ Scheduled sync triggered at ${new Date().toLocaleString()}`);

            // Run incremental sync (only changes since last sync)
            const results = await sqlToPostgres.syncToPostgres(this.lastSyncTimestamp);

            // Update last sync timestamp
            this.lastSyncTimestamp = new Date();
            this.saveState();

            const duration = ((Date.now() - startTime) / 1000).toFixed(2);
            console.log(`⏱️  Sync completed in ${duration}s\n`);

            return results;

        } catch (error) {
            console.error('❌ Sync failed:', error);
            // Don't update lastSyncTimestamp on failure - retry will get the same data
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Start scheduled sync
     */
    start() {
        console.log(`🚀 Starting sync scheduler (every ${SYNC_INTERVAL_MS / 1000 / 60} minutes)`);

        // Run immediately on start
        this.runSync();

        // Then schedule periodic runs
        this.syncInterval = setInterval(() => {
            this.runSync();
        }, SYNC_INTERVAL_MS);

        console.log('✅ Sync scheduler started\n');
    }

    /**
     * Stop scheduled sync
     */
    stop() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
            console.log('🛑 Sync scheduler stopped');
        }
    }

    /**
     * Force a sync now (manual trigger)
     */
    async forceSync() {
        console.log('🔄 Manual sync triggered');
        return await this.runSync();
    }
}

// Create singleton instance
const scheduler = new SyncScheduler();

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down sync scheduler...');
    scheduler.stop();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down sync scheduler...');
    scheduler.stop();
    process.exit(0);
});

export default scheduler;
