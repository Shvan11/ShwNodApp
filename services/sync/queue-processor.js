/**
 * SQL Server → PostgreSQL Queue Processor
 * Processes sync queue and pushes changes to Supabase
 */

import { executeQuery, TYPES, executeStoredProcedure } from '../database/index.js';
import { Connection, Request } from 'tedious';
import ConnectionPool from '../database/ConnectionPool.js';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

class QueueProcessor {
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
    async executeUpdate(query, params) {
        return ConnectionPool.withConnection(async (connection) => {
            return new Promise((resolve, reject) => {
                let actualRowCount = 0;

                const request = new Request(query, (err, rowCount) => {
                    if (err) {
                        console.error('❌ Update query error:', err.message);
                        reject(err);
                        return;
                    }
                    // Store the actual row count from the callback
                    actualRowCount = rowCount || 0;
                });

                // Add parameters
                (params || []).forEach(param => {
                    request.addParameter(param[0], param[1], param[2]);
                });

                // Listen for requestCompleted event - this fires when query is done
                request.on('requestCompleted', () => {
                    // Resolve with the row count we got from the main callback
                    resolve(actualRowCount);
                });

                // Listen for errors
                request.on('error', (err) => {
                    console.error('❌ UPDATE request error:', err.message);
                    reject(err);
                });

                connection.execSql(request);
            });
        });
    }

    /**
     * Get primary key field for each table
     */
    getPrimaryKey(tableName) {
        const keys = {
            'aligner_doctors': 'dr_id',
            'aligner_sets': 'aligner_set_id',
            'aligner_batches': 'aligner_batch_id',
            'aligner_notes': 'note_id',
            'aligner_set_payments': 'aligner_set_id',
            'patients': 'person_id',
            'work': 'work_id'
        };
        return keys[tableName] || 'id';
    }

    /**
     * Fetch work record from SQL Server
     */
    async fetchWorkFromSqlServer(workId) {
        const query = `
            SELECT
                workid as work_id,
                PersonID as person_id,
                Typeofwork as type_of_work,
                AdditionDate as addition_date
            FROM tblWork
            WHERE workid = @workId
        `;

        const results = await executeQuery(
            query,
            [['workId', TYPES.Int, workId]],
            (columns) => ({
                work_id: columns[0].value,
                person_id: columns[1].value,
                type_of_work: columns[2].value,
                addition_date: columns[3].value
            })
        );

        return results && results.length > 0 ? results[0] : null;
    }

    /**
     * Fetch patient record from SQL Server
     */
    async fetchPatientFromSqlServer(personId) {
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

        const results = await executeQuery(
            query,
            [['personId', TYPES.Int, personId]],
            (columns) => ({
                person_id: columns[0].value,
                patient_id: columns[1].value,
                patient_name: columns[2].value,
                first_name: columns[3].value,
                last_name: columns[4].value,
                phone: columns[5].value
            })
        );

        return results && results.length > 0 ? results[0] : null;
    }

    /**
     * Fetch aligner set record from SQL Server
     */
    async fetchAlignerSetFromSqlServer(alignerSetId) {
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

        const results = await executeQuery(
            query,
            [['alignerSetId', TYPES.Int, alignerSetId]],
            (columns) => ({
                aligner_set_id: columns[0].value,
                work_id: columns[1].value,
                aligner_dr_id: columns[2].value,
                set_sequence: columns[3].value,
                type: columns[4].value,
                upper_aligners_count: columns[5].value,
                lower_aligners_count: columns[6].value,
                remaining_upper_aligners: columns[7].value,
                remaining_lower_aligners: columns[8].value,
                creation_date: columns[9].value,
                days: columns[10].value,
                is_active: columns[11].value,
                notes: columns[12].value,
                folder_path: columns[13].value,
                set_url: columns[14].value,
                set_pdf_url: columns[15].value,
                set_cost: columns[16].value,
                currency: columns[17].value,
                pdf_uploaded_at: columns[18].value,
                pdf_uploaded_by: columns[19].value,
                drive_file_id: columns[20].value
            })
        );

        return results && results.length > 0 ? results[0] : null;
    }

