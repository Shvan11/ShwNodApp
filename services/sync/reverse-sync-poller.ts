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

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { postgresToSql } from './sync-engine.js';
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
  lastNotesSync: string;
  lastBatchesSync: string;
  lastPollTime?: string;
}

/**
 * Poll result
 */
export interface PollResult {
  notesSynced: number;
  batchesSynced: number;
  totalSynced: number;
  duration?: number;
  skipped?: boolean;
  error?: string;
}

/**
 * Configuration options
 */
interface SyncConfig {
  POLL_INTERVAL_MINUTES: number;
  INITIAL_LOOKBACK_HOURS: number;
  MAX_RECORDS_PER_POLL: number;
  ENABLED: boolean;
}

/**
 * Aligner note record from Supabase
 */
interface AlignerNote {
  note_id: number;
  aligner_set_id: number;
  note_type: string;
  note_text: string;
  created_at: string;
  edited_at: string | null;
  is_edited: boolean;
  is_read?: boolean;
}

/**
 * Aligner batch record from Supabase
 */
interface AlignerBatch {
  aligner_batch_id: number;
  days: number;
  updated_at: string | null;
  created_at: string | null;
}

// =============================================================================
// SUPABASE CLIENT
// =============================================================================

// Initialize Supabase client (lazy - only if credentials exist)
let supabase: SupabaseClient | null = null;
function getSupabaseClient(): SupabaseClient | null {
  if (!supabase && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  }
  return supabase;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

const STATE_FILE = path.join(process.cwd(), 'data', 'reverse-sync-state.json');

// Configuration from environment variables
const CONFIG: SyncConfig = {
  // Polling interval in minutes (default: 60 minutes = 1 hour)
  POLL_INTERVAL_MINUTES: parseInt(process.env.REVERSE_SYNC_INTERVAL_MINUTES || '60'),

  // Lookback window on first startup (hours) - how far back to check
  INITIAL_LOOKBACK_HOURS: parseInt(process.env.REVERSE_SYNC_LOOKBACK_HOURS || '24'),

  // Maximum records to sync per poll (prevents memory issues)
  MAX_RECORDS_PER_POLL: parseInt(process.env.REVERSE_SYNC_MAX_RECORDS || '500'),

  // Enable/disable reverse sync
  ENABLED: process.env.REVERSE_SYNC_ENABLED !== 'false',
};

// =============================================================================
// STATE MANAGEMENT
// =============================================================================

/**
 * Load last sync timestamps
 * Async version to prevent blocking the event loop
 */
async function loadState(): Promise<SyncState> {
  try {
    const data = await fs.readFile(STATE_FILE, 'utf8');
    const state: SyncState = JSON.parse(data);
    log.info('📖 Loaded reverse sync state:', {
      lastNotesSync: state.lastNotesSync,
      lastBatchesSync: state.lastBatchesSync,
      lastPollTime: state.lastPollTime,
    });
    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn('⚠️  Could not load reverse sync state:', (error as Error).message);
    }
  }

  // Default: sync from configured lookback window
  const lookbackMs = CONFIG.INITIAL_LOOKBACK_HOURS * 60 * 60 * 1000;
  const lookbackTime = new Date(Date.now() - lookbackMs).toISOString();

  log.info(
    `📖 No state file found - using ${CONFIG.INITIAL_LOOKBACK_HOURS}h lookback: ${lookbackTime}`
  );

  return {
    lastNotesSync: lookbackTime,
    lastBatchesSync: lookbackTime,
  };
}

/**
 * Save sync timestamps
 * Async version to prevent blocking the event loop
 */
async function saveState(state: SyncState): Promise<void> {
  try {
    const dir = path.dirname(STATE_FILE);
    // Ensure directory exists (recursive creates parents if needed)
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
    log.info('💾 Saved reverse sync state');
  } catch (error) {
    log.error('❌ Could not save reverse sync state:', (error as Error).message);
  }
}

// =============================================================================
// POLLING FUNCTIONS
// =============================================================================

/**
 * Poll for new/updated notes (RESOURCE-OPTIMIZED)
 */
async function pollNotes(sinceTimestamp: string): Promise<number> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Supabase client not configured');
  }

  log.info(`🔍 Polling for notes since ${new Date(sinceTimestamp).toLocaleString()}`);

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
    log.info('   ✓ No new notes found');
    return 0;
  }

  log.info(`   📝 Found ${notes.length} note(s) to sync`);

  let synced = 0;
  let errors = 0;

  for (const note of notes as AlignerNote[]) {
    try {
      // Convert string dates to Date objects for SQL Server compatibility
      const noteWithDates = {
        ...note,
        created_at: new Date(note.created_at),
        edited_at: note.edited_at ? new Date(note.edited_at) : null,
      };
      await postgresToSql.syncNoteToSqlServer(noteWithDates);
      synced++;
    } catch (error) {
      errors++;
      log.error(`   ❌ Failed to sync note ${note.note_id}:`, (error as Error).message);
    }
  }

  log.info(`   ✅ Synced ${synced}/${notes.length} notes (${errors} errors)`);

  if (notes.length >= CONFIG.MAX_RECORDS_PER_POLL) {
    log.info(
      `   ⚠️  Hit max record limit (${CONFIG.MAX_RECORDS_PER_POLL}) - more records may exist`
    );
  }

  return synced;
}

/**
 * Poll for updated batch days (RESOURCE-OPTIMIZED)
 */
