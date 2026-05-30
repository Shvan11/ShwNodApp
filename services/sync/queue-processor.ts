/**
 * PostgreSQL → Supabase Queue Processor
 *
 * Drains the local `SyncQueue` table (populated transactionally by the app-level enqueue in
 * sync-queue.ts) and pushes each change to Supabase. Webhook-triggered with exponential-backoff
 * retry; no polling.
 *
 * Phase 8 of the SQL Server → PostgreSQL migration: all data access is Kysely over the pg pool
 * (was raw mssql `executeQuery`/`TYPES`). The enqueue leaves `JsonData` NULL, so INSERT/UPDATE
 * items fetch the current row from PG on demand (sync-fetch.ts); DELETE items delete from
 * Supabase by primary key directly. Gated by `config.sync.enabled` — when sync is off the
 * processor never starts (see index.ts), so this module is inert in the sandbox.
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

/** Queue item from SyncQueue table */
interface QueueItem {
  QueueID: number;
  TableName: string;
  RecordID: number;
  Operation: 'INSERT' | 'UPDATE' | 'DELETE';
  JsonData: string | null;
  CreatedAt: Date | null;
  Attempts: number | null;
  LastAttempt: Date | null;
  LastError: string | null;
  Status: string | null;
}

/** Queue statistics */
interface QueueStats {
  Status: string | null;
  Count: number;
  OldestItem: Date | null;
  NewestItem: Date | null;
}

interface PrimaryKeyMap {
  [tableName: string]: string;
}

// =============================================================================
// SUPABASE CLIENT
// =============================================================================

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase: SupabaseClient = createClient(supabaseUrl, supabaseServiceKey);

// =============================================================================
// QUEUE PROCESSOR CLASS
// =============================================================================

class QueueProcessor {
  private isProcessing: boolean;
  private maxAttempts: number;
  private batchSize: number;
  private retryTimer: NodeJS.Timeout | null;

  // Exponential backoff configuration
  private retryAttempts: number;
  private baseRetryInterval: number;
  private maxRetryInterval: number;

  constructor() {
    this.isProcessing = false;
    this.maxAttempts = 10;
    this.batchSize = 50;
    this.retryTimer = null;

    this.retryAttempts = 0;
    this.baseRetryInterval = 60 * 1000; // Start with 1 minute
    this.maxRetryInterval = 60 * 60 * 1000; // Cap at 1 hour
  }

  /** Get primary key field for each Supabase table */
  getPrimaryKey(tableName: string): string {
    const keys: PrimaryKeyMap = {
      aligner_doctors: 'dr_id',
      aligner_sets: 'aligner_set_id',
      aligner_batches: 'aligner_batch_id',
      aligner_notes: 'note_id',
      aligner_set_payments: 'aligner_set_id',
      patients: 'person_id',
      work: 'work_id',
    };
    return keys[tableName] || 'id';
  }

  /**
   * Ensure related parent records exist in Supabase before upserting a child.
   * (aligner_sets → work → patients; aligner_batches → aligner_sets). Fetches missing
   * parents from PG and upserts them. Non-fatal: logs and continues on failure.
   */
  async ensureRelatedRecordsExist(data: SyncRecord, tableName: string): Promise<void> {
    try {
      if (tableName === 'aligner_sets' && 'work_id' in data) {
        const workId = data.work_id;
        const { error: workCheckError } = await supabase
          .from('work')
          .select('work_id')
          .eq('work_id', workId)
          .single();

        if (workCheckError && workCheckError.code === 'PGRST116') {
          log.info(`  📥 Fetching missing work record (ID: ${workId}) from PostgreSQL...`);
          const workData = await fetchRecordFromPg('work', workId);
          if (workData) {
            await this.ensureRelatedRecordsExist(workData, 'work');
            const { error } = await supabase.from('work').upsert(workData, { onConflict: 'work_id' });
            if (error) log.error(`  ❌ Failed to sync work: ${error.message}`);
            else log.info(`  ✅ Work record synced (ID: ${workId})`);
          } else {
            log.warn(`  ⚠️  Work record not found in PostgreSQL (ID: ${workId})`);
          }
        }
      }

      if (tableName === 'work' && 'person_id' in data) {
        const personId = data.person_id;
        const { error: patientCheckError } = await supabase
          .from('patients')
          .select('person_id')
          .eq('person_id', personId)
          .single();

        if (patientCheckError && patientCheckError.code === 'PGRST116') {
          log.info(`  📥 Fetching missing patient record (ID: ${personId}) from PostgreSQL...`);
          const patientData = await fetchRecordFromPg('patients', personId);
          if (patientData) {
            const { error } = await supabase
              .from('patients')
              .upsert(patientData, { onConflict: 'person_id' });
            if (error) log.error(`  ❌ Failed to sync patient: ${error.message}`);
            else log.info(`  ✅ Patient record synced (ID: ${personId})`);
          } else {
            log.warn(`  ⚠️  Patient record not found in PostgreSQL (ID: ${personId})`);
          }
        }
      }

      if (tableName === 'aligner_batches' && 'aligner_set_id' in data) {
        const setId = data.aligner_set_id;
        const { error: setCheckError } = await supabase
          .from('aligner_sets')
          .select('aligner_set_id')
          .eq('aligner_set_id', setId)
          .single();

        if (setCheckError && setCheckError.code === 'PGRST116') {
          log.info(`  📥 Fetching missing aligner set (ID: ${setId}) from PostgreSQL...`);
          const setData = await fetchRecordFromPg('aligner_sets', setId);
          if (setData) {
            await this.ensureRelatedRecordsExist(setData, 'aligner_sets');
            const { error } = await supabase
              .from('aligner_sets')
              .upsert(setData, { onConflict: 'aligner_set_id' });
            if (error) log.error(`  ❌ Failed to sync aligner set: ${error.message}`);
            else log.info(`  ✅ Aligner set synced (ID: ${setId})`);
          } else {
            log.warn(`  ⚠️  Aligner set not found in PostgreSQL (ID: ${setId})`);
          }
        }
      }
    } catch (error) {
      log.error(`  ⚠️  Error ensuring related records exist: ${(error as Error).message}`);
      // Don't throw - let the main sync continue even if related records fail
    }
  }

