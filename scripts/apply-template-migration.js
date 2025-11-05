import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { executeQuery } from '../services/database/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function applyMigration() {
    const migrationPath = path.join(__dirname, '../migrations/create_document_template_system.sql');

    console.log('📄 Reading migration file...');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    try {
        console.log('🚀 Applying migration...');

        // Execute as single batch
        await executeQuery(sql, []);
        console.log('✅ Migration applied successfully');

        // Verify tables were created
        console.log('\n📊 Verifying tables...');
        const result = await executeQuery(`
            SELECT TABLE_NAME
            FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_NAME IN ('DocumentTypes', 'DocumentTemplates', 'TemplateElements', 'DataFieldDefinitions', 'TemplateUsageLog')
            ORDER BY TABLE_NAME
        `, []);

        console.log('✅ Created tables:');
        result.forEach(row => {
            console.log(`   - ${row.TABLE_NAME}`);
        });

        // Count initial data
        const counts = await executeQuery(`
            SELECT
                (SELECT COUNT(*) FROM DocumentTypes) as DocumentTypes,
                (SELECT COUNT(*) FROM DataFieldDefinitions) as DataFields
        `, []);

        console.log('\n📈 Initial data:');
        console.log(`   - Document Types: ${counts[0].DocumentTypes}`);
        console.log(`   - Data Field Definitions: ${counts[0].DataFields}`);

    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        console.error('Error details:', error);
        throw error;
    }
}

// Run migration
applyMigration()
    .then(() => {
        console.log('\n✨ Migration completed successfully!');
        process.exit(0);
    })
    .catch(error => {
        console.error('\n💥 Migration failed:', error);
        process.exit(1);
    });
