/**
 * Reverse Sync Engine: PostgreSQL (Supabase) → SQL Server
 *
 * Handles syncing doctor edits from Supabase back to SQL Server:
 * - Doctor notes (note_type = 'Doctor')
 * - Batch days updates
 *
 * Note: SQL Server → Supabase sync is handled by queue-processor.ts
 */

import { executeQuery, TYPES } from '../database/index.js';
import { log } from '../../utils/logger.js';

// =============================================================================
// TYPES
// =============================================================================

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
  batch_expiry_date: Date | null;
  notes: string;
  is_active: boolean;
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

// Export sync engine
const postgresToSql = new PostgresToSqlSync();

export { postgresToSql };
export type { WebhookPayload, AlignerNoteRecord, AlignerBatchRecord };