  /** Mark a queue item Synced (optionally storing the synced JSON for reference). */
  private async markSynced(queueId: number, jsonData?: string): Promise<number> {
    const result = await getKysely()
      .updateTable('SyncQueue')
      .set({
        Status: 'Synced',
        LastAttempt: new Date(),
        ...(jsonData !== undefined ? { JsonData: jsonData } : {}),
      })
      .where('QueueID', '=', queueId)
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  }

  /** Process a single queue item. Returns true on success. */
  async processItem(item: QueueItem): Promise<boolean> {
    try {
      const primaryKey = this.getPrimaryKey(item.TableName);

      // DELETE: remove from Supabase by primary key directly (the PG row is already gone).
      if (item.Operation === 'DELETE') {
        log.info(`🗑️  Deleting ${item.TableName} ID ${item.RecordID} from Supabase`);
        const { error } = await supabase
          .from(item.TableName)
          .delete()
          .eq(primaryKey, item.RecordID);
        if (error) throw error;
        await this.markSynced(item.QueueID);
        return true;
      }

      // INSERT/UPDATE: JsonData is NULL under the app-level enqueue → fetch current state.
      const data: SyncRecord | null = item.JsonData
        ? (JSON.parse(item.JsonData) as SyncRecord)
        : await fetchRecordFromPg(item.TableName, item.RecordID);

      if (!data) {
        // Record was deleted before we got here → nothing to upsert.
        log.info(`  ⚠️  Record not found in source - marking synced (nothing to sync)`);
        await this.markSynced(item.QueueID);
        return true;
      }

      log.info(`🔄 Syncing ${item.TableName} ID ${item.RecordID} (${item.Operation})`);
      await this.ensureRelatedRecordsExist(data, item.TableName);

      const { error } = await supabase
        .from(item.TableName)
        .upsert(data, { onConflict: primaryKey });
      if (error) throw error;

      const updated = await this.markSynced(item.QueueID, JSON.stringify(data));
      log.info(`  ✅ Synced successfully (UPDATE affected ${updated} rows)`);
      return true;
    } catch (error) {
      log.error(`  ❌ Sync failed: ${(error as Error).message}`);

      const newAttempts = (item.Attempts ?? 0) + 1;
      const newStatus = newAttempts >= this.maxAttempts ? 'Failed' : 'Pending';

      await getKysely()
        .updateTable('SyncQueue')
        .set({
          Attempts: newAttempts,
          LastAttempt: new Date(),
          LastError: (error as Error).message.substring(0, 500),
          Status: newStatus,
        })
        .where('QueueID', '=', item.QueueID)
        .execute();

      if (newStatus === 'Failed') {
        log.error(`  ⚠️  Max attempts reached. Marked as FAILED.`);
      }
      return false;
    }
  }

  /** Process the queue (one batch, then continue/retry as needed). */
  async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const items = (await getKysely()
        .selectFrom('SyncQueue')
        .selectAll()
        .where('Status', '=', 'Pending')
        .where('Attempts', '<', this.maxAttempts)
        .orderBy('QueueID')
        .limit(this.batchSize)
        .execute()) as QueueItem[];

