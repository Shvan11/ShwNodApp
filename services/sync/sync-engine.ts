/**
 * @deprecated This file is deprecated in favor of unified-sync-processor.js
 *
 * OLD Two-Way Sync Engine: SQL Server ↔ PostgreSQL (Supabase)
 * - SQL → PostgreSQL sync has been replaced by unified-sync-processor.js (queue-based)
 * - PostgreSQL → SQL sync (postgresToSql) is still used for webhook handling
 *
 * Migration Notes:
 * - Use unified-sync-processor.js for all SQL Server → Supabase syncs
 * - The new method uses SyncQueue + triggers for automatic, reliable syncing
 * - Old direct-query methods (syncAlignerSets, syncAlignerBatches, etc.) should not be used
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
 * Aligner set record for Supabase
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
}

/**
 * Aligner batch record for Supabase
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
}

/**
 * Payment summary record
 */
interface PaymentSummaryRecord {
  aligner_set_id: number;
  total_paid: number;
  balance: number;
  payment_status: string;
}

/**
 * Aligner note record
 */
interface AlignerNoteRecord {
  note_id: number;
  aligner_set_id: number;
  note_type: string;
  note_text: string;
  created_at: Date;
  is_edited: boolean;
  edited_at: Date | null;
  is_read?: boolean;
}

/**
 * Sync result
 */
interface SyncResult {
  synced: number;
}

/**
 * Full sync results
 */
interface FullSyncResults {
  sets: SyncResult;
  batches: SyncResult;
  payments: SyncResult;
}

/**
 * Webhook payload
 */
interface WebhookPayload {
  table: string;
  record: AlignerNoteRecord | AlignerBatchRecord;
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  old_record?: AlignerNoteRecord | AlignerBatchRecord;
}

/**
 * Webhook result
 */
interface WebhookResult {
  success: boolean;
  error?: string;
}

// =============================================================================
// SUPABASE CLIENT
// =============================================================================

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase: SupabaseClient = createClient(supabaseUrl, supabaseServiceKey);

// =============================================================================
// SQL TO POSTGRES SYNC
// =============================================================================

/**
 * Sync Direction: SQL Server → PostgreSQL
 * Syncs read-only data that clinic updates
 */
class SqlToPostgresSync {
  /**
   * Sync aligner sets (new sets, status changes, etc.)
   */
  async syncAlignerSets(sinceTimestamp: Date | null = null): Promise<SyncResult> {
    log.info('🔄 Syncing Aligner Sets: SQL Server → PostgreSQL');

    // Get sets modified since last sync
    const query = `
            SELECT
                AlignerSetID,
                WorkID,
                AlignerDrID,
                SetSequence,
                Type,
                UpperAlignersCount,
                LowerAlignersCount,
                RemainingUpperAligners,
                RemainingLowerAligners,
                CreationDate,
                Days,
                IsActive,
                Notes,
                FolderPath,
                SetUrl,
                SetPdfUrl,
                SetCost,
                Currency,
                PdfUploadedAt,
                PdfUploadedBy,
                DriveFileId
            FROM tblAlignerSets
            ${sinceTimestamp ? 'WHERE CreationDate >= @since OR PdfUploadedAt >= @since' : ''}
            ORDER BY AlignerSetID
        `;

    const params: [string, typeof TYPES[keyof typeof TYPES], Date][] = sinceTimestamp
      ? [['since', TYPES.DateTime, sinceTimestamp]]
      : [];

    const sets = await executeQuery<AlignerSetRecord>(query, params, (columns) => ({
      aligner_set_id: columns[0].value as number,
      work_id: columns[1].value as number,
      aligner_dr_id: columns[2].value as number,
      set_sequence: columns[3].value as number,
      type: columns[4].value as string,
      upper_aligners_count: (columns[5].value as number) || 0,
      lower_aligners_count: (columns[6].value as number) || 0,
      remaining_upper_aligners: (columns[7].value as number) || 0,
      remaining_lower_aligners: (columns[8].value as number) || 0,
      creation_date: columns[9].value as Date,
      days: columns[10].value as number,
      is_active: columns[11].value as boolean,
      notes: columns[12].value as string,
      folder_path: columns[13].value as string,
      set_url: columns[14].value as string,
      set_pdf_url: columns[15].value as string,
      set_cost: columns[16].value as number,
      currency: (columns[17].value as string) || 'USD',
      pdf_uploaded_at: columns[18].value as Date | null,
      pdf_uploaded_by: columns[19].value as string,
      drive_file_id: columns[20].value as string,
    }));

    if (sets.length === 0) {
      log.info('  ℹ️  No new sets to sync');
      return { synced: 0 };
    }

    // Upsert to Supabase
    const { error } = await supabase.from('aligner_sets').upsert(sets, {
      onConflict: 'aligner_set_id',
    });

    if (error) {
      log.error('  ❌ Error syncing sets:', error);
      throw error;
    }

    log.info(`  ✅ Synced ${sets.length} aligner sets`);
    return { synced: sets.length };
  }

