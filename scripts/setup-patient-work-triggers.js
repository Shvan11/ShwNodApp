// Script to create patient and work sync triggers in SQL Server
import { Request } from 'tedious';
import ConnectionPool from '../services/database/ConnectionPool.js';

const triggers = [
  {
    name: 'trg_sync_tblPatients',
    table: 'tblPatients',
    sql: `
CREATE TRIGGER trg_sync_tblPatients
ON tblPatients
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    -- Only sync patients that have aligner works
    INSERT INTO SyncQueue (TableName, RecordID, Operation, JsonData)
    SELECT
        'patients',
        i.PersonID,
        CASE WHEN EXISTS(SELECT 1 FROM deleted d WHERE d.PersonID = i.PersonID)
             THEN 'UPDATE'
             ELSE 'INSERT'
        END,
        (SELECT
            i.PersonID as person_id,
            i.patientID as patient_id,
            i.PatientName as patient_name,
            i.FirstName as first_name,
            i.LastName as last_name,
            i.Phone as phone
         FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
    FROM inserted i
    WHERE EXISTS (
        SELECT 1 FROM tblWork w
        INNER JOIN tblAlignerSets s ON w.workid = s.WorkID
        WHERE w.PersonID = i.PersonID
    );
END`
  },
  {
    name: 'trg_sync_tblWork',
    table: 'tblWork',
    sql: `
CREATE TRIGGER trg_sync_tblWork
ON tblWork
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    -- Only sync work records that have aligner sets
    INSERT INTO SyncQueue (TableName, RecordID, Operation, JsonData)
    SELECT
        'work',
        i.workid,
        CASE WHEN EXISTS(SELECT 1 FROM deleted d WHERE d.workid = i.workid)
             THEN 'UPDATE'
             ELSE 'INSERT'
        END,
        (SELECT
            i.workid as work_id,
            i.PersonID as person_id,
            i.Typeofwork as type_of_work,
            i.AdditionDate as addition_date
         FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
    FROM inserted i
    WHERE EXISTS (
        SELECT 1 FROM tblAlignerSets
        WHERE WorkID = i.workid
    );
END`
  }
];

/**
 * Execute SQL query
 */
function executeQuery(connection, sql) {
  return new Promise((resolve, reject) => {
    const request = new Request(sql, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
    connection.execSql(request);
  });
}

/**
 * Main setup function
 */
async function setupTriggers() {
  console.log('Setting up patient and work sync triggers...\n');

  try {
    for (const trigger of triggers) {
      console.log(`Processing trigger: ${trigger.name} on ${trigger.table}`);

      await ConnectionPool.withConnection(async (connection) => {
        // Drop existing trigger if exists
        console.log(`  - Dropping existing trigger if exists...`);
        const dropSql = `IF OBJECT_ID('${trigger.name}', 'TR') IS NOT NULL DROP TRIGGER ${trigger.name}`;
        await executeQuery(connection, dropSql);

        // Create new trigger
        console.log(`  - Creating trigger...`);
        await executeQuery(connection, trigger.sql);

        console.log(`  ✅ Trigger ${trigger.name} created successfully\n`);
      });
    }

    console.log('✅ All triggers created successfully!');
    console.log('\nNext steps:');
    console.log('1. Run initial data sync to populate SyncQueue');
    console.log('2. Verify sync webhook processes the queue');
    console.log('3. Add foreign key constraint in Supabase\n');

  } catch (error) {
    console.error('❌ Error setting up triggers:', error);
    process.exit(1);
  } finally {
    await ConnectionPool.cleanup();
    process.exit(0);
  }
}

// Run setup
setupTriggers();
