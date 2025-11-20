/**
 * Simple Deployment Script for GetDailyAppointmentsOptimized
 * Run: node database/deploy-simple.js
 */

import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { withConnection, executeRawQuery } from '../services/database/index.js';
import { getAllTodayApps, getPresentTodayApps } from '../services/database/queries/appointment-queries.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('=====================================================================');
console.log('DEPLOYMENT: GetDailyAppointmentsOptimized Stored Procedure');
console.log('=====================================================================\n');

async function deploy() {
    await withConnection(async (connection) => {
        try {
            console.log('📡 Connected to database\n');

            // Read the SQL file
            const sqlFilePath = join(__dirname, 'stored-procedures', 'GetDailyAppointmentsOptimized.sql');
            console.log('📄 Reading stored procedure file...');
            let sqlScript = fs.readFileSync(sqlFilePath, 'utf8');

            // Remove GO statements and comments
            sqlScript = sqlScript
                .replace(/--.*$/gm, '') // Remove comments
                .replace(/\bGO\b/gi, '') // Remove GO statements
                .trim();

            // Drop existing procedure
            console.log('🗑️  Dropping existing procedure (if exists)...');
            await executeRawQuery(connection, `
                IF OBJECT_ID('dbo.GetDailyAppointmentsOptimized', 'P') IS NOT NULL
                    DROP PROCEDURE dbo.GetDailyAppointmentsOptimized;
            `);

            // Create the new procedure
            console.log('🔨 Creating GetDailyAppointmentsOptimized...');
            await executeRawQuery(connection, sqlScript);
            console.log('✅ Stored procedure created successfully!\n');

            // Quick validation test
            console.log('---------------------------------------------------------------------');
            console.log('VALIDATION TEST');
            console.log('---------------------------------------------------------------------');

            const testDate = new Date().toISOString().split('T')[0];
            console.log(`📅 Test Date: ${testDate}\n`);

            console.log('Testing old procedures for comparison...');
            const startOld = Date.now();
            const oldAll = await getAllTodayApps(testDate);
            const oldPresent = await getPresentTodayApps(testDate);
            const endOld = Date.now();

            console.log(`⏱️  Old method time: ${endOld - startOld}ms`);
            console.log(`📊 All appointments: ${oldAll.length} rows`);
            console.log(`📊 Checked-in: ${oldPresent.length} rows`);
            console.log('');

            console.log('Testing new optimized procedure...');
            const startNew = Date.now();

            // Test new procedure using raw query (simplified)
            const newResult = await new Promise((resolve, reject) => {
                const { Request } = await import('tedious');
                const request = new Request(
                    'EXEC GetDailyAppointmentsOptimized @AppsDate',
                    (err) => {
                        if (err) reject(err);
                    }
                );

                request.addParameter('AppsDate', require('tedious').TYPES.Date, testDate);

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
                    if (currentSet.length > 0) {
                        resultSets.push([...currentSet]);
                        currentSet = [];
                    }
                });

                request.on('requestCompleted', () => {
                    resolve(resultSets);
                });

                connection.execSql(request);
            });

            const endNew = Date.now();

            if (newResult && newResult.length === 3) {
                console.log(`⏱️  New method time: ${endNew - startNew}ms`);
                console.log(`📊 Result Set 1 (All): ${newResult[0].length} rows`);
                console.log(`📊 Result Set 2 (Checked-in): ${newResult[1].length} rows`);
                console.log(`📊 Result Set 3 (Stats):`, newResult[2][0]);
                console.log('');

                const improvement = ((endOld - startOld) - (endNew - startNew)) / (endOld - startOld) * 100;
                console.log(`🚀 Performance Improvement: ${improvement.toFixed(1)}%`);
                console.log(`   Time saved: ${(endOld - startOld) - (endNew - startNew)}ms`);
                console.log('');

                // Validate counts
                const allMatch = newResult[0].length === oldAll.length;
                const presentMatch = newResult[1].length === oldPresent.length;

                console.log(`✅ Count validation: ${allMatch && presentMatch ? 'PASSED' : 'FAILED'}`);
                console.log(`   All appointments: ${allMatch ? '✅' : '❌'} (${newResult[0].length} vs ${oldAll.length})`);
                console.log(`   Checked-in: ${presentMatch ? '✅' : '❌'} (${newResult[1].length} vs ${oldPresent.length})`);
            } else {
                console.log('⚠️  Could not fully test new procedure (manual verification needed)');
            }

            console.log('');
            console.log('=====================================================================');
            console.log('✅ DEPLOYMENT COMPLETE!');
            console.log('=====================================================================');
            console.log('Next Steps:');
            console.log('1. ✅ Phase 1 (Database) - COMPLETE');
            console.log('2. 🔄 Phase 2 (Backend) - Add API endpoint');
            console.log('3. 🔄 Phase 3 (Frontend) - Update React components');
            console.log('=====================================================================\n');

        } catch (error) {
            console.error('❌ Deployment failed:', error.message);
            console.error(error);
            throw error;
        }
    });
}

// Run deployment
deploy()
    .then(() => {
        console.log('📡 Database operations complete');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ Process failed:', error.message);
        process.exit(1);
    });
