/**
 * Unified Sync Processor
 * Processes SyncQueue and syncs all tables from SQL Server to Supabase
 * Replaces the old direct-query sync method with a trigger-based queue system
 */

import { executeQuery, TYPES } from '../database/index.js';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { log } from '../../utils/logger.js';

dotenv.config();

// =============================================================================
// TYPES
// =============================================================================

/**
 * Pending sync record from SyncQueue
 */
interface PendingSyncRecord {
  QueueID: number;
  TableName: string;
  RecordID: number;
  Operation: string;
  JsonData: string;
  CreatedAt: Date;
}

/**
 * Table sync stats
 */
interface TableSyncStats {
  synced: number;
  failed: number;
}

/**
 * Full sync stats
 */
interface SyncStats {
  totalSynced: number;
  totalFailed: number;
  byTable: Record<string, TableSyncStats>;
}

/**
 * Tables with pending syncs
 */
interface TableWithPending {
  TableName: string;
  PendingCount: number;
}

/**
 * Sync handler function type. Receives pre-parsed row data so a single
 * corrupt JSON blob in SyncQueue can't poison the whole batch — the parse
 * step in processSyncForTable handles row-level failures.
 */
type SyncHandler = (data: unknown[]) => Promise<number>;

/**
 * Sync handlers map
 */
interface SyncHandlers {
  [tableName: string]: SyncHandler;
}

// =============================================================================
// SUPABASE CLIENT
// =============================================================================

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase: SupabaseClient = createClient(supabaseUrl, supabaseServiceKey);

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

async function getPendingSyncRecords(
  tableName: string | null = null,
  limit: number = 1000
): Promise<PendingSyncRecord[]> {
  const sqlText = `
    SELECT TOP ${limit}
      QueueID,
      TableName,
      RecordID,
      Operation,
      JsonData,
      CreatedAt
    FROM SyncQueue
    WHERE Status = 'Pending'
      ${tableName ? 'AND TableName = @tableName' : ''}
    ORDER BY CreatedAt ASC
  `;
  const params = tableName ? [['tableName', TYPES.NVarChar, tableName] as [string, typeof TYPES[keyof typeof TYPES], unknown]] : [];
  return executeQuery<PendingSyncRecord>(sqlText, params, (cols) => ({
    QueueID: cols[0].value as number,
    TableName: cols[1].value as string,
    RecordID: cols[2].value as number,
    Operation: cols[3].value as string,
    JsonData: cols[4].value as string,
    CreatedAt: cols[5].value as Date,
  }));
}

async function markAsSynced(queueIds: number[]): Promise<void> {
  if (queueIds.length === 0) return;
  const idList = queueIds.join(',');
  await executeQuery(
    `UPDATE SyncQueue SET Status = 'Synced', LastAttempt = GETDATE(), Attempts = ISNULL(Attempts, 0) + 1 WHERE QueueID IN (${idList})`,
    [],
    () => ({})
  );
}

async function markAsFailed(queueIds: number[], errorMessage: string): Promise<void> {
  if (queueIds.length === 0) return;
  const idList = queueIds.join(',');
  await executeQuery(
    `UPDATE SyncQueue SET Status = 'Failed', LastAttempt = GETDATE(), LastError = @error, Attempts = ISNULL(Attempts, 0) + 1 WHERE QueueID IN (${idList})`,
    [['error', TYPES.NVarChar, errorMessage]],
    () => ({})
  );
}

// =============================================================================
// TABLE SYNC HANDLERS
// =============================================================================

/**
 * Table sync handlers
 */
const syncHandlers: SyncHandlers = {
  async aligner_doctors(data: unknown[]): Promise<number> {
    const { error } = await supabase.from('aligner_doctors').upsert(data, { onConflict: 'dr_id' });
    if (error) throw error;
    return data.length;
  },

  async aligner_sets(data: unknown[]): Promise<number> {
    const { error } = await supabase
      .from('aligner_sets')
      .upsert(data, { onConflict: 'aligner_set_id' });
    if (error) throw error;
    return data.length;
  },

  async aligner_batches(data: unknown[]): Promise<number> {
    const { error } = await supabase
      .from('aligner_batches')
      .upsert(data, { onConflict: 'aligner_batch_id' });
    if (error) throw error;
    return data.length;
  },

  async aligner_notes(data: unknown[]): Promise<number> {
    const { error } = await supabase.from('aligner_notes').upsert(data, { onConflict: 'note_id' });
    if (error) throw error;
    return data.length;
  },

  async patients(data: unknown[]): Promise<number> {
    const { error } = await supabase.from('patients').upsert(data, { onConflict: 'person_id' });
    if (error) throw error;
    return data.length;
  },

  async work(data: unknown[]): Promise<number> {
    const { error } = await supabase.from('work').upsert(data, { onConflict: 'work_id' });
    if (error) throw error;
    return data.length;
  },
};