  /**
   * Sync aligner batches (delivery updates)
   * Note: We DON'T overwrite Days field if it was edited by doctor
   */
  async syncAlignerBatches(sinceTimestamp: Date | null = null): Promise<SyncResult> {
    log.info('🔄 Syncing Aligner Batches: SQL Server → PostgreSQL');

    const query = `
            SELECT
                AlignerBatchID,
                AlignerSetID,
                BatchSequence,
                UpperAlignerCount,
                LowerAlignerCount,
                UpperAlignerStartSequence,
                UpperAlignerEndSequence,
                LowerAlignerStartSequence,
                LowerAlignerEndSequence,
                ManufactureDate,
                DeliveredToPatientDate,
                Days,
                ValidityPeriod,
                NextBatchReadyDate,
                Notes,
                IsActive
            FROM tblAlignerBatches
            ${sinceTimestamp ? 'WHERE ManufactureDate >= @since OR DeliveredToPatientDate >= @since' : ''}
            ORDER BY AlignerBatchID
        `;

    const params: [string, typeof TYPES[keyof typeof TYPES], Date][] = sinceTimestamp
      ? [['since', TYPES.DateTime, sinceTimestamp]]
      : [];

    const batches = await executeQuery<AlignerBatchRecord>(query, params, (columns) => ({
      aligner_batch_id: columns[0].value as number,
      aligner_set_id: columns[1].value as number,
      batch_sequence: columns[2].value as number,
      upper_aligner_count: (columns[3].value as number) || 0,
      lower_aligner_count: (columns[4].value as number) || 0,
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
    }));

    if (batches.length === 0) {
      log.info('  ℹ️  No new batches to sync');
      return { synced: 0 };
    }

    // For each batch, check if Days was edited by doctor in Supabase
    // If edited (updated_at > created_at), preserve doctor's Days value
    for (const batch of batches) {
      const { data: existing } = await supabase
        .from('aligner_batches')
        .select('days, updated_at, created_at')
        .eq('aligner_batch_id', batch.aligner_batch_id)
        .single();

      if (existing && existing.updated_at > existing.created_at) {
        // Doctor edited this batch - preserve their Days value
        batch.days = existing.days;
        log.info(`  ⚠️  Preserving doctor-edited days for batch ${batch.aligner_batch_id}`);
      }
    }

    const { error } = await supabase.from('aligner_batches').upsert(batches, {
      onConflict: 'aligner_batch_id',
    });

    if (error) {
      log.error('  ❌ Error syncing batches:', error);
      throw error;
    }

    log.info(`  ✅ Synced ${batches.length} aligner batches`);
    return { synced: batches.length };
  }

  /**
   * Sync payment summary
   */
  async syncPaymentSummary(): Promise<SyncResult> {
    log.info('🔄 Syncing Payment Summary: SQL Server → PostgreSQL');

    try {
      const query = `
                SELECT
                    AlignerSetID,
                    TotalPaid,
                    Balance,
                    PaymentStatus
                FROM vw_AlignerSetPayments
            `;

      const payments = await executeQuery<PaymentSummaryRecord>(query, [], (columns) => ({
        aligner_set_id: columns[0].value as number,
        total_paid: (columns[1].value as number) || 0,
        balance: (columns[2].value as number) || 0,
        payment_status: (columns[3].value as string) || 'Unpaid',
      }));

      if (payments.length === 0) {
        log.info('  ℹ️  No payment data to sync');
        return { synced: 0 };
      }

      const { error } = await supabase.from('aligner_set_payments').upsert(payments, {
        onConflict: 'aligner_set_id',
      });

      if (error) {
        log.error('  ❌ Error syncing payments:', error);
        throw error;
      }

      log.info(`  ✅ Synced ${payments.length} payment records`);
      return { synced: payments.length };
    } catch (error) {
      log.info('  ⚠️  Payment sync skipped (view may not exist)');
      return { synced: 0 };
    }
  }

  /**
   * Run full sync from SQL Server to PostgreSQL
   */
  async syncToPostgres(incrementalSince: Date | null = null): Promise<FullSyncResults> {
    log.info('\n🚀 Starting SQL Server → PostgreSQL Sync');
    log.info('==========================================');

    const results: FullSyncResults = {
      sets: await this.syncAlignerSets(incrementalSince),
      batches: await this.syncAlignerBatches(incrementalSince),
      payments: await this.syncPaymentSummary(),
    };

    log.info('==========================================');
    log.info('✅ Sync completed');
    log.info(`   Sets: ${results.sets.synced}`);
    log.info(`   Batches: ${results.batches.synced}`);
    log.info(`   Payments: ${results.payments.synced}`);
    log.info('==========================================\n');

    return results;
  }
}

// =============================================================================
// POSTGRES TO SQL SYNC
// =============================================================================

