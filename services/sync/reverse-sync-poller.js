/**
 * Reverse Sync Poller (Supabase → SQL Server)
 * Catches up on missed changes when server was offline
 * Works alongside the real-time webhook
 *
 * RESOURCE-FRIENDLY DESIGN:
 * - Only polls when needed (startup + hourly)
 * - Uses timestamp-based queries (indexed columns)
 * - Configurable intervals via environment variables
 * - Graceful error handling (non-blocking)
 * - Smart state persistence to avoid duplicate syncs
 */

import { createClient } from '@supabase/supabase-js';
import { postgresToSql } from './sync-engine.js';
import fs from 'fs';
import path from 'path';

// Initialize Supabase client (lazy - only if credentials exist)
let supabase = null;
function getSupabaseClient() {
  if (!supabase && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }
  return supabase;
}

const STATE_FILE = path.join(process.cwd(), 'data', 'reverse-sync-state.json');

// Configuration from environment variables
const CONFIG = {
  // Polling interval in minutes (default: 60 minutes = 1 hour)
  POLL_INTERVAL_MINUTES: parseInt(process.env.REVERSE_SYNC_INTERVAL_MINUTES || '60'),

  // Lookback window on first startup (hours) - how far back to check
  INITIAL_LOOKBACK_HOURS: parseInt(process.env.REVERSE_SYNC_LOOKBACK_HOURS || '24'),

  // Maximum records to sync per poll (prevents memory issues)
  MAX_RECORDS_PER_POLL: parseInt(process.env.REVERSE_SYNC_MAX_RECORDS || '500'),

  // Enable/disable reverse sync
  ENABLED: process.env.REVERSE_SYNC_ENABLED !== 'false'
};

/**
 * Load last sync timestamps
 */
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      console.log('📖 Loaded reverse sync state:', {
        lastNotesSync: state.lastNotesSync,
        lastBatchesSync: state.lastBatchesSync,
        lastPollTime: state.lastPollTime
      });
      return state;
    }
  } catch (error) {
    console.warn('⚠️  Could not load reverse sync state:', error.message);
  }

  // Default: sync from configured lookback window
  const lookbackMs = CONFIG.INITIAL_LOOKBACK_HOURS * 60 * 60 * 1000;
  const lookbackTime = new Date(Date.now() - lookbackMs).toISOString();

  console.log(`📖 No state file found - using ${CONFIG.INITIAL_LOOKBACK_HOURS}h lookback: ${lookbackTime}`);

  return {
    lastNotesSync: lookbackTime,
    lastBatchesSync: lookbackTime
  };
}

/**
 * Save sync timestamps
 */
function saveState(state) {
  try {
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    console.log('💾 Saved reverse sync state');
  } catch (error) {
    console.error('❌ Could not save reverse sync state:', error.message);
  }
}

/**
 * Poll for new/updated notes (RESOURCE-OPTIMIZED)
 */
async function pollNotes(sinceTimestamp) {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Supabase client not configured');
  }

  console.log(`🔍 Polling for notes since ${new Date(sinceTimestamp).toLocaleString()}`);

  // Get notes created OR edited since timestamp
  // LIMIT to prevent memory overflow on large backlogs
  const { data: notes, error } = await client
    .from('aligner_notes')
    .select('*')
    .or(`created_at.gt.${sinceTimestamp},edited_at.gt.${sinceTimestamp}`)
    .order('created_at', { ascending: true })
    .limit(CONFIG.MAX_RECORDS_PER_POLL);

  if (error) throw error;

  if (!notes || notes.length === 0) {
    console.log('   ✓ No new notes found');
    return 0;
  }

  console.log(`   📝 Found ${notes.length} note(s) to sync`);

  let synced = 0;
  let errors = 0;

  for (const note of notes) {
    try {
      await postgresToSql.syncNoteToSqlServer(note);
      synced++;
    } catch (error) {
      errors++;
      console.error(`   ❌ Failed to sync note ${note.note_id}:`, error.message);
    }
  }

  console.log(`   ✅ Synced ${synced}/${notes.length} notes (${errors} errors)`);

  if (notes.length >= CONFIG.MAX_RECORDS_PER_POLL) {
    console.log(`   ⚠️  Hit max record limit (${CONFIG.MAX_RECORDS_PER_POLL}) - more records may exist`);
  }

  return synced;
}

/**
 * Poll for updated batch days (RESOURCE-OPTIMIZED)
 */
