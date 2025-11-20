/**
 * Phase 1 Testing Script
 * Tests GetDailyAppointmentsOptimized stored procedure
 * Run: node database/test-phase1.js
 */

import { executeStoredProcedure, TYPES } from '../services/database/index.js';
import { getAllTodayApps, getPresentTodayApps } from '../services/database/queries/appointment-queries.js';

console.log('=====================================================================');
console.log('PHASE 1 TEST: GetDailyAppointmentsOptimized Performance Validation');
console.log('=====================================================================\n');

async function runTests() {
    try {
        // Test with yesterday's date
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const testDate = yesterday.toISOString().split('T')[0];
        console.log(`📅 Test Date: ${testDate} (Yesterday)\n`);

        // ===================================================================
        // TEST 1: Execute OLD method (baseline)
        // ===================================================================
        console.log('---------------------------------------------------------------------');
        console.log('TEST 1: OLD METHOD (Baseline)');
        console.log('---------------------------------------------------------------------');

        const startOld = Date.now();
        const oldAll = await getAllTodayApps(testDate);
        const oldPresent = await getPresentTodayApps(testDate);
        const endOld = Date.now();

        const oldTime = endOld - startOld;
        console.log(`⏱️  Execution time: ${oldTime}ms`);
        console.log(`📊 All appointments (not checked in): ${oldAll.length} rows`);
        console.log(`📊 Checked-in appointments: ${oldPresent.length} rows`);
        console.log(`📊 Total appointments: ${oldAll.length + oldPresent.length} rows`);
        console.log('');

        // ===================================================================
        // TEST 2: Execute NEW optimized procedure
        // ===================================================================
        console.log('---------------------------------------------------------------------');
        console.log('TEST 2: NEW OPTIMIZED PROCEDURE');
        console.log('---------------------------------------------------------------------');

        const resultSets = [];
        let currentSet = [];

        const startNew = Date.now();
        await executeStoredProcedure(
            'GetDailyAppointmentsOptimized',
            [['AppsDate', TYPES.Date, testDate]],
            null, // beforeExec
            (columns) => {
                // Map row
                const row = {};
                columns.forEach(col => {
                    row[col.metadata.colName] = col.value;
                });
                return row;
            },
            (result) => {
                // This captures only the last result set
                // We need custom logic for multiple result sets
                return result;
            }
        );
        const endNew = Date.now();

        // Note: The above approach won't capture multiple result sets correctly
        // We need to use withConnection for proper multiple result set handling

        console.log('⚠️  Standard executeStoredProcedure only captures final result set');
        console.log('⏱️  Execution time: ' + (endNew - startNew) + 'ms');
        console.log('');
        console.log('Testing with custom multiple result set handler...');
        console.log('');

        // ===================================================================
        // TEST 3: Execute NEW procedure with proper result set handling
        // ===================================================================
        console.log('---------------------------------------------------------------------');
        console.log('TEST 3: NEW PROCEDURE (Multiple Result Sets)');
        console.log('---------------------------------------------------------------------');

        const { withConnection } = await import('../services/database/index.js');
        const { Request } = await import('tedious');

        const startNew2 = Date.now();
        const multiResultSets = await withConnection(async (connection) => {
            return new Promise((resolve, reject) => {
                const request = new Request(
                    'GetDailyAppointmentsOptimized',
                    (err) => {
                        if (err) {
                            reject(err);
                            return;
                        }
                    }
                );

                request.addParameter('AppsDate', TYPES.Date, testDate);

                const resultSets = [];
                let currentSet = [];

                request.on('row', (columns) => {
                    const row = {};
                    columns.forEach(col => {
                        row[col.metadata.colName] = col.value;
                    });
                    currentSet.push(row);
                });

                request.on('doneInProc', (rowCount, more) => {
                    if (currentSet.length > 0 || rowCount > 0) {
                        resultSets.push([...currentSet]);
                        currentSet = [];
                    }
                });

                request.on('requestCompleted', () => {
                    resolve(resultSets);
                });

                request.on('error', (error) => {
                    reject(error);
                });

                connection.callProcedure(request);
            });
        });
        const endNew2 = Date.now();

        const newTime = endNew2 - startNew2;

        if (multiResultSets && multiResultSets.length === 3) {
            const [allApps, checkedInApps, stats] = multiResultSets;

            console.log(`⏱️  Execution time: ${newTime}ms`);
            console.log(`📊 Result Set 1 (All appointments): ${allApps.length} rows`);
            console.log(`📊 Result Set 2 (Checked-in): ${checkedInApps.length} rows`);
            console.log(`📊 Result Set 3 (Stats):`, stats[0]);
            console.log('');

            // ===================================================================
            // TEST 4: Performance Comparison
            // ===================================================================
            console.log('---------------------------------------------------------------------');
            console.log('TEST 4: PERFORMANCE COMPARISON');
            console.log('---------------------------------------------------------------------');

            const improvement = ((oldTime - newTime) / oldTime * 100).toFixed(1);
            const timeSaved = oldTime - newTime;

            console.log(`🚀 Performance Improvement: ${improvement}%`);
            console.log(`   Old method: ${oldTime}ms`);
            console.log(`   New method: ${newTime}ms`);
            console.log(`   Time saved: ${timeSaved}ms`);
            console.log('');

            // ===================================================================
            // TEST 5: Data Validation
            // ===================================================================
            console.log('---------------------------------------------------------------------');
            console.log('TEST 5: DATA VALIDATION');
            console.log('---------------------------------------------------------------------');

            const allMatch = allApps.length === oldAll.length;
            const presentMatch = checkedInApps.length === oldPresent.length;
            const totalMatch = stats[0].total === (oldAll.length + oldPresent.length);
            const checkedInMatch = stats[0].checkedIn === oldPresent.length;

            console.log(`All appointments count: ${allMatch ? '✅' : '❌'} (New: ${allApps.length}, Old: ${oldAll.length})`);
            console.log(`Checked-in count: ${presentMatch ? '✅' : '❌'} (New: ${checkedInApps.length}, Old: ${oldPresent.length})`);
            console.log(`Stats total: ${totalMatch ? '✅' : '❌'} (Expected: ${oldAll.length + oldPresent.length}, Got: ${stats[0].total})`);
            console.log(`Stats checkedIn: ${checkedInMatch ? '✅' : '❌'} (Expected: ${oldPresent.length}, Got: ${stats[0].checkedIn})`);
            console.log('');

            // ===================================================================
            // FINAL SUMMARY
            // ===================================================================
            console.log('=====================================================================');
            console.log('PHASE 1 TEST SUMMARY');
            console.log('=====================================================================');

            const allTestsPassed = allMatch && presentMatch && totalMatch && checkedInMatch;

            if (allTestsPassed && parseFloat(improvement) > 0) {
                console.log('✅ ALL TESTS PASSED!');
                console.log(`✅ Performance improvement: ${improvement}%`);
                console.log('✅ Data validation: 100% match');
                console.log('✅ Ready for Phase 2 (Backend API)');
                console.log('');
                console.log('Phase 1 Status: ✅ COMPLETE AND VALIDATED');
            } else {
                console.log('⚠️  SOME TESTS FAILED');
                if (!allTestsPassed) {
                    console.log('❌ Data validation issues detected - review counts above');
                }
                if (parseFloat(improvement) <= 0) {
                    console.log('⚠️  Performance not improved (may need more data for accurate test)');
                }
            }

            console.log('=====================================================================\n');

        } else {
            console.log('❌ Expected 3 result sets, got:', multiResultSets.length);
            console.log('Result sets received:', multiResultSets);
        }

    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// Run tests
runTests()
    .then(() => {
        console.log('📡 Testing complete');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ Process failed:', error.message);
        process.exit(1);
    });
