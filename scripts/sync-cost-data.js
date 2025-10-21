/**
 * One-Time Sync Script: Sync SetCost and Currency from SQL Server to Supabase
 *
 * This script updates existing records in Supabase with cost information from SQL Server
 * Run this once to backfill cost data that was added after initial sync
 *
 * Usage:
 *   node scripts/sync-cost-data.js
 */

import { executeQuery, TYPES } from '../services/database/index.js';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Missing Supabase credentials in environment variables');
    console.error('   Required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * Fetch all aligner sets from SQL Server with cost data
 */
async function fetchAlignerSetsFromSqlServer() {
    console.log('📊 Fetching aligner sets from SQL Server...');

    const query = `
        SELECT
            AlignerSetID,
            SetCost,
            Currency
        FROM tblAlignerSets
        ORDER BY AlignerSetID
    `;

    const sets = await executeQuery(query, [], (columns) => ({
        aligner_set_id: columns[0].value,
        set_cost: columns[1].value,
        currency: columns[2].value || 'USD'
    }));

    console.log(`   ✅ Found ${sets.length} aligner sets`);

    // Filter out sets without cost data
    const setsWithCost = sets.filter(s => s.set_cost !== null && s.set_cost !== undefined);
    console.log(`   💰 ${setsWithCost.length} sets have cost data`);
    console.log(`   ⚠️  ${sets.length - setsWithCost.length} sets have no cost data (will be skipped)`);

    return setsWithCost;
}

/**
 * Update Supabase with cost data
 */
async function updateSupabaseCostData(sets) {
    console.log('\n📤 Updating Supabase with cost data...');

    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    // Update one record at a time to handle errors gracefully
    for (let i = 0; i < sets.length; i++) {
        const set = sets[i];

        try {
            const { error } = await supabase
                .from('aligner_sets')
                .update({
                    set_cost: set.set_cost,
                    currency: set.currency
                })
                .eq('aligner_set_id', set.aligner_set_id);

            if (error) {
                console.error(`   ❌ Set #${set.aligner_set_id} error:`, error.message);
                errorCount++;
                errors.push({ setId: set.aligner_set_id, error: error.message });
            } else {
                successCount++;
                if ((i + 1) % 10 === 0) {
                    console.log(`   ✅ Updated ${i + 1}/${sets.length} sets...`);
                }
            }
        } catch (err) {
            console.error(`   ❌ Set #${set.aligner_set_id} exception:`, err.message);
            errorCount++;
            errors.push({ setId: set.aligner_set_id, error: err.message });
        }
    }

    console.log(`   ✅ Finished updating all sets`);
    return { successCount, errorCount, errors };
}

/**
 * Verify sync by checking a sample of records
 */
async function verifySyncedData(sampleSize = 5) {
    console.log(`\n🔍 Verifying synced data (sampling ${sampleSize} records)...`);

    const { data, error } = await supabase
        .from('aligner_sets')
        .select('aligner_set_id, set_cost, currency')
        .not('set_cost', 'is', null)
        .limit(sampleSize);

    if (error) {
        console.error('   ❌ Verification error:', error.message);
        return false;
    }

    if (!data || data.length === 0) {
        console.warn('   ⚠️  No records found with cost data in Supabase');
        return false;
    }

    console.log(`   ✅ Sample of synced records:`);
    data.forEach(record => {
        console.log(`      - Set #${record.aligner_set_id}: ${record.set_cost} ${record.currency}`);
    });

    return true;
}

/**
 * Main execution
 */
async function main() {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║  One-Time Cost Data Sync: SQL Server → Supabase           ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    try {
        // Step 1: Fetch from SQL Server
        const sets = await fetchAlignerSetsFromSqlServer();

        if (sets.length === 0) {
            console.log('\n⚠️  No sets with cost data found. Nothing to sync.');
            process.exit(0);
        }

        // Step 2: Update Supabase
        const { successCount, errorCount, errors } = await updateSupabaseCostData(sets);

        // Step 3: Verify
        await verifySyncedData();

        // Step 4: Summary
        console.log('\n╔════════════════════════════════════════════════════════════╗');
        console.log('║  Sync Summary                                              ║');
        console.log('╚════════════════════════════════════════════════════════════╝');
        console.log(`   Total records processed:  ${sets.length}`);
        console.log(`   ✅ Successfully synced:   ${successCount}`);
        console.log(`   ❌ Failed:                ${errorCount}`);

        if (errors.length > 0) {
            console.log('\n   Errors:');
            errors.forEach(err => {
                console.log(`      Batch ${err.batch}: ${err.error}`);
            });
        }

        console.log('\n✅ Sync completed!\n');

        process.exit(errorCount > 0 ? 1 : 0);

    } catch (error) {
        console.error('\n❌ Fatal error during sync:', error);
        console.error(error.stack);
        process.exit(1);
    }
}

// Run the script
main();
