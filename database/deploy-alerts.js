/**
 * Deployment Script for the new Alert System Tables
 * Run: node database/deploy-alerts.js
 */

import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { withConnection, executeRawQuery } from '../services/database/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('=====================================================================');
console.log('DEPLOYMENT: New Alert System Tables');
console.log('=====================================================================\n');

async function deploy() {
    await withConnection(async (connection) => {
        try {
            console.log('📡 Connected to database\n');

            const sqlFilePath = join(__dirname, 'create-alert-tables.sql');
            console.log(`📄 Reading SQL file: ${sqlFilePath}`);
            let sqlScript = fs.readFileSync(sqlFilePath, 'utf8');

            // Split the script into batches based on the "GO" separator
            const batches = sqlScript.split(/^\s*GO\s*$/im);

            for (const batch of batches) {
                const trimmedBatch = batch.trim();
                if (trimmedBatch) {
                    console.log('Executing batch...');
                    await executeRawQuery(connection, trimmedBatch);
                    console.log('✅ Batch executed successfully.');
                }
            }

            console.log('\n=====================================================================');
            console.log('✅ DEPLOYMENT COMPLETE! Alert system tables created.');
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
    // The error is already logged in the deploy function, just ensure process exits with failure
    console.error('\n❌ Process failed unexpectedly.');
    process.exit(1);
});
