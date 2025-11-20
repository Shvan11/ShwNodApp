/**
 * Deployment and Test Script for GetDailyAppointmentsOptimized
 * Uses existing database connection
 * Run: node database/deploy-and-test.js
 */

import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { withConnection, executeRawQuery } from '../services/database/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('=====================================================================');
console.log('DEPLOYMENT: GetDailyAppointmentsOptimized Stored Procedure');
console.log('=====================================================================\n');

async function deployStoredProcedure() {
    return withConnection(async (connection) => {
        console.log('📡 Connected to database\n');

        // Read the SQL file
        const sqlFilePath = join(__dirname, 'stored-procedures', 'GetDailyAppointmentsOptimized.sql');
        console.log('📄 Reading stored procedure file...');
        let sqlScript = fs.readFileSync(sqlFilePath, 'utf8');

        // Remove GO statements and split into batches
        const batches = sqlScript
            .split(/\bGO\b/gi)
            .map(batch => batch.trim())
            .filter(batch => batch.length > 0);

        // Drop existing procedure if exists
        console.log('🗑️  Dropping existing procedure (if exists)...');
        await executeRawQuery(connection, `
            IF OBJECT_ID('dbo.GetDailyAppointmentsOptimized', 'P') IS NOT NULL
                DROP PROCEDURE dbo.GetDailyAppointmentsOptimized;
        `);

        // Create the new procedure
        console.log('🔨 Creating GetDailyAppointmentsOptimized...');
        for (const batch of batches) {
            if (batch.length > 0) {
                await executeRawQuery(connection, batch);
            }
        }
        console.log('✅ Stored procedure created successfully!\n');

        return connection;
    });
}

async function testStoredProcedure(pool) {
    try {
        console.log('=====================================================================');
        console.log('TESTING: GetDailyAppointmentsOptimized');
        console.log('=====================================================================\n');

        const testDate = new Date().toISOString().split('T')[0]; // Today's date
        console.log(`📅 Test Date: ${testDate}\n`);

        // Test 1: Execute new optimized procedure
        console.log('---------------------------------------------------------------------');
        console.log('TEST 1: Execute new optimized procedure');
        console.log('---------------------------------------------------------------------');

        const startNew = Date.now();
        const result = await pool.request()
            .input('AppsDate', testDate)
            .execute('GetDailyAppointmentsOptimized');
        const endNew = Date.now();

        const allAppointments = result.recordsets[0] || [];
        const checkedInAppointments = result.recordsets[1] || [];
        const stats = result.recordsets[2] && result.recordsets[2][0] || { total: 0, checkedIn: 0, waiting: 0, completed: 0 };

        console.log(`⏱️  Execution time: ${endNew - startNew}ms`);
        console.log(`📊 Result Set 1 (All appointments): ${allAppointments.length} rows`);
        console.log(`📊 Result Set 2 (Checked-in): ${checkedInAppointments.length} rows`);
        console.log(`📊 Result Set 3 (Stats):`, stats);
        console.log('');

        // Test 2: Execute old procedures for comparison
        console.log('---------------------------------------------------------------------');
        console.log('TEST 2: Execute old procedures (for comparison)');
        console.log('---------------------------------------------------------------------');

        const startOld1 = Date.now();
        const oldAll = await pool.request()
            .input('AppsDate', testDate)
            .execute('AllTodayApps');
        const endOld1 = Date.now();

        const startOld2 = Date.now();
        const oldPresent = await pool.request()
            .input('AppsDate', testDate)
            .execute('PresentTodayApps');
        const endOld2 = Date.now();

        const oldAllCount = oldAll.recordset ? oldAll.recordset.length : 0;
        const oldPresentCount = oldPresent.recordset ? oldPresent.recordset.length : 0;
        const oldTotalTime = (endOld1 - startOld1) + (endOld2 - startOld2);

        console.log(`⏱️  AllTodayApps execution time: ${endOld1 - startOld1}ms`);
        console.log(`⏱️  PresentTodayApps execution time: ${endOld2 - startOld2}ms`);
        console.log(`⏱️  Total old method time: ${oldTotalTime}ms`);
        console.log(`📊 AllTodayApps: ${oldAllCount} rows`);
        console.log(`📊 PresentTodayApps: ${oldPresentCount} rows`);
        console.log('');

        // Test 3: Compare performance
        console.log('---------------------------------------------------------------------');
        console.log('TEST 3: Performance Comparison');
        console.log('---------------------------------------------------------------------');

        const improvement = ((oldTotalTime - (endNew - startNew)) / oldTotalTime * 100).toFixed(1);
        console.log(`🚀 Performance Improvement: ${improvement}%`);
        console.log(`   Old method: ${oldTotalTime}ms`);
        console.log(`   New method: ${endNew - startNew}ms`);
        console.log(`   Time saved: ${oldTotalTime - (endNew - startNew)}ms`);
        console.log('');

        // Test 4: Validate counts
        console.log('---------------------------------------------------------------------');
        console.log('TEST 4: Validate Result Counts');
        console.log('---------------------------------------------------------------------');

        const allMatch = allAppointments.length === oldAllCount;
        const presentMatch = checkedInAppointments.length === oldPresentCount;
        const totalMatch = stats.total === oldAllCount + oldPresentCount;
        const checkedInMatch = stats.checkedIn === oldPresentCount;

        console.log(`All appointments count: ${allMatch ? '✅' : '❌'} (New: ${allAppointments.length}, Old: ${oldAllCount})`);
        console.log(`Checked-in count: ${presentMatch ? '✅' : '❌'} (New: ${checkedInAppointments.length}, Old: ${oldPresentCount})`);
        console.log(`Stats total: ${totalMatch ? '✅' : '❌'} (Expected: ${oldAllCount + oldPresentCount}, Got: ${stats.total})`);
        console.log(`Stats checkedIn: ${checkedInMatch ? '✅' : '❌'} (Expected: ${oldPresentCount}, Got: ${stats.checkedIn})`);
        console.log('');

        // Summary
        console.log('=====================================================================');
        console.log('TEST SUMMARY');
        console.log('=====================================================================');

        if (allMatch && presentMatch && totalMatch && checkedInMatch) {
            console.log('✅ All tests passed!');
            console.log(`✅ Performance improvement: ${improvement}%`);
            console.log('✅ Ready for production deployment');
        } else {
            console.log('⚠️  Some tests failed - review results above');
        }

        console.log('=====================================================================');

    } catch (error) {
        console.error('❌ Testing failed:', error.message);
        throw error;
    }
}

// Main execution
(async () => {
    let pool;
    try {
        pool = await deployStoredProcedure();
        await testStoredProcedure(pool);

        console.log('\n✅ Deployment and testing complete!');
        console.log('\nNext steps:');
        console.log('1. ✅ Phase 1 (Database) - COMPLETE');
        console.log('2. 🔄 Phase 2 (Backend) - Add API endpoint');
        console.log('3. 🔄 Phase 3 (Frontend) - Update React components\n');

    } catch (error) {
        console.error('\n❌ Process failed:', error.message);
        process.exit(1);
    } finally {
        // Connection pool managed by application, no need to close
        console.log('📡 Database operations complete');
    }
})();