// =============================================================================
// SYNC PROCESSING FUNCTIONS
// =============================================================================

/**
 * Process sync queue for a specific table
 */
async function processSyncForTable(tableName: string): Promise<TableSyncStats> {
  const records = await getPendingSyncRecords(tableName);

  if (records.length === 0) {
    return { synced: 0, failed: 0 };
  }

  log.info(`📦 Processing ${records.length} ${tableName} records`);

  const handler = syncHandlers[tableName];
  if (!handler) {
    log.warn(`No sync handler for table: ${tableName}`);
    return { synced: 0, failed: records.length };
  }

  // Parse per-row so a single corrupt JSON blob in SyncQueue doesn't poison
  // the whole batch — the previous code did records.map(JSON.parse) inside
  // each handler, which threw and marked every well-formed row as Failed too.
  const parsed: unknown[] = [];
  const okRecords: PendingSyncRecord[] = [];
  const parseFailed: PendingSyncRecord[] = [];
  for (const r of records) {
    try {
      parsed.push(JSON.parse(r.JsonData));
      okRecords.push(r);
    } catch (err) {
      log.error('Sync row has invalid JSON — marking failed', {
        queueId: r.QueueID,
        tableName: r.TableName,
        recordId: r.RecordID,
        error: (err as Error).message,
      });
      parseFailed.push(r);
    }
  }

  if (parseFailed.length > 0) {
    await markAsFailed(
      parseFailed.map((r) => r.QueueID),
      'Invalid JSON in SyncQueue row'
    );
  }

  if (parsed.length === 0) {
    return { synced: 0, failed: parseFailed.length };
  }

  try {
    const synced = await handler(parsed);
    await markAsSynced(okRecords.map((r) => r.QueueID));
    if (parseFailed.length > 0) {
      log.info(`✅ Synced ${synced} ${tableName} records (${parseFailed.length} parse-failed)`);
    } else {
      log.info(`✅ Synced ${synced} ${tableName} records`);
    }
    return { synced, failed: parseFailed.length };
  } catch (error) {
    log.error(`❌ Error syncing ${tableName}:`, (error as Error).message);
    await markAsFailed(okRecords.map((r) => r.QueueID), (error as Error).message);
    return { synced: 0, failed: records.length };
  }
}

/**
 * Process all pending records in sync queue
 */
export async function processAllPendingSyncs(): Promise<SyncStats> {
  log.info('🚀 Starting Unified Sync Process\n');
  log.info('==========================================');

  const stats: SyncStats = {
    totalSynced: 0,
    totalFailed: 0,
    byTable: {},
  };

  try {
    const tablesWithPending = await executeQuery<TableWithPending>(
      `
      SELECT DISTINCT TableName, COUNT(*) as PendingCount
      FROM SyncQueue
      WHERE Status = 'Pending'
      GROUP BY TableName
      ORDER BY TableName
      `,
      [],
      (cols) => ({
        TableName: cols[0].value as string,
        PendingCount: cols[1].value as number,
      })
    );

    if (tablesWithPending.length === 0) {
      log.info('ℹ️  No pending syncs');
    } else {
      log.info(`Found pending syncs for ${tablesWithPending.length} tables:\n`);
      tablesWithPending.forEach((t) => {
        log.info(`  - ${t.TableName}: ${t.PendingCount} records`);
      });
      log.info('');

      for (const { TableName } of tablesWithPending) {
        const result = await processSyncForTable(TableName);
        stats.byTable[TableName] = result;
        stats.totalSynced += result.synced;
        stats.totalFailed += result.failed;
      }
    }

    log.info('\n==========================================');
    log.info('✅ Sync Process Complete');
    log.info(`   Total Synced: ${stats.totalSynced}`);
    log.info(`   Total Failed: ${stats.totalFailed}`);
    log.info('==========================================\n');

    return stats;
  } catch (error) {
    log.error('❌ Sync process failed:', error);
    throw error;
  }
}

export { processSyncForTable, syncHandlers };

