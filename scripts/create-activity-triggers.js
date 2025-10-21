/**
 * Script to create activity triggers in SQL Server
 * Run with: node scripts/create-activity-triggers.js
 */

import * as database from '../services/database/index.js';

const triggers = [
    {
        name: 'Doctor Notes Trigger',
        dropSql: `IF OBJECT_ID('trg_AlignerNotes_DoctorActivity', 'TR') IS NOT NULL
            DROP TRIGGER trg_AlignerNotes_DoctorActivity`,
        createSql: `CREATE TRIGGER trg_AlignerNotes_DoctorActivity
ON tblAlignerNotes
AFTER INSERT
AS
BEGIN
    SET NOCOUNT ON;

    INSERT INTO tblAlignerActivityFlags (
        AlignerSetID,
        ActivityType,
        ActivityDescription,
        RelatedRecordID
    )
    SELECT
        i.AlignerSetID,
        'DoctorNote',
        'Dr. ' + ISNULL(d.DoctorName, 'Unknown') + ' added a note',
        i.NoteID
    FROM inserted i
    INNER JOIN tblAlignerSets s ON i.AlignerSetID = s.AlignerSetID
    LEFT JOIN AlignerDoctors d ON s.AlignerDrID = d.DrID
    WHERE i.NoteType = 'Doctor';
END`
    },
    {
        name: 'Days Changed Trigger',
        dropSql: `IF OBJECT_ID('trg_AlignerBatches_DaysChanged', 'TR') IS NOT NULL
            DROP TRIGGER trg_AlignerBatches_DaysChanged`,
        createSql: `CREATE TRIGGER trg_AlignerBatches_DaysChanged
ON tblAlignerBatches
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    IF UPDATE(Days)
    BEGIN
        INSERT INTO tblAlignerActivityFlags (
            AlignerSetID,
            ActivityType,
            ActivityDescription,
            RelatedRecordID
        )
        SELECT
            i.AlignerSetID,
            'DaysChanged',
            'Days changed from ' +
                ISNULL(CAST(d.Days AS VARCHAR), 'not set') +
                ' to ' +
                ISNULL(CAST(i.Days AS VARCHAR), 'not set'),
            i.AlignerBatchID
        FROM inserted i
        INNER JOIN deleted d ON i.AlignerBatchID = d.AlignerBatchID
        WHERE
            (i.Days != d.Days)
            OR (i.Days IS NOT NULL AND d.Days IS NULL)
            OR (i.Days IS NULL AND d.Days IS NOT NULL);
    END
END`
    }
];

async function createTriggers() {
    console.log('🔧 Creating activity triggers...\n');

    for (const trigger of triggers) {
        try {
            console.log(`📝 Creating ${trigger.name}...`);

            // Drop existing trigger
            await database.executeQuery(trigger.dropSql);
            console.log(`  ✅ Dropped existing trigger`);

            // Create new trigger
            await database.executeQuery(trigger.createSql);
            console.log(`  ✅ Created ${trigger.name}\n`);

        } catch (error) {
            console.error(`  ❌ Error creating ${trigger.name}:`, error.message);
            throw error;
        }
    }

    console.log('🎉 All triggers created successfully!\n');
    console.log('How it works:');
    console.log('1. Doctor adds note in portal → Syncs to SQL Server → Trigger creates activity flag');
    console.log('2. Doctor changes days → Syncs to SQL Server → Trigger creates activity flag');
    console.log('3. Staff sees visual notifications\n');

    process.exit(0);
}

createTriggers().catch(error => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
});