    /**
     * Fetch aligner batch record from SQL Server
     * Used when sync trigger stores only IDs (optimized mode)
     */
    async fetchAlignerBatchFromSqlServer(batchId) {
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

        const results = await executeQuery(
            query,
            [['batchId', TYPES.Int, batchId]],
            (columns) => ({
                aligner_batch_id: columns[0].value,
                aligner_set_id: columns[1].value,
                batch_sequence: columns[2].value,
                upper_aligner_count: columns[3].value,
                lower_aligner_count: columns[4].value,
                upper_aligner_start_sequence: columns[5].value,
                upper_aligner_end_sequence: columns[6].value,
                lower_aligner_start_sequence: columns[7].value,
                lower_aligner_end_sequence: columns[8].value,
                manufacture_date: columns[9].value,
                delivered_to_patient_date: columns[10].value,
                days: columns[11].value,
                validity_period: columns[12].value,
                next_batch_ready_date: columns[13].value,
                notes: columns[14].value,
                is_active: columns[15].value
            })
        );

        return results && results.length > 0 ? results[0] : null;
    }

    /**
     * Ensure related work and patient exist in Supabase (for aligner_sets)
     */
    async ensureRelatedRecordsExist(data, tableName) {
        try {
            // Handle aligner_sets - ensure work and patient exist
            if (tableName === 'aligner_sets' && data.work_id) {
                // Check if work exists in Supabase
                const { data: workExists, error: workCheckError } = await supabase
                    .from('work')
                    .select('work_id')
                    .eq('work_id', data.work_id)
                    .single();

                if (workCheckError && workCheckError.code === 'PGRST116') {
                    // Work doesn't exist - fetch from SQL Server
                    console.log(`  📥 Fetching missing work record (ID: ${data.work_id}) from SQL Server...`);
                    const workData = await this.fetchWorkFromSqlServer(data.work_id);

                    if (workData) {
                        // Ensure patient exists before syncing work
                        await this.ensureRelatedRecordsExist(workData, 'work');

                        // Sync work to Supabase
                        const { error: workUpsertError } = await supabase
                            .from('work')
                            .upsert(workData, { onConflict: 'work_id' });

                        if (workUpsertError) {
                            console.error(`  ❌ Failed to sync work: ${workUpsertError.message}`);
                        } else {
                            console.log(`  ✅ Work record synced (ID: ${data.work_id})`);
                        }
                    } else {
                        console.warn(`  ⚠️  Work record not found in SQL Server (ID: ${data.work_id})`);
                    }
                }
            }

            // Handle work - ensure patient exists
            if (tableName === 'work' && data.person_id) {
                // Check if patient exists in Supabase
                const { data: patientExists, error: patientCheckError } = await supabase
                    .from('patients')
                    .select('person_id')
                    .eq('person_id', data.person_id)
                    .single();

                if (patientCheckError && patientCheckError.code === 'PGRST116') {
                    // Patient doesn't exist - fetch from SQL Server
                    console.log(`  📥 Fetching missing patient record (ID: ${data.person_id}) from SQL Server...`);
                    const patientData = await this.fetchPatientFromSqlServer(data.person_id);

                    if (patientData) {
                        // Sync patient to Supabase
                        const { error: patientUpsertError } = await supabase
                            .from('patients')
                            .upsert(patientData, { onConflict: 'person_id' });

                        if (patientUpsertError) {
                            console.error(`  ❌ Failed to sync patient: ${patientUpsertError.message}`);
                        } else {
                            console.log(`  ✅ Patient record synced (ID: ${data.person_id})`);
                        }
                    } else {
                        console.warn(`  ⚠️  Patient record not found in SQL Server (ID: ${data.person_id})`);
                    }
                }
            }

            // Handle aligner_batches - ensure aligner_set exists
            if (tableName === 'aligner_batches' && data.aligner_set_id) {
                // Check if aligner_set exists in Supabase
                const { data: setExists, error: setCheckError } = await supabase
                    .from('aligner_sets')
                    .select('aligner_set_id')
                    .eq('aligner_set_id', data.aligner_set_id)
                    .single();

                if (setCheckError && setCheckError.code === 'PGRST116') {
                    // Aligner set doesn't exist - fetch from SQL Server
                    console.log(`  📥 Fetching missing aligner set (ID: ${data.aligner_set_id}) from SQL Server...`);
                    const setData = await this.fetchAlignerSetFromSqlServer(data.aligner_set_id);

                    if (setData) {
                        // Ensure work and patient exist before syncing set
                        await this.ensureRelatedRecordsExist(setData, 'aligner_sets');

                        // Sync aligner set to Supabase
                        const { error: setUpsertError } = await supabase
                            .from('aligner_sets')
                            .upsert(setData, { onConflict: 'aligner_set_id' });

                        if (setUpsertError) {
                            console.error(`  ❌ Failed to sync aligner set: ${setUpsertError.message}`);
                        } else {
                            console.log(`  ✅ Aligner set synced (ID: ${data.aligner_set_id})`);
                        }
                    } else {
                        console.warn(`  ⚠️  Aligner set not found in SQL Server (ID: ${data.aligner_set_id})`);
                    }
                }
            }
        } catch (error) {
            console.error(`  ⚠️  Error ensuring related records exist: ${error.message}`);
            // Don't throw - let the main sync continue even if related records fail
        }
    }

