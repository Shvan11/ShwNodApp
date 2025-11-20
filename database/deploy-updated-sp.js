/**
 * Deployment Script for the updated GetDailyAppointmentsOptimized SP
 * Run: node database/deploy-updated-sp.js
 */

import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { withConnection, executeRawQuery } from '../services/database/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('=====================================================================');
console.log('DEPLOYMENT: Update GetDailyAppointmentsOptimized Stored Procedure');
console.log('=====================================================================\n');

async function deploy() {
    await withConnection(async (connection) => {
        try {
            console.log('📡 Connected to database\n');

            // Drop existing procedure
            console.log('🗑️  Dropping existing procedure (if exists)...');
            await executeRawQuery(connection, `
                IF OBJECT_ID('dbo.GetDailyAppointmentsOptimized', 'P') IS NOT NULL
                    DROP PROCEDURE dbo.GetDailyAppointmentsOptimized;
            `);
            console.log('✅ Procedure dropped.');

            const sqlFilePath = join(__dirname, 'stored-procedures', 'GetDailyAppointmentsOptimized.sql');
            console.log(`📄 Reading SQL file: ${sqlFilePath}`);
            let sqlScript = fs.readFileSync(sqlFilePath, 'utf8');

            // The script is a single CREATE PROCEDURE statement, but it ends with GO.
            // We need to remove the GO for the mssql driver.
            const scriptWithoutGO = sqlScript.split(/^\s*GO\s*$/im)[0];

            console.log('🔨 Creating updated GetDailyAppointmentsOptimized...');
            await executeRawQuery(connection, scriptWithoutGO);
            console.log('✅ Stored procedure updated successfully!');


            console.log('\n=====================================================================');
            console.log('✅ DEPLOYMENT COMPLETE!');
            console.log('=====================================================================');

        } catch (error) {
            console.error('❌ Deployment failed:', error.message);
            console.error(error);
            process.exit(1); // Exit with error
        }
    });
}

// Run deployment
deploy().catch((err) => {
    console.error('\n❌ Process failed unexpectedly.');
    process.exit(1);
});
