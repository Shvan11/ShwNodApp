# Sync System Migration

## Overview

The sync system has been migrated from a direct-query approach to a queue-based trigger system for improved reliability and real-time syncing.

## Old System (Deprecated)

**Files:**
- `services/sync/sync-engine.js` - SqlToPostgresSync class (deprecated)
- `services/sync/sync-scheduler.js` - Scheduled periodic syncs (deprecated)
- `scripts/process-sync-queue.js` - Limited to patients/work only (deprecated)

**How it worked:**
- Queried SQL Server tables directly with timestamps
- Periodic polling every 15 minutes
- Could miss changes if timestamps weren't updated
- No retry mechanism for failed syncs

## New System (Current)

**Files:**
- `services/sync/unified-sync-processor.js` - Unified queue processor
- `scripts/sync.js` - Simple sync runner script

**How it works:**
1. SQL Server triggers capture ALL changes (INSERT/UPDATE) automatically
2. Changes are added to `SyncQueue` table with JSON data
3. Sync processor reads pending records from queue
4. Syncs to Supabase and marks records as 'Synced' or 'Failed'
5. Failed records can be retried

**Supported Tables:**
- ✅ `aligner_doctors`
- ✅ `aligner_sets`
- ✅ `aligner_batches`
- ✅ `aligner_notes`
- ✅ `patients`
- ✅ `work`

## Triggers

All triggers are installed in SQL Server:
- `trg_sync_AlignerDoctors`
- `trg_sync_tblAlignerSets`
- `trg_sync_tblAlignerBatches`
- `trg_sync_tblAlignerNotes`
- `trg_sync_tblPatients`
- `trg_sync_tblWork`

## Running Sync

### Manual Sync (Command Line)
```bash
node scripts/sync.js
```

### Manual Sync (API Endpoint)
```bash
curl -X POST http://localhost:3000/api/sync/trigger \
  -H "Content-Type: application/json" \
  -d '{"direction": "sql-to-postgres"}'
```

### Automatic Sync (Scheduled)
Set up a cron job or Windows Task Scheduler:
```bash
# Every 5 minutes
*/5 * * * * cd /path/to/project && node scripts/sync.js
```

## Migration Benefits

1. **Real-time** - Triggers capture changes immediately
2. **Reliable** - Queue ensures no changes are missed
3. **Retry logic** - Failed syncs can be retried
4. **Status tracking** - See which records synced successfully
5. **Unified** - One processor handles all tables
6. **Extensible** - Easy to add new tables

## Adding New Tables

To sync a new table:

1. **Create trigger in SQL Server:**
```sql
CREATE TRIGGER trg_sync_YourTable
ON YourTable
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO SyncQueue (TableName, RecordID, Operation, JsonData)
    SELECT
        'your_table',
        i.ID,
        CASE WHEN EXISTS(SELECT 1 FROM deleted d WHERE d.ID = i.ID)
             THEN 'UPDATE'
             ELSE 'INSERT'
        END,
        (SELECT i.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
    FROM inserted i;
END
```

2. **Add handler in unified-sync-processor.js:**
```javascript
syncHandlers.your_table = async function(records) {
  const data = records.map(r => JSON.parse(r.JsonData));
  const { error } = await supabase
    .from('your_table')
    .upsert(data, { onConflict: 'id' });
  if (error) throw error;
  return data.length;
};
```

3. Done! The sync will automatically process your table.

## Monitoring

Check sync status in SQL Server:
```sql
-- See pending syncs
SELECT TableName, COUNT(*) as PendingCount
FROM SyncQueue
WHERE Status = 'Pending'
GROUP BY TableName;

-- See failed syncs
SELECT TOP 10 *
FROM SyncQueue
WHERE Status = 'Failed'
ORDER BY LastAttempt DESC;

-- Retry failed syncs
UPDATE SyncQueue
SET Status = 'Pending', LastError = NULL
WHERE Status = 'Failed';
```

## Backwards Compatibility

The old `postgresToSql` class in `sync-engine.js` is still active for handling webhooks from Supabase (doctor edits like notes and batch days). This handles the reverse direction: PostgreSQL → SQL Server.

Only the SQL Server → PostgreSQL direction has been migrated to the queue system.