      if (items.length > 0) {
        log.info(`\n📦 Processing ${items.length} items from sync queue...`);

        let successCount = 0;
        let failCount = 0;
        for (const item of items) {
          const success = await this.processItem(item);
          if (success) successCount++;
          else failCount++;
        }
        log.info(`✅ Batch complete: ${successCount} synced, ${failCount} failed\n`);

        if (failCount > 0) {
          this.scheduleRetry();
        } else {
          this.retryAttempts = 0;
          const pendingCount = await this.getPendingCount();
          if (pendingCount > 0) {
            log.info(`📦 ${pendingCount} more items in queue - continuing processing...`);
            setImmediate(() => this.processQueue());
          } else {
            log.info('✅ Queue fully processed - all items synced\n');
          }
        }
      } else {
        this.retryAttempts = 0;
      }
    } catch (error) {
      log.error('❌ Queue processor error:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  /** Queue statistics grouped by status. */
  async getStats(): Promise<QueueStats[]> {
    try {
      const rows = await getKysely()
        .selectFrom('SyncQueue')
        .select((eb) => [
          'Status',
          eb.fn.countAll<number>().as('Count'),
          eb.fn.min('CreatedAt').as('OldestItem'),
          eb.fn.max('CreatedAt').as('NewestItem'),
        ])
        .groupBy('Status')
        .execute();
      return rows.map((r) => ({
        Status: r.Status,
        Count: Number(r.Count),
        OldestItem: r.OldestItem as Date | null,
        NewestItem: r.NewestItem as Date | null,
      }));
    } catch (error) {
      log.error('Error getting stats:', error);
      return [];
    }
  }

  async printStats(): Promise<void> {
    const stats = await this.getStats();
    if (stats.length === 0) {
      log.info('📊 Queue is empty');
      return;
    }
    log.info('\n📊 Queue Statistics:');
    log.info('═══════════════════════════════════════');
    stats.forEach((stat) => log.info(`  ${stat.Status}: ${stat.Count} items`));
    log.info('═══════════════════════════════════════\n');
  }

  /**
   * Schedule retry with exponential backoff:
   * 1m → 2m → 4m → 8m → 16m → 32m → 60m (capped).
   */
  scheduleRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);

    const retryDelay = Math.min(
      this.baseRetryInterval * Math.pow(2, this.retryAttempts),
      this.maxRetryInterval
    );
    this.retryAttempts++;

    this.retryTimer = setTimeout(async () => {
      log.info(`🔄 Retry attempt #${this.retryAttempts}: Checking for pending items...`);
      const pendingCount = await this.getPendingCount();
      if (pendingCount > 0) {
        log.info(`📋 Found ${pendingCount} pending items, processing...`);
        await this.processQueue();
      } else {
        log.info('✅ No pending items - retry timer cleared');
        this.retryAttempts = 0;
      }
      this.retryTimer = null;
    }, retryDelay);

    const minutes = Math.floor(retryDelay / 60000);
    const seconds = Math.floor((retryDelay % 60000) / 1000);
    log.info(`⏱️  Retry #${this.retryAttempts} scheduled in ${minutes}m ${seconds}s`);
  }

  /** Count of pending items still under the attempt cap. */
  async getPendingCount(): Promise<number> {
    try {
      const row = await getKysely()
        .selectFrom('SyncQueue')
        .select((eb) => eb.fn.countAll<number>().as('PendingCount'))
        .where('Status', '=', 'Pending')
        .where('Attempts', '<', this.maxAttempts)
        .executeTakeFirst();
      return Number(row?.PendingCount ?? 0);
    } catch (error) {
      log.error('Error getting pending count:', error);
      return 0;
    }
  }

  /** Process queue once (webhook-triggered). */
  async processQueueOnce(): Promise<void> {
    if (this.isProcessing) {
      log.info('⏭️  Queue already processing, skipping...');
      return;
    }
    this.retryAttempts = 0;
    await this.processQueue();
  }

  /** Start the processor (webhook mode - NO polling). */
  start(): void {
    log.info('🚀 Queue Processor Started (Webhook-Triggered Mode)');
    log.info('   ✅ Zero polling - waits for notifications');
    log.info('   ✅ Smart retry - exponential backoff for failed items');
    log.info(`   Batch size: ${this.batchSize}`);
    log.info(`   Max attempts per item: ${this.maxAttempts}`);
    log.info(`   Retry strategy: 1m → 2m → 4m → 8m → 16m → 32m → 60m`);
    log.info('═══════════════════════════════════════\n');

    // Process once on startup to clear any existing queue.
    this.processQueue();
  }

  /** Stop the processor. */
  stop(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.retryAttempts = 0;
    log.info('🛑 Queue Processor Stopped');
  }
}

// Create singleton instance
const queueProcessor = new QueueProcessor();

// Signal handling is owned by index.ts:gracefulShutdown, which calls
// queueProcessor.stop() in the correct teardown order. Do NOT register
// process.on('SIGINT'/'SIGTERM') here — duplicate handlers race the central
// shutdown and can call process.exit before other services finish.

export default queueProcessor;