async function pollBatchDays(sinceTimestamp) {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Supabase client not configured');
  }

  console.log(`🔍 Polling for batch updates since ${new Date(sinceTimestamp).toLocaleString()}`);

  const { data: batches, error } = await client
    .from('aligner_batches')
    .select('aligner_batch_id, days, updated_at, created_at')
    .gt('updated_at', sinceTimestamp)
    .order('updated_at', { ascending: true })
    .limit(CONFIG.MAX_RECORDS_PER_POLL);

  if (error) throw error;

  if (!batches || batches.length === 0) {
    console.log('   ✓ No batch updates found');
    return 0;
  }

  // Filter for only edited batches (updated_at > created_at means doctor edited)
  const editedBatches = batches.filter(b => {
    if (!b.updated_at || !b.created_at) return true; // Sync if timestamps missing
    return new Date(b.updated_at) > new Date(b.created_at);
  });

  if (editedBatches.length === 0) {
    console.log(`   ✓ No edited batches (${batches.length} total updates were create-only)`);
    return 0;
  }

  console.log(`   📦 Found ${editedBatches.length} edited batch(es) (${batches.length} total)`);

  let synced = 0;
  let errors = 0;

  for (const batch of editedBatches) {
    try {
      await postgresToSql.syncBatchDaysToSqlServer(batch);
      synced++;
    } catch (error) {
      errors++;
      console.error(`   ❌ Failed to sync batch ${batch.aligner_batch_id}:`, error.message);
    }
  }

  console.log(`   ✅ Synced ${synced}/${editedBatches.length} batch updates (${errors} errors)`);

  if (batches.length >= CONFIG.MAX_RECORDS_PER_POLL) {
    console.log(`   ⚠️  Hit max record limit (${CONFIG.MAX_RECORDS_PER_POLL}) - more records may exist`);
  }

  return synced;
}

/**
 * Run full poll cycle
 */
export async function pollForMissedChanges() {
  // Check if sync is enabled
  if (!CONFIG.ENABLED) {
    console.log('⏭️  Reverse sync disabled via REVERSE_SYNC_ENABLED=false');
    return { notesSynced: 0, batchesSynced: 0, totalSynced: 0, skipped: true };
  }

  // Check if Supabase is configured
  if (!getSupabaseClient()) {
    console.log('⏭️  Supabase not configured - skipping reverse sync');
    return { notesSynced: 0, batchesSynced: 0, totalSynced: 0, skipped: true };
  }

  console.log('🔄 Starting reverse sync poll (Supabase → SQL Server)');
  const startTime = Date.now();

  try {
    const state = loadState();

    const notesSynced = await pollNotes(state.lastNotesSync);
    const batchesSynced = await pollBatchDays(state.lastBatchesSync);

    // Update state with current time
    const now = new Date().toISOString();
    saveState({
      lastNotesSync: now,
      lastBatchesSync: now,
      lastPollTime: now
    });

    const duration = Date.now() - startTime;
    console.log(`✅ Reverse sync complete: ${notesSynced} notes, ${batchesSynced} batches (${duration}ms)`);

    return {
      notesSynced,
      batchesSynced,
      totalSynced: notesSynced + batchesSynced,
      duration
    };

  } catch (error) {
    console.error('❌ Reverse sync failed:', error.message);
    // Don't throw - return error info instead (non-blocking)
    return {
      notesSynced: 0,
      batchesSynced: 0,
      totalSynced: 0,
      error: error.message
    };
  }
}

/**
 * Start periodic polling (RESOURCE-FRIENDLY)
 */
let pollingIntervalId = null;

export function startPeriodicPolling(intervalMinutes = null) {
  // Use configured interval if not specified
  const interval = intervalMinutes || CONFIG.POLL_INTERVAL_MINUTES;

  if (!CONFIG.ENABLED) {
    console.log('⏭️  Periodic reverse sync disabled via REVERSE_SYNC_ENABLED=false');
    return null;
  }

  if (!getSupabaseClient()) {
    console.log('⏭️  Supabase not configured - periodic reverse sync disabled');
    return null;
  }

  console.log(`⏰ Starting periodic reverse sync (every ${interval} minutes)`);
  console.log(`   Lookback window: ${CONFIG.INITIAL_LOOKBACK_HOURS}h`);
  console.log(`   Max records per poll: ${CONFIG.MAX_RECORDS_PER_POLL}`);

  // Run immediately on start (startup sync)
  console.log('🚀 Running initial reverse sync on startup...');
  pollForMissedChanges().then(result => {
    if (result.totalSynced > 0) {
      console.log(`🎉 Startup sync recovered ${result.totalSynced} missed changes`);
    } else if (!result.skipped && !result.error) {
      console.log('✓ Startup sync complete - no missed changes');
    }
  }).catch(err => {
    console.error('⚠️  Initial reverse sync failed (will retry hourly):', err.message);
  });

  // Then run periodically
  const intervalMs = interval * 60 * 1000;
  pollingIntervalId = setInterval(() => {
    pollForMissedChanges(); // Fire and forget - errors logged internally
  }, intervalMs);

  return pollingIntervalId;
}

/**
 * Stop periodic polling (for graceful shutdown)
 */
export function stopPeriodicPolling() {
  if (pollingIntervalId) {
    console.log('⏸️  Stopping periodic reverse sync');
    clearInterval(pollingIntervalId);
    pollingIntervalId = null;
  }
}

/**
 * Get current configuration
 */
export function getConfig() {
  return { ...CONFIG };
}
