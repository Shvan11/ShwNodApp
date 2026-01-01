/**
 * SQL Server → PostgreSQL Queue Processor
 * Processes sync queue and pushes changes to Supabase
 */

import { executeQuery, TYPES } from '../database/index.js';
import { Connection, Request } from 'tedious';
import ConnectionPool from '../database/ConnectionPool.js';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { log } from '../../utils/logger.js';

dotenv.config();

// =============================================================================
// TYPES
// =============================================================================

/**
 * Queue item from SyncQueue table
 */
interface QueueItem {
  QueueID: number;
  TableName: string;
  RecordID: number;
  Operation: 'INSERT' | 'UPDATE' | 'DELETE';
  JsonData: string | null;
  CreatedAt: Date;
  Attempts: number;
  LastAttempt: Date | null;
  LastError: string | null;
  Status: string;
}

/**
 * Queue statistics
 */
interface QueueStats {
  Status: string;
  Count: number;
  OldestItem: Date;
  NewestItem: Date;
}

/**
 * Work record
 */
interface WorkRecord {
  work_id: number;
  person_id: number;
  type_of_work: string;
  addition_date: Date;
  start_date?: Date | null;
  debond_date?: Date | null;
  status?: number;
  total_required?: number | null;
  currency?: string | null;
  notes?: string | null;
  dr_id?: number | null;
}

/**
 * Patient record
 */
interface PatientRecord {
  person_id: number;
  patient_id: string;
  patient_name: string;
  first_name: string;
  last_name: string;
  phone: string;
  phone2?: string | null;
  email?: string | null;
  date_of_birth?: Date | null;
  gender?: number | null;
  notes?: string | null;
  language?: string | null;
  country_code?: string | null;
}

/**
 * Aligner set record
 */
interface AlignerSetRecord {
  aligner_set_id: number;
  work_id: number;
  aligner_dr_id: number;
  set_sequence: number;
  type: string;
  upper_aligners_count: number;
  lower_aligners_count: number;
  remaining_upper_aligners: number;
  remaining_lower_aligners: number;
  creation_date: Date;
  days: number;
  is_active: boolean;
  notes: string;
  folder_path: string;
  set_url: string;
  set_pdf_url: string;
  set_cost: number;
  currency: string;
  pdf_uploaded_at: Date | null;
  pdf_uploaded_by: string;
  drive_file_id: string;
  set_video?: string | null;
}

/**
 * Aligner batch record
 */
interface AlignerBatchRecord {
  aligner_batch_id: number;
  aligner_set_id: number;
  batch_sequence: number;
  upper_aligner_count: number;
  lower_aligner_count: number;
  upper_aligner_start_sequence: number;
  upper_aligner_end_sequence: number;
  lower_aligner_start_sequence: number;
  lower_aligner_end_sequence: number;
  manufacture_date: Date;
  delivered_to_patient_date: Date | null;
  days: number;
  validity_period: number;
  next_batch_ready_date: Date | null;
  notes: string;
  is_active: boolean;
  creation_date?: Date;
  is_last?: boolean;
}

/**
 * Primary key map
 */
interface PrimaryKeyMap {
  [tableName: string]: string;
}

/**
 * Generic record type
 */
