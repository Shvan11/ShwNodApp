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
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * Sync Direction: SQL Server → PostgreSQL
 * Syncs read-only data that clinic updates
 */
class SqlToPostgresSync {

    /**
     * Sync aligner sets (new sets, status changes, etc.)
     */
    async syncAlignerSets(sinceTimestamp = null) {
        console.log('🔄 Syncing Aligner Sets: SQL Server → PostgreSQL');

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

        const params = sinceTimestamp ? [['since', TYPES.DateTime, sinceTimestamp]] : [];

        const sets = await executeQuery(query, params, (columns) => ({
            aligner_set_id: columns[0].value,
            work_id: columns[1].value,
            aligner_dr_id: columns[2].value,
            set_sequence: columns[3].value,
            type: columns[4].value,
            upper_aligners_count: columns[5].value || 0,
            lower_aligners_count: columns[6].value || 0,
            remaining_upper_aligners: columns[7].value || 0,
            remaining_lower_aligners: columns[8].value || 0,
            creation_date: columns[9].value,
            days: columns[10].value,
            is_active: columns[11].value,
            notes: columns[12].value,
            folder_path: columns[13].value,
            set_url: columns[14].value,
            set_pdf_url: columns[15].value,
            set_cost: columns[16].value,
            set_cost: columns[16].value,
            currency: columns[17].value || 'USD',
            pdf_uploaded_at: columns[18].value,
            pdf_uploaded_by: columns[19].value,
            drive_file_id: columns[20].value
        }));

        if (sets.length === 0) {
            console.log('  ℹ️  No new sets to sync');
            return { synced: 0 };
        }

        // Upsert to Supabase
        const { error } = await supabase
            .from('aligner_sets')
            .upsert(sets, { onConflict: 'aligner_set_id' });

        if (error) {
            console.error('  ❌ Error syncing sets:', error);
            throw error;
        }

        console.log(`  ✅ Synced ${sets.length} aligner sets`);
        return { synced: sets.length };
    }

    /**
     * Sync aligner batches (delivery updates)
     * Note: We DON'T overwrite Days field if it was edited by doctor
     */
    async syncAlignerBatches(sinceTimestamp = null) {
        console.log('🔄 Syncing Aligner Batches: SQL Server → PostgreSQL');

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

        const params = sinceTimestamp ? [['since', TYPES.DateTime, sinceTimestamp]] : [];

        const batches = await executeQuery(query, params, (columns) => ({
            aligner_batch_id: columns[0].value,
            aligner_set_id: columns[1].value,
            batch_sequence: columns[2].value,
            upper_aligner_count: columns[3].value || 0,
            lower_aligner_count: columns[4].value || 0,
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
        }));

        if (batches.length === 0) {
            console.log('  ℹ️  No new batches to sync');
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
                console.log(`  ⚠️  Preserving doctor-edited days for batch ${batch.aligner_batch_id}`);
            }
        }

        const { error } = await supabase
            .from('aligner_batches')
            .upsert(batches, { onConflict: 'aligner_batch_id' });

        if (error) {
            console.error('  ❌ Error syncing batches:', error);
            throw error;
        }

        console.log(`  ✅ Synced ${batches.length} aligner batches`);
        return { synced: batches.length };
    }

    /**
     * Sync payment summary
     */
    async syncPaymentSummary() {
        console.log('🔄 Syncing Payment Summary: SQL Server → PostgreSQL');

        try {
            const query = `
                SELECT
                    AlignerSetID,
                    TotalPaid,
                    Balance,
                    PaymentStatus
                FROM vw_AlignerSetPayments
            `;

            const payments = await executeQuery(query, [], (columns) => ({
                aligner_set_id: columns[0].value,
                total_paid: columns[1].value || 0,
                balance: columns[2].value || 0,
                payment_status: columns[3].value || 'Unpaid'
            }));

            if (payments.length === 0) {
                console.log('  ℹ️  No payment data to sync');
                return { synced: 0 };
            }

            const { error } = await supabase
                .from('aligner_set_payments')
                .upsert(payments, { onConflict: 'aligner_set_id' });

            if (error) {
                console.error('  ❌ Error syncing payments:', error);
                throw error;
            }

            console.log(`  ✅ Synced ${payments.length} payment records`);
            return { synced: payments.length };

        } catch (error) {
            console.log('  ⚠️  Payment sync skipped (view may not exist)');
            return { synced: 0 };
        }
    }

    /**
     * Run full sync from SQL Server to PostgreSQL
     */
    async syncToPostgres(incrementalSince = null) {
        console.log('\n🚀 Starting SQL Server → PostgreSQL Sync');
        console.log('==========================================');

        const results = {
            sets: await this.syncAlignerSets(incrementalSince),
            batches: await this.syncAlignerBatches(incrementalSince),
            payments: await this.syncPaymentSummary()
        };

        console.log('==========================================');
        console.log('✅ Sync completed');
        console.log(`   Sets: ${results.sets.synced}`);
        console.log(`   Batches: ${results.batches.synced}`);
        console.log(`   Payments: ${results.payments.synced}`);
        console.log('==========================================\n');

        return results;
    }
}

