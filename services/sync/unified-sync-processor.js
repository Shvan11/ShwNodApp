/**
 * Unified Sync Processor
 * Processes SyncQueue and syncs all tables from SQL Server to Supabase
 * Replaces the old direct-query sync method with a trigger-based queue system
 */

import { Request, TYPES } from 'tedious';
import ConnectionPool from '../database/ConnectionPool.js';
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
async function getPendingSyncRecords(connection, tableName = null, limit = 1000) {
  const sql = `
    SELECT TOP ${limit}
      QueueID,
      TableName,
      RecordID,
      Operation,
      JsonData,
      CreatedAt
    FROM SyncQueue
    WHERE Status = 'Pending'
      ${tableName ? 'AND TableName = @tableName' : ''}
    ORDER BY CreatedAt ASC
  `;

  const params = tableName ? [['tableName', TYPES.NVarChar, tableName]] : [];
  return executeQuery(connection, sql, params);
}

/**
 * Mark records as synced
 */
async function markAsSynced(connection, queueIds) {
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
 * Mark records as failed
 */
async function markAsFailed(connection, queueIds, errorMessage) {
  if (queueIds.length === 0) return;

  const idList = queueIds.join(',');
  const sql = `
    UPDATE SyncQueue
    SET Status = 'Failed',
        LastAttempt = GETDATE(),
        LastError = @error,
        Attempts = ISNULL(Attempts, 0) + 1
    WHERE QueueID IN (${idList})
  `;

  await executeQuery(connection, sql, [['error', TYPES.NVarChar, errorMessage]]);
}

/**
 * Table sync handlers
 */
const syncHandlers = {
  async aligner_doctors(records) {
    const data = records.map(r => JSON.parse(r.JsonData));
    const { error } = await supabase
      .from('aligner_doctors')
      .upsert(data, { onConflict: 'dr_id' });
    if (error) throw error;
    return data.length;
  },

  async aligner_sets(records) {
    const data = records.map(r => JSON.parse(r.JsonData));
    const { error } = await supabase
      .from('aligner_sets')
      .upsert(data, { onConflict: 'aligner_set_id' });
    if (error) throw error;
    return data.length;
  },

  async aligner_batches(records) {
    const data = records.map(r => JSON.parse(r.JsonData));
    const { error } = await supabase
      .from('aligner_batches')
      .upsert(data, { onConflict: 'aligner_batch_id' });
    if (error) throw error;
    return data.length;
  },

  async aligner_notes(records) {
    const data = records.map(r => JSON.parse(r.JsonData));
    const { error } = await supabase
      .from('aligner_notes')
      .upsert(data, { onConflict: 'note_id' });
    if (error) throw error;
    return data.length;
  },

  async patients(records) {
    const data = records.map(r => JSON.parse(r.JsonData));
    const { error } = await supabase
      .from('patients')
      .upsert(data, { onConflict: 'person_id' });
    if (error) throw error;
    return data.length;
  },

  async work(records) {
    const data = records.map(r => JSON.parse(r.JsonData));
    const { error } = await supabase
      .from('work')
      .upsert(data, { onConflict: 'work_id' });
    if (error) throw error;
    return data.length;
  }
};

/**
 * Process sync queue for a specific table
 */
async function processSyncForTable(connection, tableName) {
  const records = await getPendingSyncRecords(connection, tableName);

  if (records.length === 0) {
    return { synced: 0, failed: 0 };
  }

  console.log(`📦 Processing ${records.length} ${tableName} records`);

  const handler = syncHandlers[tableName];
  if (!handler) {
    console.warn(`⚠️  No sync handler for table: ${tableName}`);
    return { synced: 0, failed: records.length };
  }

  try {
    const synced = await handler(records);
    const queueIds = records.map(r => r.QueueID);
    await markAsSynced(connection, queueIds);
    console.log(`✅ Synced ${synced} ${tableName} records`);
    return { synced, failed: 0 };
  } catch (error) {
    console.error(`❌ Error syncing ${tableName}:`, error.message);
    const queueIds = records.map(r => r.QueueID);
    await markAsFailed(connection, queueIds, error.message);
    return { synced: 0, failed: records.length };
  }
}

/**
 * Process all pending records in sync queue
 */
export async function processAllPendingSyncs() {
  console.log('🚀 Starting Unified Sync Process\n');
  console.log('==========================================');

  const stats = {
    totalSynced: 0,
    totalFailed: 0,
    byTable: {}
  };

  try {
    await ConnectionPool.withConnection(async (connection) => {
      // Get list of tables with pending syncs
      const tablesWithPending = await executeQuery(connection, `
        SELECT DISTINCT TableName, COUNT(*) as PendingCount
        FROM SyncQueue
        WHERE Status = 'Pending'
        GROUP BY TableName
        ORDER BY TableName
      `);

      if (tablesWithPending.length === 0) {
        console.log('ℹ️  No pending syncs');
        return;
      }

      console.log(`Found pending syncs for ${tablesWithPending.length} tables:\n`);
      tablesWithPending.forEach(t => {
        console.log(`  - ${t.TableName}: ${t.PendingCount} records`);
      });
      console.log('');

      // Process each table
      for (const { TableName } of tablesWithPending) {
        const result = await processSyncForTable(connection, TableName);
        stats.byTable[TableName] = result;
        stats.totalSynced += result.synced;
        stats.totalFailed += result.failed;
      }
    });

    console.log('\n==========================================');
    console.log('✅ Sync Process Complete');
    console.log(`   Total Synced: ${stats.totalSynced}`);
    console.log(`   Total Failed: ${stats.totalFailed}`);
    console.log('==========================================\n');

    return stats;

  } catch (error) {
    console.error('❌ Sync process failed:', error);
    throw error;
  } finally {
    await ConnectionPool.cleanup();
  }
}

// Export for use in other scripts
export { processSyncForTable, syncHandlers };
