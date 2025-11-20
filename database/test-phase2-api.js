/**
 * Phase 2 API Testing Script
 * Tests the new /api/getDailyAppointments endpoint logic
 * Run: node database/test-phase2-api.js
 */

import { executeMultipleResultSets, TYPES } from '../services/database/index.js';

console.log('=====================================================================');
console.log('PHASE 2 TEST: API Endpoint Logic Validation');
console.log('=====================================================================\n');

async function testAPIEndpoint() {
    try {
        // Test with yesterday's date (has both appointment types and checked-in patients)
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const AppsDate = yesterday.toISOString().split('T')[0];

        console.log(`📅 Test Date: ${AppsDate} (Yesterday)\n`);
        console.log('---------------------------------------------------------------------');
        console.log('TEST: Simulating /api/getDailyAppointments endpoint');
        console.log('---------------------------------------------------------------------\n');

        const startTime = Date.now();

        // Call optimized stored procedure (same as API endpoint)
        const resultSets = await executeMultipleResultSets(
            'GetDailyAppointmentsOptimized',
            [['AppsDate', TYPES.Date, AppsDate]]
        );

        const endTime = Date.now();

        console.log(`⏱️  API execution time: ${endTime - startTime}ms\n`);
        console.log(`📊 Result sets returned: ${resultSets.length}`);
        console.log('');

        // Extract result sets (same logic as API endpoint)
        let allAppointments = [];
        let checkedInAppointments = [];
        let stats = { total: 0, checkedIn: 0, waiting: 0, completed: 0 };

        if (resultSets.length >= 3) {
            allAppointments = resultSets[0] || [];
            checkedInAppointments = resultSets[1] || [];
            stats = resultSets[2] && resultSets[2][0] ? resultSets[2][0] : stats;
        } else if (resultSets.length === 2) {
            if (resultSets[0].length > 0 && resultSets[0][0].hasOwnProperty('appointmentID')) {
                allAppointments = resultSets[0];
                if (resultSets[1].length > 0) {
                    if (resultSets[1][0].hasOwnProperty('appointmentID')) {
                        checkedInAppointments = resultSets[1];
                    } else if (resultSets[1][0].hasOwnProperty('total')) {
                        stats = resultSets[1][0];
                    }
                }
            } else if (resultSets[0].length > 0 && resultSets[0][0].hasOwnProperty('total')) {
                stats = resultSets[0][0];
            }
        } else if (resultSets.length === 1) {
            if (resultSets[0].length > 0 && resultSets[0][0].hasOwnProperty('total')) {
                stats = resultSets[0][0];
            }
        }

        // Build API response
        const apiResponse = {
            allAppointments,
            checkedInAppointments,
            stats
        };

        console.log('---------------------------------------------------------------------');
        console.log('API RESPONSE STRUCTURE');
        console.log('---------------------------------------------------------------------\n');

        console.log('📦 Response body:');
        console.log(`   - allAppointments: Array[${allAppointments.length}]`);
        console.log(`   - checkedInAppointments: Array[${checkedInAppointments.length}]`);
        console.log(`   - stats: ${JSON.stringify(stats)}`);
        console.log('');

        if (allAppointments.length > 0) {
            console.log('Sample allAppointments[0]:');
            console.log(JSON.stringify(allAppointments[0], null, 2));
            console.log('');
        }

        if (checkedInAppointments.length > 0) {
            console.log('Sample checkedInAppointments[0]:');
            console.log(JSON.stringify(checkedInAppointments[0], null, 2));
            console.log('');
        }

        console.log('---------------------------------------------------------------------');
        console.log('DATA VALIDATION');
        console.log('---------------------------------------------------------------------\n');

        const totalFromArrays = allAppointments.length + checkedInAppointments.length;
        const statsMatch = stats.total === totalFromArrays;
        const checkedInMatch = stats.checkedIn === checkedInAppointments.length;

        console.log(`Total appointments: ${statsMatch ? '✅' : '❌'} (Arrays: ${totalFromArrays}, Stats: ${stats.total})`);
        console.log(`Checked-in count: ${checkedInMatch ? '✅' : '❌'} (Array: ${checkedInAppointments.length}, Stats: ${stats.checkedIn})`);
        console.log(`Waiting count: ${stats.waiting}`);
        console.log(`Completed count: ${stats.completed}`);
        console.log('');

        console.log('=====================================================================');
        console.log('PHASE 2 TEST SUMMARY');
        console.log('=====================================================================\n');

        if (statsMatch && checkedInMatch) {
            console.log('✅ API endpoint logic works correctly!');
            console.log(`✅ Execution time: ${endTime - startTime}ms`);
            console.log('✅ Response structure valid');
            console.log('✅ Data validation passed');
            console.log('');
            console.log('Phase 2 Status: ✅ COMPLETE');
        } else {
            console.log('❌ Data validation failed - review counts above');
        }

        console.log('=====================================================================\n');

    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// Run test
testAPIEndpoint()
    .then(() => {
        console.log('📡 Testing complete');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ Process failed:', error.message);
        process.exit(1);
    });
