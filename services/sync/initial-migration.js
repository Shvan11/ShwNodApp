/**
 * Initial Data Migration: SQL Server → PostgreSQL (Supabase)
 * Run this ONCE to migrate existing aligner portal data
 */

import { executeQuery, TYPES } from '../database/index.js';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

// Supabase configuration
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Use service role for admin operations
const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * Migrate AlignerDoctors table
 */
async function migrateDoctors() {
    console.log('📋 Migrating AlignerDoctors...');

    const query = `
        SELECT
            DrID,
            DoctorName,
            DoctorEmail,
            LogoPath
        FROM AlignerDoctors
        ORDER BY DrID
    `;

    const doctors = await executeQuery(query, [], (columns) => ({
        dr_id: columns[0].value,
        doctor_name: columns[1].value,
        doctor_email: columns[2].value,
        logo_path: columns[3].value
    }));

    console.log(`Found ${doctors.length} doctors to migrate`);

    // Insert into Supabase (upsert to handle re-runs)
    const { data, error } = await supabase
        .from('aligner_doctors')
        .upsert(doctors, { onConflict: 'dr_id' });

    if (error) {
        console.error('❌ Error migrating doctors:', error);
        throw error;
    }

    console.log(`✅ Migrated ${doctors.length} doctors`);
    return doctors;
}

/**
 * Migrate tblAlignerSets table
 */