/**
 * Sync Direction: PostgreSQL → SQL Server
 * Handles doctor edits (notes, batch days)
 */
class PostgresToSqlSync {
  /**
   * Sync new note from Supabase to SQL Server
   */
  async syncNoteToSqlServer(note: AlignerNoteRecord): Promise<void> {
    log.info(`🔄 Syncing note ${note.note_id} to SQL Server`);

    const query = `
            IF NOT EXISTS (SELECT 1 FROM tblAlignerNotes WHERE NoteID = @noteId)
            BEGIN
                SET IDENTITY_INSERT tblAlignerNotes ON;
                INSERT INTO tblAlignerNotes (
                    NoteID, AlignerSetID, NoteType, NoteText, CreatedAt, IsEdited, EditedAt, IsRead
                )
                VALUES (
                    @noteId, @setId, @noteType, @noteText, @createdAt, @isEdited, @editedAt, @isRead
                );
                SET IDENTITY_INSERT tblAlignerNotes OFF;
            END
        `;

    await executeQuery(query, [
      ['noteId', TYPES.Int, note.note_id],
      ['setId', TYPES.Int, note.aligner_set_id],
      ['noteType', TYPES.VarChar, note.note_type],
      ['noteText', TYPES.NVarChar, note.note_text],
      ['createdAt', TYPES.DateTime, new Date(note.created_at)],
      ['isEdited', TYPES.Bit, note.is_edited || false],
      ['editedAt', TYPES.DateTime, note.edited_at ? new Date(note.edited_at) : null],
      ['isRead', TYPES.Bit, note.is_read !== undefined ? note.is_read : true],
    ]);

    log.info(`  ✅ Note synced to SQL Server`);
  }

  /**
   * Sync batch days update from Supabase to SQL Server
   * Note: SQL Server trigger now has change detection - only fires if data actually changed
   */
  async syncBatchDaysToSqlServer(batch: Pick<AlignerBatchRecord, 'aligner_batch_id' | 'days'>): Promise<void> {
    log.info(`🔄 Syncing batch ${batch.aligner_batch_id} days to SQL Server`);

    const query = `
            UPDATE tblAlignerBatches
            SET Days = @days
            WHERE AlignerBatchID = @batchId
        `;

    await executeQuery(query, [
      ['days', TYPES.Int, batch.days],
      ['batchId', TYPES.Int, batch.aligner_batch_id],
    ]);

    log.info(`  ✅ Batch days synced (trigger only fires if value changed)`);
  }

  /**
   * Handle Supabase webhook payload
   *
   * IMPORTANT: Only sync changes that were EDITED by doctors, not initial creates from SQL Server
   * This prevents circular sync loops (SQL → Supabase → SQL → ...)
   */
  async handleWebhook(payload: WebhookPayload): Promise<WebhookResult> {
    const { table, record, type, old_record } = payload;

    log.info(`\n📥 Received webhook: ${table} - ${type}`);

    try {
      if (table === 'aligner_notes' && (type === 'INSERT' || type === 'UPDATE')) {
        const noteRecord = record as AlignerNoteRecord;
        // Only sync notes added/edited by doctors (note_type = 'Doctor')
        if (noteRecord.note_type === 'Doctor') {
          await this.syncNoteToSqlServer(noteRecord);
        } else {
          log.info('  ⏭️  Lab note - skipping (already in SQL Server)');
        }
      } else if (table === 'aligner_batches' && type === 'UPDATE') {
        const batchRecord = record as AlignerBatchRecord;
        const oldBatchRecord = old_record as AlignerBatchRecord | undefined;
        // Only sync if:
        // 1. Days field actually changed
        // 2. The batch was EDITED by doctor (updated_at > created_at)
        const daysChanged = !oldBatchRecord || oldBatchRecord.days !== batchRecord.days;
        const recordWithDates = batchRecord as AlignerBatchRecord & { updated_at?: string; created_at?: string };
        const isEdited =
          recordWithDates.updated_at &&
          recordWithDates.created_at &&
          new Date(recordWithDates.updated_at) > new Date(recordWithDates.created_at);

        if (daysChanged && isEdited) {
          log.info('  📝 Doctor edited batch days - syncing to SQL Server');
          await this.syncBatchDaysToSqlServer(batchRecord);
        } else if (daysChanged && !isEdited) {
          log.info('  ⏭️  Batch just created/updated from SQL Server - skipping to prevent loop');
        } else {
          log.info('  ⏭️  Days unchanged - skipping');
        }
      } else {
        log.info('  ℹ️  Event not relevant for sync, skipping');
      }

      return { success: true };
    } catch (error) {
      log.error('  ❌ Webhook processing failed:', error);
      return { success: false, error: (error as Error).message };
    }
  }
}

// Export sync engines
const sqlToPostgres = new SqlToPostgresSync();
const postgresToSql = new PostgresToSqlSync();

export { sqlToPostgres, postgresToSql };
export type { WebhookPayload };
