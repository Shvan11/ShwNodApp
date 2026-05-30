/**
 * Unified Sync Processor (manual / batch fallback)
 *
 * Drains the local `SyncQueue` table to Supabase, grouped by table, returning per-table stats.
 * Reached via the manual `POST /api/sync/trigger` endpoint; the real-time path is the
 * webhook-driven queue-processor.ts. Both share the same on-demand fetch (sync-fetch.ts).
 *
 * Phase 8 of the SQL Server → PostgreSQL migration: all data access is Kysely over the pg pool
 * (was raw mssql `executeQuery`/`TYPES`). Because the app-level enqueue leaves `JsonData` NULL,
 * INSERT/UPDATE rows fetch current state from PG; DELETE rows delete from Supabase by primary
 * key. Inert in the sandbox (gated by `config.sync.enabled` at the call sites).
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { getKysely } from '../database/kysely.js';
import { fetchRecordFromPg, type SyncRecord } from './sync-fetch.js';
import { log } from '../../utils/logger.js';

dotenv.config();

// =============================================================================
// TYPES
// =============================================================================

interface PendingSyncRecord {
  QueueID: number;
  TableName: string;
  RecordID: number;
  Operation: string;
  JsonData: string | null;
}

interface TableSyncStats {
  synced: number;
  failed: number;
}

interface SyncStats {
  totalSynced: number;
  totalFailed: number;
  byTable: Record<string, TableSyncStats>;
}

// =============================================================================
// SUPABASE CLIENT
// =============================================================================

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase: SupabaseClient = createClient(supabaseUrl, supabaseServiceKey);

const PRIMARY_KEYS: Record<string, string> = {
  aligner_doctors: 'dr_id',
  aligner_sets: 'aligner_set_id',
  aligner_batches: 'aligner_batch_id',
  aligner_notes: 'note_id',
  patients: 'person_id',
  work: 'work_id',
};

// =============================================================================
// HELPERS
// =============================================================================

async function getPendingSyncRecords(
  tableName: string | null = null,
  limit = 1000
): Promise<PendingSyncRecord[]> {
  let q = getKysely()
    .selectFrom('SyncQueue')
    .select(['QueueID', 'TableName', 'RecordID', 'Operation', 'JsonData'])
    .where('Status', '=', 'Pending');
  if (tableName) q = q.where('TableName', '=', tableName);
  const rows = await q.orderBy('CreatedAt', 'asc').limit(limit).execute();
  return rows as PendingSyncRecord[];
}

async function markAsSynced(queueIds: number[]): Promise<void> {
  if (queueIds.length === 0) return;
  await getKysely()
    .updateTable('SyncQueue')
    .set((eb) => ({
      Status: 'Synced',
      LastAttempt: new Date(),
      Attempts: eb(eb.fn.coalesce('Attempts', eb.lit(0)), '+', 1),
    }))
    .where('QueueID', 'in', queueIds)
    .execute();
}

async function markAsFailed(queueIds: number[], errorMessage: string): Promise<void> {
  if (queueIds.length === 0) return;
  await getKysely()
    .updateTable('SyncQueue')
    .set((eb) => ({
      Status: 'Failed',
      LastAttempt: new Date(),
      LastError: errorMessage.substring(0, 500),
      Attempts: eb(eb.fn.coalesce('Attempts', eb.lit(0)), '+', 1),
    }))
    .where('QueueID', 'in', queueIds)
    .execute();
}

/** Resolve a queue row to its current Supabase payload (parse JsonData or fetch from PG). */
async function resolveData(record: PendingSyncRecord): Promise<SyncRecord | null> {
  if (record.JsonData) return JSON.parse(record.JsonData) as SyncRecord;
  return fetchRecordFromPg(record.TableName, record.RecordID);
}

// =============================================================================
// SYNC PROCESSING
// =============================================================================

/** Process all pending sync rows for one table. */
async function processSyncForTable(tableName: string): Promise<TableSyncStats> {
  const records = await getPendingSyncRecords(tableName);
  if (records.length === 0) return { synced: 0, failed: 0 };

  log.info(`📦 Processing ${records.length} ${tableName} records`);

  const primaryKey = PRIMARY_KEYS[tableName];
  if (!primaryKey) {
    log.warn(`No primary key mapping for table: ${tableName}`);
    return { synced: 0, failed: records.length };
  }

  const deletes = records.filter((r) => r.Operation === 'DELETE');
  const upserts = records.filter((r) => r.Operation !== 'DELETE');

  let synced = 0;
  let failed = 0;

  // DELETEs: remove from Supabase by primary key.
  if (deletes.length > 0) {
    try {
      const ids = deletes.map((r) => r.RecordID);
      const { error } = await supabase.from(tableName).delete().in(primaryKey, ids);
      if (error) throw error;
      await markAsSynced(deletes.map((r) => r.QueueID));
      synced += deletes.length;
    } catch (error) {
      log.error(`❌ Error deleting ${tableName}:`, (error as Error).message);
      await markAsFailed(deletes.map((r) => r.QueueID), (error as Error).message);
      failed += deletes.length;
    }
  }

  // INSERT/UPDATE: resolve each row's data (a missing source row is "nothing to sync").
  if (upserts.length > 0) {
    const resolved: SyncRecord[] = [];
    const okIds: number[] = [];
    for (const r of upserts) {
      try {
        const data = await resolveData(r);
        if (data) {
          resolved.push(data);
          okIds.push(r.QueueID);
        } else {
          // Source row gone before drain → nothing to upsert; treat as synced.
          await markAsSynced([r.QueueID]);
          synced += 1;
        }
      } catch (err) {
        log.error('Sync row could not be resolved — marking failed', {
          queueId: r.QueueID,
          tableName: r.TableName,
          recordId: r.RecordID,
          error: (err as Error).message,
        });
        await markAsFailed([r.QueueID], (err as Error).message);
        failed += 1;
      }
    }

    if (resolved.length > 0) {
      try {
        const { error } = await supabase.from(tableName).upsert(resolved, { onConflict: primaryKey });
        if (error) throw error;
        await markAsSynced(okIds);
        synced += resolved.length;
        log.info(`✅ Synced ${resolved.length} ${tableName} records`);
      } catch (error) {
        log.error(`❌ Error syncing ${tableName}:`, (error as Error).message);
        await markAsFailed(okIds, (error as Error).message);
        failed += resolved.length;
      }
    }
  }

  return { synced, failed };
}

/** Process all pending records in the sync queue, across all tables. */
export async function processAllPendingSyncs(): Promise<SyncStats> {
  log.info('🚀 Starting Unified Sync Process\n');
  log.info('==========================================');

  const stats: SyncStats = { totalSynced: 0, totalFailed: 0, byTable: {} };

  try {
    const tablesWithPending = await getKysely()
      .selectFrom('SyncQueue')
      .select((eb) => ['TableName', eb.fn.countAll<number>().as('PendingCount')])
      .where('Status', '=', 'Pending')
      .groupBy('TableName')
      .orderBy('TableName')
      .execute();

    if (tablesWithPending.length === 0) {
      log.info('ℹ️  No pending syncs');
    } else {
      log.info(`Found pending syncs for ${tablesWithPending.length} tables:\n`);
      tablesWithPending.forEach((t) => log.info(`  - ${t.TableName}: ${Number(t.PendingCount)} records`));
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

export { processSyncForTable };
