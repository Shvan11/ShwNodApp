// Script to process SyncQueue and sync data to Supabase
import { Request, TYPES } from 'tedious';
import ConnectionPool from '../services/database/ConnectionPool.js';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * Execute SQL query
 */
function executeQuery(connection, sql, params = []) {
  return new Promise((resolve, reject) => {
    const results = [];
    const request = new Request(sql, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve(results);
      }
    });

    // Add parameters
    params.forEach(([name, type, value]) => {
      request.addParameter(name, type, value);
    });

    request.on('row', (columns) => {
      const row = {};
      columns.forEach((col) => {
        row[col.metadata.colName] = col.value;
      });
      results.push(row);
    });

    connection.execSql(request);
  });
}

/**
 * Get pending records from SyncQueue
 */
async function getPendingSyncRecords(connection, tableName) {
  const sql = `
    SELECT TOP 1000
      QueueID,
      TableName,
      RecordID,
      Operation,
      JsonData,
      CreatedAt
    FROM SyncQueue
    WHERE TableName = @tableName
      AND Status = 'Pending'
    ORDER BY CreatedAt ASC
  `;

  return executeQuery(connection, sql, [['tableName', TYPES.NVarChar, tableName]]);
}

/**
 * Mark records as processed
 */
async function markAsProcessed(connection, queueIds) {
  if (queueIds.length === 0) return;

  const idList = queueIds.join(',');
  const sql = `
    UPDATE SyncQueue
    SET Status = 'Synced',
        LastAttempt = GETDATE(),
        Attempts = ISNULL(Attempts, 0) + 1
    WHERE QueueID IN (${idList})
  `;

  await executeQuery(connection, sql);
}

/**
 * Sync patients to Supabase
 */
async function syncPatients(records) {
  console.log(`\n📦 Processing ${records.length} patient records`);

  const patients = records.map(record => {
    const data = JSON.parse(record.JsonData);
    return {
      person_id: data.person_id,
      patient_id: data.patient_id,
      patient_name: data.patient_name,
      first_name: data.first_name,
      last_name: data.last_name,
      phone: data.phone
    };
  });

  const { data, error } = await supabase
    .from('patients')
    .upsert(patients, { onConflict: 'person_id' });

  if (error) {
    console.error('  ❌ Error syncing patients:', error);
    throw error;
  }

  console.log(`  ✅ Synced ${patients.length} patients to Supabase`);
  return patients.length;
}

/**
 * Sync work records to Supabase
 */
async function syncWork(records) {
  console.log(`\n📦 Processing ${records.length} work records`);

  const workRecords = records.map(record => {
    const data = JSON.parse(record.JsonData);
    return {
      work_id: data.work_id,
      person_id: data.person_id,
      type_of_work: data.type_of_work,
      addition_date: data.addition_date
    };
  });

  const { data, error } = await supabase
    .from('work')
    .upsert(workRecords, { onConflict: 'work_id' });

  if (error) {
    console.error('  ❌ Error syncing work:', error);
    throw error;
  }

  console.log(`  ✅ Synced ${workRecords.length} work records to Supabase`);
  return workRecords.length;
}

/**
 * Main processing function
 */
async function processSyncQueue() {
  console.log('🚀 Processing SyncQueue...\n');

  try {
    await ConnectionPool.withConnection(async (connection) => {
      // Process patients
      const patientRecords = await getPendingSyncRecords(connection, 'patients');
      if (patientRecords.length > 0) {
        const synced = await syncPatients(patientRecords);
        const queueIds = patientRecords.map(r => r.QueueID);
        await markAsProcessed(connection, queueIds);
        console.log(`  ✅ Marked ${queueIds.length} patient records as processed`);
      } else {
        console.log('  ℹ️  No pending patient records');
      }

      // Process work
      const workRecords = await getPendingSyncRecords(connection, 'work');
      if (workRecords.length > 0) {
        const synced = await syncWork(workRecords);
        const queueIds = workRecords.map(r => r.QueueID);
        await markAsProcessed(connection, queueIds);
        console.log(`  ✅ Marked ${queueIds.length} work records as processed`);
      } else {
        console.log('  ℹ️  No pending work records');
      }
    });

    console.log('\n✅ SyncQueue processing complete!');
    console.log('\nNext steps:');
    console.log('1. Verify data in Supabase patients and work tables');
    console.log('2. Add foreign key constraint to aligner_sets table\n');

  } catch (error) {
    console.error('❌ Error processing SyncQueue:', error);
    process.exit(1);
  } finally {
    await ConnectionPool.cleanup();
    process.exit(0);
  }
}

// Run processing
processSyncQueue();
