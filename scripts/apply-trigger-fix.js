/**
 * Apply SQL Server Trigger Fix
 * Fixes triggers to only fire when data actually changes
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Connection, Request } from 'tedious';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database configuration
const config = {
    server: process.env.DB_SERVER,
    authentication: {
        type: 'default',
        options: {
            userName: process.env.DB_USER,
            password: process.env.DB_PASSWORD
        }
    },
    options: {
        database: process.env.DB_DATABASE,
        instanceName: process.env.DB_INSTANCE,
        encrypt: process.env.DB_ENCRYPT === 'true',
        trustServerCertificate: process.env.DB_TRUST_CERTIFICATE === 'true',
        requestTimeout: 30000,
        connectTimeout: 30000
    }
};

async function executeSqlFile(connection, filePath) {
    return new Promise((resolve, reject) => {
        const sql = fs.readFileSync(filePath, 'utf8');

        // Split by GO statements (SQL Server batch separator)
        const batches = sql.split(/^\s*GO\s*$/mi).filter(batch => batch.trim());

        let currentBatch = 0;

        function executeBatch() {
            if (currentBatch >= batches.length) {
                resolve();
                return;
            }

            const batch = batches[currentBatch].trim();
            if (!batch) {
                currentBatch++;
                executeBatch();
                return;
            }

            const request = new Request(batch, (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                currentBatch++;
                executeBatch();
            });

            request.on('row', (columns) => {
                // Print PRINT statements from SQL
                if (columns.length > 0 && columns[0].value) {
                    console.log(columns[0].value);
                }
            });

            connection.execSql(request);
        }

        executeBatch();
    });
}

async function main() {
    console.log('🔧 Applying SQL Server Trigger Fix');
    console.log('===================================\n');

    const connection = new Connection(config);

    connection.on('connect', async (err) => {
        if (err) {
            console.error('❌ Database connection failed:', err.message);
            process.exit(1);
        }

        console.log('✅ Connected to SQL Server\n');

        try {
            const migrationPath = path.join(__dirname, '..', 'migrations', 'sqlserver', '06_fix_trigger_change_detection.sql');

            console.log('📝 Executing migration...\n');
            await executeSqlFile(connection, migrationPath);

            console.log('\n✅ Migration completed successfully!');
            console.log('\n🎉 Your triggers now only fire when data actually changes');
            console.log('   This eliminates circular sync loops and reduces webhook spam\n');

            connection.close();
        } catch (error) {
            console.error('\n❌ Migration failed:', error.message);
            connection.close();
            process.exit(1);
        }
    });

    connection.on('end', () => {
        process.exit(0);
    });

    connection.connect();
}

main();