type SyncRecord = WorkRecord | PatientRecord | AlignerSetRecord | AlignerBatchRecord;

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

    // Exponential backoff configuration
    this.retryAttempts = 0;
    this.baseRetryInterval = 60 * 1000; // Start with 1 minute
    this.maxRetryInterval = 60 * 60 * 1000; // Cap at 1 hour
  }

  /**
   * Execute UPDATE/INSERT/DELETE queries (non-SELECT queries)
   */
  async executeUpdate(
    query: string,
    params: [string, typeof TYPES[keyof typeof TYPES], unknown][]
  ): Promise<number> {
    return ConnectionPool.withConnection(async (connection: Connection) => {
      return new Promise((resolve, reject) => {
        let actualRowCount = 0;

        const request = new Request(query, (err, rowCount) => {
          if (err) {
            log.error('Update query error', { error: err.message });
            reject(err);
            return;
          }
          // Store the actual row count from the callback
          actualRowCount = rowCount || 0;
        });

        // Add parameters
        (params || []).forEach((param) => {
          request.addParameter(param[0], param[1], param[2]);
        });

        // Listen for requestCompleted event - this fires when query is done
        request.on('requestCompleted', () => {
          // Resolve with the row count we got from the main callback
          resolve(actualRowCount);
        });

        // Listen for errors
        request.on('error', (err) => {
          log.error('UPDATE request error', { error: err.message });
          reject(err);
        });

        connection.execSql(request);
      });
    });
  }

  /**
   * Get primary key field for each table
   */
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
   * Fetch work record from SQL Server
   */
  async fetchWorkFromSqlServer(workId: number): Promise<WorkRecord | null> {
    const query = `
            SELECT
                workid as work_id,
                PersonID as person_id,
                Typeofwork as type_of_work,
                AdditionDate as addition_date
            FROM tblWork
            WHERE workid = @workId
        `;

    const results = await executeQuery<WorkRecord>(
      query,
      [['workId', TYPES.Int, workId]],
      (columns) => ({
        work_id: columns[0].value as number,
        person_id: columns[1].value as number,
        type_of_work: columns[2].value as string,
        addition_date: columns[3].value as Date,
      })
    );

    return results && results.length > 0 ? results[0] : null;
  }

  /**
   * Fetch patient record from SQL Server
   */
  async fetchPatientFromSqlServer(personId: number): Promise<PatientRecord | null> {
    const query = `
            SELECT
                PersonID as person_id,
                patientID as patient_id,
                PatientName as patient_name,
                FirstName as first_name,
                LastName as last_name,
                Phone as phone
            FROM tblPatients
            WHERE PersonID = @personId
        `;

    const results = await executeQuery<PatientRecord>(
      query,
      [['personId', TYPES.Int, personId]],
      (columns) => ({
        person_id: columns[0].value as number,
        patient_id: columns[1].value as string,
        patient_name: columns[2].value as string,
        first_name: columns[3].value as string,
        last_name: columns[4].value as string,
        phone: columns[5].value as string,
      })
    );

    return results && results.length > 0 ? results[0] : null;
  }

  /**
   * Fetch aligner set record from SQL Server
   */
  async fetchAlignerSetFromSqlServer(alignerSetId: number): Promise<AlignerSetRecord | null> {
    const query = `
            SELECT
                AlignerSetID as aligner_set_id,
                WorkID as work_id,
                AlignerDrID as aligner_dr_id,
                SetSequence as set_sequence,
                Type as type,
                UpperAlignersCount as upper_aligners_count,
                LowerAlignersCount as lower_aligners_count,
                RemainingUpperAligners as remaining_upper_aligners,
                RemainingLowerAligners as remaining_lower_aligners,
                CreationDate as creation_date,
                Days as days,
                IsActive as is_active,
                Notes as notes,
                FolderPath as folder_path,
                SetUrl as set_url,
                SetPdfUrl as set_pdf_url,
                SetCost as set_cost,
                Currency as currency,
                PdfUploadedAt as pdf_uploaded_at,
                PdfUploadedBy as pdf_uploaded_by,
                DriveFileId as drive_file_id
            FROM tblAlignerSets
            WHERE AlignerSetID = @alignerSetId
        `;

    const results = await executeQuery<AlignerSetRecord>(
      query,
      [['alignerSetId', TYPES.Int, alignerSetId]],
      (columns) => ({
        aligner_set_id: columns[0].value as number,
        work_id: columns[1].value as number,
        aligner_dr_id: columns[2].value as number,
        set_sequence: columns[3].value as number,
        type: columns[4].value as string,
        upper_aligners_count: columns[5].value as number,
        lower_aligners_count: columns[6].value as number,
        remaining_upper_aligners: columns[7].value as number,
        remaining_lower_aligners: columns[8].value as number,
        creation_date: columns[9].value as Date,
        days: columns[10].value as number,
        is_active: columns[11].value as boolean,
        notes: columns[12].value as string,
        folder_path: columns[13].value as string,
        set_url: columns[14].value as string,
        set_pdf_url: columns[15].value as string,
        set_cost: columns[16].value as number,
        currency: columns[17].value as string,
        pdf_uploaded_at: columns[18].value as Date | null,
        pdf_uploaded_by: columns[19].value as string,
        drive_file_id: columns[20].value as string,
      })
    );

    return results && results.length > 0 ? results[0] : null;
  }

  /**
   * Fetch aligner batch record from SQL Server
   * Used when sync trigger stores only IDs (optimized mode)
   */
  async fetchAlignerBatchFromSqlServer(batchId: number): Promise<AlignerBatchRecord | null> {
    const query = `
            SELECT
                AlignerBatchID as aligner_batch_id,
                AlignerSetID as aligner_set_id,
                BatchSequence as batch_sequence,
                UpperAlignerCount as upper_aligner_count,
                LowerAlignerCount as lower_aligner_count,
                UpperAlignerStartSequence as upper_aligner_start_sequence,
                UpperAlignerEndSequence as upper_aligner_end_sequence,
                LowerAlignerStartSequence as lower_aligner_start_sequence,
                LowerAlignerEndSequence as lower_aligner_end_sequence,
                ManufactureDate as manufacture_date,
                DeliveredToPatientDate as delivered_to_patient_date,
                Days as days,
                ValidityPeriod as validity_period,
                NextBatchReadyDate as next_batch_ready_date,
                Notes as notes,
                IsActive as is_active
            FROM tblAlignerBatches
            WHERE AlignerBatchID = @batchId
        `;

    const results = await executeQuery<AlignerBatchRecord>(
      query,
      [['batchId', TYPES.Int, batchId]],
      (columns) => ({
        aligner_batch_id: columns[0].value as number,
        aligner_set_id: columns[1].value as number,
        batch_sequence: columns[2].value as number,
        upper_aligner_count: columns[3].value as number,
        lower_aligner_count: columns[4].value as number,
        upper_aligner_start_sequence: columns[5].value as number,
        upper_aligner_end_sequence: columns[6].value as number,
        lower_aligner_start_sequence: columns[7].value as number,
        lower_aligner_end_sequence: columns[8].value as number,
        manufacture_date: columns[9].value as Date,
        delivered_to_patient_date: columns[10].value as Date | null,
        days: columns[11].value as number,
        validity_period: columns[12].value as number,
        next_batch_ready_date: columns[13].value as Date | null,
        notes: columns[14].value as string,
        is_active: columns[15].value as boolean,
      })
    );

    return results && results.length > 0 ? results[0] : null;
  }

  /**
   * Ensure related work and patient exist in Supabase (for aligner_sets)
   */
  async ensureRelatedRecordsExist(data: SyncRecord, tableName: string): Promise<void> {
    try {
      // Handle aligner_sets - ensure work and patient exist
      if (tableName === 'aligner_sets' && 'work_id' in data) {
        const workId = data.work_id as number;
        // Check if work exists in Supabase
        const { error: workCheckError } = await supabase
          .from('work')
          .select('work_id')
          .eq('work_id', workId)
          .single();

        if (workCheckError && workCheckError.code === 'PGRST116') {
          // Work doesn't exist - fetch from SQL Server
          log.info(`  📥 Fetching missing work record (ID: ${workId}) from SQL Server...`);
          const workData = await this.fetchWorkFromSqlServer(workId);

          if (workData) {
            // Ensure patient exists before syncing work
            await this.ensureRelatedRecordsExist(workData, 'work');

            // Sync work to Supabase
            const { error: workUpsertError } = await supabase
              .from('work')
              .upsert(workData, { onConflict: 'work_id' });

            if (workUpsertError) {
              log.error(`  ❌ Failed to sync work: ${workUpsertError.message}`);
            } else {
              log.info(`  ✅ Work record synced (ID: ${workId})`);
            }
          } else {
            log.warn(`  ⚠️  Work record not found in SQL Server (ID: ${workId})`);
          }
        }
      }

      // Handle work - ensure patient exists
      if (tableName === 'work' && 'person_id' in data) {
        const personId = data.person_id as number;
        // Check if patient exists in Supabase
        const { error: patientCheckError } = await supabase
          .from('patients')
          .select('person_id')
          .eq('person_id', personId)
          .single();

        if (patientCheckError && patientCheckError.code === 'PGRST116') {
          // Patient doesn't exist - fetch from SQL Server
          log.info(`  📥 Fetching missing patient record (ID: ${personId}) from SQL Server...`);
          const patientData = await this.fetchPatientFromSqlServer(personId);

          if (patientData) {
            // Sync patient to Supabase
            const { error: patientUpsertError } = await supabase
              .from('patients')
              .upsert(patientData, { onConflict: 'person_id' });

            if (patientUpsertError) {
              log.error(`  ❌ Failed to sync patient: ${patientUpsertError.message}`);
            } else {
              log.info(`  ✅ Patient record synced (ID: ${personId})`);
            }
          } else {
            log.warn(`  ⚠️  Patient record not found in SQL Server (ID: ${personId})`);
          }
        }
      }

      // Handle aligner_batches - ensure aligner_set exists
      if (tableName === 'aligner_batches' && 'aligner_set_id' in data) {
        const setId = data.aligner_set_id as number;
        // Check if aligner_set exists in Supabase
        const { error: setCheckError } = await supabase
          .from('aligner_sets')
          .select('aligner_set_id')
          .eq('aligner_set_id', setId)
          .single();

        if (setCheckError && setCheckError.code === 'PGRST116') {
          // Aligner set doesn't exist - fetch from SQL Server
          log.info(`  📥 Fetching missing aligner set (ID: ${setId}) from SQL Server...`);
          const setData = await this.fetchAlignerSetFromSqlServer(setId);

          if (setData) {
            // Ensure work and patient exist before syncing set
            await this.ensureRelatedRecordsExist(setData, 'aligner_sets');

            // Sync aligner set to Supabase
            const { error: setUpsertError } = await supabase
              .from('aligner_sets')
              .upsert(setData, { onConflict: 'aligner_set_id' });

            if (setUpsertError) {
              log.error(`  ❌ Failed to sync aligner set: ${setUpsertError.message}`);
            } else {
              log.info(`  ✅ Aligner set synced (ID: ${setId})`);
            }
          } else {
            log.warn(`  ⚠️  Aligner set not found in SQL Server (ID: ${setId})`);
          }
        }
      }
    } catch (error) {
      log.error(`  ⚠️  Error ensuring related records exist: ${(error as Error).message}`);
      // Don't throw - let the main sync continue even if related records fail
    }
  }

  /**
   * Process a single queue item
   */
  async processItem(item: QueueItem): Promise<boolean> {
    try {
      // Handle JsonData - if NULL, fetch from SQL Server
      let data: SyncRecord | null;
      if (item.JsonData) {
        // Traditional flow: JSON was pre-built by trigger
        data = JSON.parse(item.JsonData);
      } else {
        // Optimized flow: Fetch data on-demand
        log.info(`  📥 JsonData is NULL - fetching fresh data from SQL Server...`);

        switch (item.TableName) {
          case 'aligner_batches':
            data = await this.fetchAlignerBatchFromSqlServer(item.RecordID);
            break;
          case 'aligner_sets':
            data = await this.fetchAlignerSetFromSqlServer(item.RecordID);
            break;
          case 'work':
            data = await this.fetchWorkFromSqlServer(item.RecordID);
            break;
          case 'patients':
            data = await this.fetchPatientFromSqlServer(item.RecordID);
            break;
          default:
            throw new Error(`Unknown table type: ${item.TableName}`);
        }

        if (!data) {
          // Record no longer exists (was deleted before sync)
          log.info(`  ⚠️  Record not found in SQL Server - marking as skipped`);
          await this.executeUpdate(
            `
                        UPDATE SyncQueue
                        SET Status = 'Skipped',
                            LastAttempt = GETDATE(),
                            LastError = 'Record not found in source table'
                        WHERE QueueID = @id
                    `,
            [['id', TYPES.Int, item.QueueID]]
          );
          return true; // Consider as success (nothing to sync)
        }
      }

      const primaryKey = this.getPrimaryKey(item.TableName);
      log.info(`🔄 Syncing ${item.TableName} ID ${item.RecordID} (${item.Operation})`);

      // Handle different operations
      let error;
      if (item.Operation === 'DELETE') {
        // Delete from Supabase
        // Cast through unknown for dynamic property access based on table's primary key
        const dataRecord = data as unknown as Record<string, unknown>;
        const result = await supabase
          .from(item.TableName)
          .delete()
          .eq(primaryKey, dataRecord[primaryKey]);
        error = result.error;
      } else {
        // Before upserting, ensure related records exist
        await this.ensureRelatedRecordsExist(data!, item.TableName);

        // Upsert to Supabase (INSERT or UPDATE)
        const result = await supabase.from(item.TableName).upsert(data, { onConflict: primaryKey });
        error = result.error;
      }

      if (error) throw error;

      // Mark as synced and store JSON for future reference
      log.info(`📝 Attempting to mark QueueID ${item.QueueID} as Synced...`);
      const jsonData = JSON.stringify(data);
      const updateResult = await this.executeUpdate(
        `
                UPDATE SyncQueue
                SET Status = 'Synced',
                    JsonData = @json,
                    LastAttempt = GETDATE()
                WHERE QueueID = @id
            `,
        [
          ['id', TYPES.Int, item.QueueID],
          ['json', TYPES.NVarChar, jsonData],
        ]
      );

      log.info(`  ✅ Synced successfully (UPDATE affected ${updateResult} rows)`);
      return true;
    } catch (error) {
      log.error(`  ❌ Sync failed: ${(error as Error).message}`);

      // Increment attempts
      const newAttempts = item.Attempts + 1;
      const newStatus = newAttempts >= this.maxAttempts ? 'Failed' : 'Pending';

      await this.executeUpdate(
        `
                UPDATE SyncQueue
                SET Attempts = @attempts,
                    LastAttempt = GETDATE(),
                    LastError = @error,
                    Status = @status
                WHERE QueueID = @id
            `,
        [
          ['id', TYPES.Int, item.QueueID],
          ['attempts', TYPES.Int, newAttempts],
          ['error', TYPES.NVarChar, (error as Error).message.substring(0, 500)],
          ['status', TYPES.VarChar, newStatus],
        ]
      );

      if (newStatus === 'Failed') {
        log.error(`  ⚠️  Max attempts reached. Marked as FAILED.`);
      }

      return false;
    }
  }

  /**
   * Process the queue
   */
  async processQueue(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      // Get pending items
      const query = `
                SELECT TOP ${this.batchSize} *
                FROM SyncQueue
                WHERE Status = 'Pending'
                  AND Attempts < @maxAttempts
                ORDER BY QueueID
            `;

      const items = await executeQuery<QueueItem>(
        query,
        [['maxAttempts', TYPES.Int, this.maxAttempts]],
        (columns) => ({
          QueueID: columns[0].value as number,
          TableName: columns[1].value as string,
          RecordID: columns[2].value as number,
          Operation: columns[3].value as 'INSERT' | 'UPDATE' | 'DELETE',
          JsonData: columns[4].value as string | null,
          CreatedAt: columns[5].value as Date,
          Attempts: columns[6].value as number,
          LastAttempt: columns[7].value as Date | null,
          LastError: columns[8].value as string | null,
          Status: columns[9].value as string,
        })
      );

      if (items && items.length > 0) {
        log.info(`\n📦 Processing ${items.length} items from sync queue...`);

        let successCount = 0;
        let failCount = 0;

        for (const item of items) {
          const success = await this.processItem(item);
          if (success) {
            successCount++;
          } else {
            failCount++;
          }
        }

        log.info(`✅ Batch complete: ${successCount} synced, ${failCount} failed\n`);

        // If there are failed items, schedule retry with exponential backoff
        if (failCount > 0) {
          this.scheduleRetry();
        } else {
          // All succeeded - reset retry attempts
          this.retryAttempts = 0;

          // Check if there are more items to process
          const pendingCount = await this.getPendingCount();
          if (pendingCount > 0) {
            log.info(`📦 ${pendingCount} more items in queue - continuing processing...`);
            // Process next batch immediately (recursive call)
            setImmediate(() => this.processQueue());
          } else {
            log.info('✅ Queue fully processed - all items synced\n');
          }
        }
      } else {
        // Queue is empty - reset retry attempts
        this.retryAttempts = 0;
      }
    } catch (error) {
      log.error('❌ Queue processor error:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Get queue statistics
   */
  async getStats(): Promise<QueueStats[]> {
    try {
      const stats = await executeQuery<QueueStats>(
        `
                SELECT
                    Status,
                    COUNT(*) as Count,
                    MIN(CreatedAt) as OldestItem,
                    MAX(CreatedAt) as NewestItem
                FROM SyncQueue
                GROUP BY Status
            `,
        [],
        (columns) => ({
          Status: columns[0].value as string,
          Count: columns[1].value as number,
          OldestItem: columns[2].value as Date,
          NewestItem: columns[3].value as Date,
        })
      );

      return stats || [];
    } catch (error) {
      log.error('Error getting stats:', error);
      return [];
    }
  }

  /**
   * Print statistics
   */
  async printStats(): Promise<void> {
    const stats = await this.getStats();

    if (stats.length === 0) {
      log.info('📊 Queue is empty');
      return;
    }

    log.info('\n📊 Queue Statistics:');
    log.info('═══════════════════════════════════════');
    stats.forEach((stat) => {
      log.info(`  ${stat.Status}: ${stat.Count} items`);
    });
    log.info('═══════════════════════════════════════\n');
  }

  /**
   * Schedule retry with exponential backoff
   * 1st retry: 1 minute
   * 2nd retry: 2 minutes
   * 3rd retry: 4 minutes
   * 4th retry: 8 minutes
   * 5th retry: 16 minutes
   * 6th retry: 32 minutes
   * 7th+ retry: 60 minutes (capped)
   */
  scheduleRetry(): void {
    // Clear existing retry timer
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }

    // Calculate retry interval with exponential backoff
    const retryDelay = Math.min(
      this.baseRetryInterval * Math.pow(2, this.retryAttempts),
      this.maxRetryInterval
    );

    this.retryAttempts++;

    // Schedule retry
    this.retryTimer = setTimeout(async () => {
      log.info(`🔄 Retry attempt #${this.retryAttempts}: Checking for pending items...`);

      // Check if there are still pending items before processing
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

  /**
   * Get count of pending items
   */
  async getPendingCount(): Promise<number> {
    try {
      const result = await executeQuery<{ PendingCount: number }>(
        `
                SELECT COUNT(*) as PendingCount
                FROM SyncQueue
                WHERE Status = 'Pending'
                  AND Attempts < @maxAttempts
            `,
        [['maxAttempts', TYPES.Int, this.maxAttempts]],
        (columns) => ({
          PendingCount: columns[0].value as number,
        })
      );

      return result && result.length > 0 ? result[0].PendingCount : 0;
    } catch (error) {
      log.error('Error getting pending count:', error);
      return 0;
    }
  }

  /**
   * Process queue once (webhook-triggered)
   */
  async processQueueOnce(): Promise<void> {
    if (this.isProcessing) {
      log.info('⏭️  Queue already processing, skipping...');
      return;
    }

    // Reset retry attempts when webhook fires (new data = fresh start)
    this.retryAttempts = 0;

    await this.processQueue();
  }

  /**
   * Start the processor (webhook mode - NO polling)
   */
  start(): void {
    log.info('🚀 Queue Processor Started (Webhook-Triggered Mode)');
    log.info('   ✅ Zero polling - waits for SQL Server notifications');
    log.info('   ✅ Smart retry - exponential backoff for failed items');
    log.info(`   Batch size: ${this.batchSize}`);
    log.info(`   Max attempts per item: ${this.maxAttempts}`);
    log.info(`   Retry strategy: 1m → 2m → 4m → 8m → 16m → 32m → 60m`);
    log.info('═══════════════════════════════════════\n');

    // NO polling timers - webhook will trigger processing
    // Process once on startup to clear any existing queue
    this.processQueue();
  }

  /**
   * Stop the processor
   */
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

// Handle graceful shutdown
process.on('SIGINT', () => {
  log.info('\n🛑 Shutting down queue processor...');
  queueProcessor.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  log.info('\n🛑 Shutting down queue processor...');
  queueProcessor.stop();
  process.exit(0);
});

export default queueProcessor;
