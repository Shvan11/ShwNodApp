# Cascading Sync Feature

## Overview

The queue processor now includes **automatic cascading sync** - when syncing a record to Supabase, it automatically fetches and syncs any missing parent records from SQL Server.

## Problem Solved

Previously, when a new aligner set was created in SQL Server:
1. ❌ Patient record was NOT synced (trigger only fires when patient has aligner sets)
2. ❌ Work record was NOT synced (trigger only fires when work has aligner sets)
3. ✅ Set record was synced (direct trigger)

This caused foreign key violations in Supabase because the set referenced a `work_id` that didn't exist, and the work referenced a `person_id` that didn't exist.

## Solution: Self-Healing Sync

The queue processor now automatically:
1. Detects missing parent records when processing queue items
2. Fetches missing records from SQL Server
3. Syncs them to Supabase in the correct order (patient → work → set)

## How It Works

### Dependency Chain

```
aligner_batches
    ↓ (requires)
aligner_sets
    ↓ (requires)
work
    ↓ (requires)
patients
```

### Processing Flow

When syncing an **aligner_set**:
1. Check if referenced `work` exists in Supabase
2. If not, fetch work from SQL Server
3. Before syncing work, check if referenced `patient` exists
4. If not, fetch patient from SQL Server
5. Sync patient → work → set in order

When syncing an **aligner_batch**:
1. Check if referenced `aligner_set` exists in Supabase
2. If not, fetch set from SQL Server and cascade (set → work → patient)

When syncing **work**:
1. Check if referenced `patient` exists in Supabase
2. If not, fetch patient from SQL Server

## Example Output

```
📦 Processing 1 items from sync queue...
🔄 Syncing aligner_sets ID 123 (INSERT)
  📥 Fetching missing work record (ID: 456) from SQL Server...
  📥 Fetching missing patient record (ID: 789) from SQL Server...
  ✅ Patient record synced (ID: 789)
  ✅ Work record synced (ID: 456)
📝 Attempting to mark QueueID 1 as Synced...
  ✅ Synced successfully (UPDATE affected 1 rows)
✅ Batch complete: 1 synced, 0 failed
```

## Benefits

1. **No Trigger Changes Needed** - SQL Server triggers remain unchanged
2. **Self-Healing** - Handles missing data from any source:
   - New patient/work insertions
   - Partial syncs due to previous errors
   - Manual data insertion in Supabase
   - Queue items processed out of order
3. **Data Integrity** - Prevents foreign key violations
4. **Automatic** - No manual intervention required

## Technical Details

### New Methods Added to `QueueProcessor`

#### `fetchPatientFromSqlServer(personId)`
Fetches patient record from SQL Server's `tblPatients` table.

**Returns:** Patient data object or null if not found

#### `fetchWorkFromSqlServer(workId)`
Fetches work record from SQL Server's `tblWork` table.

**Returns:** Work data object or null if not found

#### `fetchAlignerSetFromSqlServer(alignerSetId)`
Fetches aligner set record from SQL Server's `tblAlignerSets` table.

**Returns:** Aligner set data object or null if not found

#### `ensureRelatedRecordsExist(data, tableName)`
Recursively ensures all parent records exist in Supabase before syncing the current record.

**Parameters:**
- `data` - The record data being synced
- `tableName` - The table being synced ('patients', 'work', 'aligner_sets', 'aligner_batches')

**Logic:**
- For `aligner_sets`: Ensures work exists (which cascades to patient)
- For `work`: Ensures patient exists
- For `aligner_batches`: Ensures aligner_set exists (which cascades to work and patient)

### Error Handling

- If a parent record cannot be fetched from SQL Server, a warning is logged but the sync continues
- This prevents cascading failures while still providing visibility into issues
- Failed parent syncs don't block the child record from syncing

## Testing

To test the cascading sync:

1. **Create a new patient in SQL Server**
   ```sql
   INSERT INTO tblPatients (PatientName, FirstName, LastName, Phone)
   VALUES ('Test Patient', 'Test', 'Patient', '1234567890');
   ```

2. **Create a new work record for that patient**
   ```sql
   INSERT INTO tblWork (PersonID, Typeofwork, AdditionDate)
   VALUES (@PersonID, 1, GETDATE());
   ```

3. **Create a new aligner set for that work**
   ```sql
   INSERT INTO tblAlignerSets (WorkID, AlignerDrID, SetSequence, Type)
   VALUES (@WorkID, 1, 1, 'Full');
   ```

4. **Check the logs** - You should see:
   - Patient fetched and synced
   - Work fetched and synced
   - Set synced

5. **Verify in Supabase** - All three records should exist with correct relationships

## Files Modified

- `/services/sync/queue-processor.js` - Added cascading sync logic

## Related Documentation

- [Webhook Sync System](./WEBHOOK_SYNC_SYSTEM.md)
- [Sync Triggers Reference](./SYNC_TRIGGERS_REFERENCE.md)