async function migrateAlignerSets() {
    console.log('📋 Migrating Aligner Sets...');

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
        ORDER BY AlignerSetID
    `;

    const sets = await executeQuery(query, [], (columns) => ({
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
        currency: columns[17].value || 'USD',
        pdf_uploaded_at: columns[18].value,
        pdf_uploaded_by: columns[19].value,
        drive_file_id: columns[20].value
    }));

    console.log(`Found ${sets.length} aligner sets to migrate`);

    // Batch insert (Supabase has 1000 row limit per request)
    const batchSize = 500;
    for (let i = 0; i < sets.length; i += batchSize) {
        const batch = sets.slice(i, i + batchSize);
        const { error } = await supabase
            .from('aligner_sets')
            .upsert(batch, { onConflict: 'aligner_set_id' });

        if (error) {
            console.error(`❌ Error migrating sets batch ${i / batchSize + 1}:`, error);
            throw error;
        }
        console.log(`✅ Migrated sets ${i + 1} to ${Math.min(i + batchSize, sets.length)}`);
    }

    console.log(`✅ Migrated ${sets.length} aligner sets`);
    return sets;
}

/**
 * Migrate tblAlignerBatches table
 */
async function migrateAlignerBatches() {
    console.log('📋 Migrating Aligner Batches...');

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
        ORDER BY AlignerBatchID
    `;

    const batches = await executeQuery(query, [], (columns) => ({
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

    console.log(`Found ${batches.length} batches to migrate`);

    const batchSize = 500;
    for (let i = 0; i < batches.length; i += batchSize) {
        const batch = batches.slice(i, i + batchSize);
        const { error } = await supabase
            .from('aligner_batches')
            .upsert(batch, { onConflict: 'aligner_batch_id' });

        if (error) {
            console.error(`❌ Error migrating batches ${i / batchSize + 1}:`, error);
            throw error;
        }
        console.log(`✅ Migrated batches ${i + 1} to ${Math.min(i + batchSize, batches.length)}`);
    }

    console.log(`✅ Migrated ${batches.length} aligner batches`);
    return batches;
}

/**
 * Migrate tblAlignerNotes table
 */
async function migrateAlignerNotes() {
    console.log('📋 Migrating Aligner Notes...');

    const query = `
        SELECT
            NoteID,
            AlignerSetID,
            NoteType,
            NoteText,
            CreatedAt,
            IsEdited,
            EditedAt
        FROM tblAlignerNotes
        ORDER BY NoteID
    `;

    const notes = await executeQuery(query, [], (columns) => ({
        note_id: columns[0].value,
        aligner_set_id: columns[1].value,
        note_type: columns[2].value,
        note_text: columns[3].value,
        created_at: columns[4].value,
        is_edited: columns[5].value || false,
        edited_at: columns[6].value
    }));

    console.log(`Found ${notes.length} notes to migrate`);

    const batchSize = 500;
    for (let i = 0; i < notes.length; i += batchSize) {
        const batch = notes.slice(i, i + batchSize);
        const { error } = await supabase
            .from('aligner_notes')
            .upsert(batch, { onConflict: 'note_id' });

        if (error) {
            console.error(`❌ Error migrating notes batch ${i / batchSize + 1}:`, error);
            throw error;
        }
        console.log(`✅ Migrated notes ${i + 1} to ${Math.min(i + batchSize, notes.length)}`);
    }

    console.log(`✅ Migrated ${notes.length} aligner notes`);
    return notes;
}

/**
 * Migrate payment summary data (if available)
 */
async function migratePaymentSummary() {
    console.log('📋 Migrating Payment Summary...');

    // Check if vw_AlignerSetPayments view exists
    const query = `
        SELECT
            AlignerSetID,
            TotalPaid,
            Balance,
            PaymentStatus
        FROM vw_AlignerSetPayments
    `;

    try {
        const payments = await executeQuery(query, [], (columns) => ({
            aligner_set_id: columns[0].value,
            total_paid: columns[1].value || 0,
            balance: columns[2].value || 0,
            payment_status: columns[3].value || 'Unpaid'
        }));

        console.log(`Found ${payments.length} payment records to migrate`);

        const batchSize = 500;
        for (let i = 0; i < payments.length; i += batchSize) {
            const batch = payments.slice(i, i + batchSize);
            const { error } = await supabase
                .from('aligner_set_payments')
                .upsert(batch, { onConflict: 'aligner_set_id' });

            if (error) {
                console.error(`❌ Error migrating payments batch ${i / batchSize + 1}:`, error);
                throw error;
            }
            console.log(`✅ Migrated payments ${i + 1} to ${Math.min(i + batchSize, payments.length)}`);
        }

        console.log(`✅ Migrated ${payments.length} payment records`);
        return payments;
    } catch (error) {
        console.log('⚠️  Payment view not found or error occurred, skipping payment migration');
        console.log('   You can sync payment data separately later');
        return [];
    }
}

/**
 * Main migration function
 */
async function runMigration() {
    console.log('🚀 Starting Initial Migration: SQL Server → PostgreSQL');
    console.log('================================================\n');

    try {
        // Check Supabase connection
        const { error: connectionError } = await supabase.from('aligner_doctors').select('count').limit(1);
        if (connectionError) {
            console.error('❌ Cannot connect to Supabase. Check your credentials.');
            console.error(connectionError);
            return;
        }
        console.log('✅ Connected to Supabase\n');

        // Run migrations in order (respecting foreign keys)
        const doctors = await migrateDoctors();
        console.log('');

        const sets = await migrateAlignerSets();
        console.log('');

        const batches = await migrateAlignerBatches();
        console.log('');

        const notes = await migrateAlignerNotes();
        console.log('');

        const payments = await migratePaymentSummary();
        console.log('');

        // Summary
        console.log('================================================');
        console.log('✅ MIGRATION COMPLETED SUCCESSFULLY!');
        console.log('================================================');
        console.log(`Doctors:   ${doctors.length}`);
        console.log(`Sets:      ${sets.length}`);
        console.log(`Batches:   ${batches.length}`);
        console.log(`Notes:     ${notes.length}`);
        console.log(`Payments:  ${payments.length}`);
        console.log('================================================\n');

    } catch (error) {
        console.error('\n❌ MIGRATION FAILED:');
        console.error(error);
        process.exit(1);
    }
}

// Run migration if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    runMigration();
}

export { runMigration };