async function pollBatchDays(sinceTimestamp: string): Promise<number> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Supabase client not configured');
  }

  log.info(`🔍 Polling for batch updates since ${new Date(sinceTimestamp).toLocaleString()}`);

  const { data: batches, error } = await client
    .from('aligner_batches')
    .select('aligner_batch_id, days, updated_at, created_at')
    .gt('updated_at', sinceTimestamp)
    .order('updated_at', { ascending: true })
    .limit(CONFIG.MAX_RECORDS_PER_POLL);

  if (error) throw error;

  if (!batches || batches.length === 0) {
    log.info('   ✓ No batch updates found');
    return 0;
  }

  // Filter for only edited batches (updated_at > created_at means doctor edited)
  const editedBatches = (batches as AlignerBatch[]).filter((b) => {
    if (!b.updated_at || !b.created_at) return true; // Sync if timestamps missing
    return new Date(b.updated_at) > new Date(b.created_at);
  });

  if (editedBatches.length === 0) {
    log.info(`   ✓ No edited batches (${batches.length} total updates were create-only)`);
    return 0;
  }

  log.info(`   📦 Found ${editedBatches.length} edited batch(es) (${batches.length} total)`);

  let synced = 0;
  let errors = 0;

  for (const batch of editedBatches) {
    try {
      await postgresToSql.syncBatchDaysToSqlServer(batch);
      synced++;
    } catch (error) {
      errors++;
      log.error(
        `   ❌ Failed to sync batch ${batch.aligner_batch_id}:`,
        (error as Error).message
      );
    }
  }

  log.info(`   ✅ Synced ${synced}/${editedBatches.length} batch updates (${errors} errors)`);

  if (batches.length >= CONFIG.MAX_RECORDS_PER_POLL) {
    log.info(
      `   ⚠️  Hit max record limit (${CONFIG.MAX_RECORDS_PER_POLL}) - more records may exist`
    );
  }

  return synced;
}

/**
 * Run full poll cycle
 */
export async function pollForMissedChanges(): Promise<PollResult> {
  // Check if sync is enabled
  if (!CONFIG.ENABLED) {
    log.info('⏭️  Reverse sync disabled via REVERSE_SYNC_ENABLED=false');
    return { notesSynced: 0, batchesSynced: 0, totalSynced: 0, skipped: true };
  }

  // Check if Supabase is configured
  if (!getSupabaseClient()) {
    log.info('⏭️  Supabase not configured - skipping reverse sync');
    return { notesSynced: 0, batchesSynced: 0, totalSynced: 0, skipped: true };
  }

  log.info('🔄 Starting reverse sync poll (Supabase → SQL Server)');
  const startTime = Date.now();

  try {
    const state = await loadState();

    const notesSynced = await pollNotes(state.lastNotesSync);
    const batchesSynced = await pollBatchDays(state.lastBatchesSync);

    // Update state with current time
    const now = new Date().toISOString();
    await saveState({
      lastNotesSync: now,
      lastBatchesSync: now,
      lastPollTime: now,
    });

    const duration = Date.now() - startTime;
    log.info(
      `✅ Reverse sync complete: ${notesSynced} notes, ${batchesSynced} batches (${duration}ms)`
    );

    return {
      notesSynced,
      batchesSynced,
      totalSynced: notesSynced + batchesSynced,
      duration,
    };
  } catch (error) {
    log.error('❌ Reverse sync failed:', (error as Error).message);
    // Don't throw - return error info instead (non-blocking)
    return {
      notesSynced: 0,
      batchesSynced: 0,
      totalSynced: 0,
      error: (error as Error).message,
    };
  }
}

// =============================================================================
// PERIODIC POLLING
// =============================================================================

/**
 * Start periodic polling (RESOURCE-FRIENDLY)
 */
let pollingIntervalId: NodeJS.Timeout | null = null;

export function startPeriodicPolling(intervalMinutes: number | null = null): NodeJS.Timeout | null {
  // Use configured interval if not specified
  const interval = intervalMinutes || CONFIG.POLL_INTERVAL_MINUTES;

  if (!CONFIG.ENABLED) {
    log.info('⏭️  Periodic reverse sync disabled via REVERSE_SYNC_ENABLED=false');
    return null;
  }

  if (!getSupabaseClient()) {
    log.info('⏭️  Supabase not configured - periodic reverse sync disabled');
    return null;
  }

  log.info(`⏰ Starting periodic reverse sync (every ${interval} minutes)`);
  log.info(`   Lookback window: ${CONFIG.INITIAL_LOOKBACK_HOURS}h`);
  log.info(`   Max records per poll: ${CONFIG.MAX_RECORDS_PER_POLL}`);

  // Run immediately on start (startup sync)
  log.info('🚀 Running initial reverse sync on startup...');
  pollForMissedChanges()
    .then((result) => {
      if (result.totalSynced > 0) {
        log.info(`🎉 Startup sync recovered ${result.totalSynced} missed changes`);
      } else if (!result.skipped && !result.error) {
        log.info('✓ Startup sync complete - no missed changes');
      }
    })
    .catch((err) => {
      log.error('⚠️  Initial reverse sync failed (will retry hourly):', (err as Error).message);
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
export function stopPeriodicPolling(): void {
  if (pollingIntervalId) {
    log.info('⏸️  Stopping periodic reverse sync');
    clearInterval(pollingIntervalId);
    pollingIntervalId = null;
  }
}

/**
 * Get current configuration
 */
export function getConfig(): SyncConfig {
  return { ...CONFIG };
}
