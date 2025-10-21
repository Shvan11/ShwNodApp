#!/usr/bin/env node
/**
 * Unified Sync Script
 * Processes all pending records in SyncQueue and syncs to Supabase
 *
 * Usage:
 *   node scripts/sync.js
 */

import { processAllPendingSyncs } from '../services/sync/unified-sync-processor.js';

processAllPendingSyncs()
  .then(() => {
    console.log('Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Sync failed:', error);
    process.exit(1);
  });
