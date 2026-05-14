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
 * Sync handler function type
 */
type SyncHandler = (records: PendingSyncRecord[]) => Promise<number>;

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
  async aligner_doctors(records: PendingSyncRecord[]): Promise<number> {
    const data = records.map((r) => JSON.parse(r.JsonData));
    const { error } = await supabase.from('aligner_doctors').upsert(data, { onConflict: 'dr_id' });
    if (error) throw error;
    return data.length;
  },

  async aligner_sets(records: PendingSyncRecord[]): Promise<number> {
    const data = records.map((r) => JSON.parse(r.JsonData));
    const { error } = await supabase
      .from('aligner_sets')
      .upsert(data, { onConflict: 'aligner_set_id' });
    if (error) throw error;
    return data.length;
  },

  async aligner_batches(records: PendingSyncRecord[]): Promise<number> {
    const data = records.map((r) => JSON.parse(r.JsonData));
    const { error } = await supabase
      .from('aligner_batches')
      .upsert(data, { onConflict: 'aligner_batch_id' });
    if (error) throw error;
    return data.length;
  },

  async aligner_notes(records: PendingSyncRecord[]): Promise<number> {
    const data = records.map((r) => JSON.parse(r.JsonData));
    const { error } = await supabase.from('aligner_notes').upsert(data, { onConflict: 'note_id' });
    if (error) throw error;
    return data.length;
  },

  async patients(records: PendingSyncRecord[]): Promise<number> {
    const data = records.map((r) => JSON.parse(r.JsonData));
    const { error } = await supabase.from('patients').upsert(data, { onConflict: 'person_id' });
    if (error) throw error;
    return data.length;
  },

  async work(records: PendingSyncRecord[]): Promise<number> {
    const data = records.map((r) => JSON.parse(r.JsonData));
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

  try {
    const synced = await handler(records);
    const queueIds = records.map((r) => r.QueueID);
    await markAsSynced(queueIds);
    log.info(`✅ Synced ${synced} ${tableName} records`);
    return { synced, failed: 0 };
  } catch (error) {
    log.error(`❌ Error syncing ${tableName}:`, (error as Error).message);
    const queueIds = records.map((r) => r.QueueID);
    await markAsFailed(queueIds, (error as Error).message);
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