/**
 * Sync Direction: PostgreSQL → SQL Server
 * Handles doctor edits (notes, batch days)
 */
class PostgresToSqlSync {

    /**
     * Sync new note from Supabase to SQL Server
     */
    async syncNoteToSqlServer(note) {
        console.log(`🔄 Syncing note ${note.note_id} to SQL Server`);

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
            ['isRead', TYPES.Bit, note.is_read !== undefined ? note.is_read : true]
        ]);

        console.log(`  ✅ Note synced to SQL Server`);
    }

    /**
     * Sync batch days update from Supabase to SQL Server
     * Note: SQL Server trigger now has change detection - only fires if data actually changed
     */
    async syncBatchDaysToSqlServer(batch) {
        console.log(`🔄 Syncing batch ${batch.aligner_batch_id} days to SQL Server`);

        const query = `
            UPDATE tblAlignerBatches
            SET Days = @days
            WHERE AlignerBatchID = @batchId
        `;

        await executeQuery(query, [
            ['days', TYPES.Int, batch.days],
            ['batchId', TYPES.Int, batch.aligner_batch_id]
        ]);

        console.log(`  ✅ Batch days synced (trigger only fires if value changed)`);
    }

    /**
     * Handle Supabase webhook payload
     *
     * IMPORTANT: Only sync changes that were EDITED by doctors, not initial creates from SQL Server
     * This prevents circular sync loops (SQL → Supabase → SQL → ...)
     */
    async handleWebhook(payload) {
        const { table, record, type, old_record } = payload;

        console.log(`\n📥 Received webhook: ${table} - ${type}`);

        try {
            if (table === 'aligner_notes' && (type === 'INSERT' || type === 'UPDATE')) {
                // Only sync notes added/edited by doctors (note_type = 'Doctor')
                if (record.note_type === 'Doctor') {
                    await this.syncNoteToSqlServer(record);
                } else {
                    console.log('  ⏭️  Lab note - skipping (already in SQL Server)');
                }
            } else if (table === 'aligner_batches' && type === 'UPDATE') {
                // Only sync if:
                // 1. Days field actually changed
                // 2. The batch was EDITED by doctor (updated_at > created_at)
                const daysChanged = !old_record || old_record.days !== record.days;
                const isEdited = record.updated_at && record.created_at &&
                                 new Date(record.updated_at) > new Date(record.created_at);

                if (daysChanged && isEdited) {
                    console.log('  📝 Doctor edited batch days - syncing to SQL Server');
                    await this.syncBatchDaysToSqlServer(record);
                } else if (daysChanged && !isEdited) {
                    console.log('  ⏭️  Batch just created/updated from SQL Server - skipping to prevent loop');
                } else {
                    console.log('  ⏭️  Days unchanged - skipping');
                }
            } else {
                console.log('  ℹ️  Event not relevant for sync, skipping');
            }

            return { success: true };

        } catch (error) {
            console.error('  ❌ Webhook processing failed:', error);
            return { success: false, error: error.message };
        }
    }
}

// Export sync engines
const sqlToPostgres = new SqlToPostgresSync();
const postgresToSql = new PostgresToSqlSync();

export {
    sqlToPostgres,
    postgresToSql
};