    /**
     * Process a single queue item
     */
    async processItem(item) {
        try {
            // Handle JsonData - if NULL, fetch from SQL Server
            let data;
            if (item.JsonData) {
                // Traditional flow: JSON was pre-built by trigger
                data = JSON.parse(item.JsonData);
            } else {
                // Optimized flow: Fetch data on-demand
                console.log(`  📥 JsonData is NULL - fetching fresh data from SQL Server...`);

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
                    console.log(`  ⚠️  Record not found in SQL Server - marking as skipped`);
                    await this.executeUpdate(`
                        UPDATE SyncQueue
                        SET Status = 'Skipped',
                            LastAttempt = GETDATE(),
                            LastError = 'Record not found in source table'
                        WHERE QueueID = @id
                    `, [['id', TYPES.Int, item.QueueID]]);
                    return true; // Consider as success (nothing to sync)
                }
            }

            const primaryKey = this.getPrimaryKey(item.TableName);
            console.log(`🔄 Syncing ${item.TableName} ID ${item.RecordID} (${item.Operation})`);

            // Handle different operations
            let error;
            if (item.Operation === 'DELETE') {
                // Delete from Supabase
                const result = await supabase
                    .from(item.TableName)
                    .delete()
                    .eq(primaryKey, data[primaryKey]);
                error = result.error;
            } else {
                // Before upserting, ensure related records exist
                await this.ensureRelatedRecordsExist(data, item.TableName);

                // Upsert to Supabase (INSERT or UPDATE)
                const result = await supabase
                    .from(item.TableName)
                    .upsert(data, { onConflict: primaryKey });
                error = result.error;
            }

            if (error) throw error;

            // Mark as synced and store JSON for future reference
            console.log(`📝 Attempting to mark QueueID ${item.QueueID} as Synced...`);
            const jsonData = JSON.stringify(data);
            const updateResult = await this.executeUpdate(`
                UPDATE SyncQueue
                SET Status = 'Synced',
                    JsonData = @json,
                    LastAttempt = GETDATE()
                WHERE QueueID = @id
            `, [
                ['id', TYPES.Int, item.QueueID],
                ['json', TYPES.NVarChar, jsonData]
            ]);

            console.log(`  ✅ Synced successfully (UPDATE affected ${updateResult} rows)`);
            return true;

        } catch (error) {
            console.error(`  ❌ Sync failed: ${error.message}`);

            // Increment attempts
            const newAttempts = item.Attempts + 1;
            const newStatus = newAttempts >= this.maxAttempts ? 'Failed' : 'Pending';

            await this.executeUpdate(`
                UPDATE SyncQueue
                SET Attempts = @attempts,
                    LastAttempt = GETDATE(),
                    LastError = @error,
                    Status = @status
                WHERE QueueID = @id
            `, [
                ['id', TYPES.Int, item.QueueID],
                ['attempts', TYPES.Int, newAttempts],
                ['error', TYPES.NVarChar, error.message.substring(0, 500)],
                ['status', TYPES.VarChar, newStatus]
            ]);

            if (newStatus === 'Failed') {
                console.error(`  ⚠️  Max attempts reached. Marked as FAILED.`);
            }

            return false;
        }
    }

    /**
     * Process the queue
     */
    async processQueue() {
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

            const items = await executeQuery(
                query,
                [['maxAttempts', TYPES.Int, this.maxAttempts]],
                (columns) => ({
                    QueueID: columns[0].value,
                    TableName: columns[1].value,
                    RecordID: columns[2].value,
                    Operation: columns[3].value,
                    JsonData: columns[4].value,
                    CreatedAt: columns[5].value,
                    Attempts: columns[6].value,
                    LastAttempt: columns[7].value,
                    LastError: columns[8].value,
                    Status: columns[9].value
                })
            );

            if (items && items.length > 0) {
                console.log(`\n📦 Processing ${items.length} items from sync queue...`);

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

                console.log(`✅ Batch complete: ${successCount} synced, ${failCount} failed\n`);

                // If there are failed items, schedule retry with exponential backoff
                if (failCount > 0) {
                    this.scheduleRetry();
                } else {
                    // All succeeded - reset retry attempts
                    this.retryAttempts = 0;

                    // Check if there are more items to process
                    const pendingCount = await this.getPendingCount();
                    if (pendingCount > 0) {
                        console.log(`📦 ${pendingCount} more items in queue - continuing processing...`);
                        // Process next batch immediately (recursive call)
                        setImmediate(() => this.processQueue());
                    } else {
                        console.log('✅ Queue fully processed - all items synced\n');
                    }
                }
            } else {
                // Queue is empty - reset retry attempts
                this.retryAttempts = 0;
            }

        } catch (error) {
            console.error('❌ Queue processor error:', error);
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Get queue statistics
     */
    async getStats() {
        try {
            const stats = await executeQuery(`
                SELECT
                    Status,
                    COUNT(*) as Count,
                    MIN(CreatedAt) as OldestItem,
                    MAX(CreatedAt) as NewestItem
                FROM SyncQueue
                GROUP BY Status
            `, [], (columns) => ({
                Status: columns[0].value,
                Count: columns[1].value,
                OldestItem: columns[2].value,
                NewestItem: columns[3].value
            }));

            return stats || [];
        } catch (error) {
            console.error('Error getting stats:', error);
            return [];
        }
    }

    /**
     * Print statistics
     */
    async printStats() {
        const stats = await this.getStats();

        if (stats.length === 0) {
            console.log('📊 Queue is empty');
            return;
        }

        console.log('\n📊 Queue Statistics:');
        console.log('═══════════════════════════════════════');
        stats.forEach(stat => {
            console.log(`  ${stat.Status}: ${stat.Count} items`);
        });
        console.log('═══════════════════════════════════════\n');
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
    scheduleRetry() {
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
            console.log(`🔄 Retry attempt #${this.retryAttempts}: Checking for pending items...`);

            // Check if there are still pending items before processing
            const pendingCount = await this.getPendingCount();

            if (pendingCount > 0) {
                console.log(`📋 Found ${pendingCount} pending items, processing...`);
                await this.processQueue();
            } else {
                console.log('✅ No pending items - retry timer cleared');
                this.retryAttempts = 0;
            }

            this.retryTimer = null;
        }, retryDelay);

        const minutes = Math.floor(retryDelay / 60000);
        const seconds = Math.floor((retryDelay % 60000) / 1000);
        console.log(`⏱️  Retry #${this.retryAttempts} scheduled in ${minutes}m ${seconds}s`);
    }

    /**
     * Get count of pending items
     */
    async getPendingCount() {
        try {
            const result = await executeQuery(`
                SELECT COUNT(*) as PendingCount
                FROM SyncQueue
                WHERE Status = 'Pending'
                  AND Attempts < @maxAttempts
            `, [['maxAttempts', TYPES.Int, this.maxAttempts]]);

            return result && result.length > 0 ? result[0].PendingCount : 0;
        } catch (error) {
            console.error('Error getting pending count:', error);
            return 0;
        }
    }

    /**
     * Process queue once (webhook-triggered)
     */
    async processQueueOnce() {
        if (this.isProcessing) {
            console.log('⏭️  Queue already processing, skipping...');
            return;
        }

        // Reset retry attempts when webhook fires (new data = fresh start)
        this.retryAttempts = 0;

        await this.processQueue();
    }

    /**
     * Start the processor (webhook mode - NO polling)
     */
    start() {
        console.log('🚀 Queue Processor Started (Webhook-Triggered Mode)');
        console.log('   ✅ Zero polling - waits for SQL Server notifications');
        console.log('   ✅ Smart retry - exponential backoff for failed items');
        console.log(`   Batch size: ${this.batchSize}`);
        console.log(`   Max attempts per item: ${this.maxAttempts}`);
        console.log(`   Retry strategy: 1m → 2m → 4m → 8m → 16m → 32m → 60m`);
        console.log('═══════════════════════════════════════\n');

        // NO polling timers - webhook will trigger processing
        // Process once on startup to clear any existing queue
        this.processQueue();
    }

    /**
     * Stop the processor
     */
    stop() {
        if (this.retryTimer) {
            clearTimeout(this.retryTimer);
            this.retryTimer = null;
        }
        this.retryAttempts = 0;
        console.log('🛑 Queue Processor Stopped');
    }
}

// Create singleton instance
const queueProcessor = new QueueProcessor();

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down queue processor...');
    queueProcessor.stop();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down queue processor...');
    queueProcessor.stop();
    process.exit(0);
});

export default queueProcessor;
