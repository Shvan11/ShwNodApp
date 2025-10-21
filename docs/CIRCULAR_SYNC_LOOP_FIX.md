# Circular Sync Loop Fix - Root Cause Analysis

## The Problem

After implementing bidirectional sync between SQL Server and Supabase, we encountered an **infinite circular sync loop** that caused:
- Excessive webhook spam
- Queue never emptying (50+ items on every restart)
- Database trigger spam
- Unnecessary network/CPU usage

## Root Cause Analysis

### Why The Loop Happened

**The Circular Flow:**
```
1. Queue Processor: SQL Server → Supabase
   - Syncs batch with Days=11 to Supabase
   - Uses UPSERT: UPDATE aligner_batches SET days=11 WHERE id=229

2. PostgreSQL Trigger Fires (Supabase)
   - Automatically updates: SET updated_at = NOW()
   - This happens EVEN IF days was already 11 (no actual change)

3. Reverse Sync Poller Detects "Change"
   - Queries: WHERE updated_at > last_sync_time
   - Finds the record because updated_at changed
   - Syncs Days=11 back to SQL Server

4. SQL Server Trigger Fires
   - Adds item to SyncQueue
   - This happens EVEN IF Days was already 11 (no actual change)

5. Back to Step 1 → INFINITE LOOP
```

### The Fundamental Issue

**Database triggers don't have built-in change detection**. They fire on every INSERT/UPDATE statement, regardless of whether column values actually changed:

```sql
-- This fires the trigger EVEN IF Days was already 11:
UPDATE tblAlignerBatches SET Days = 11 WHERE AlignerBatchID = 229;

-- Trigger executes:
INSERT INTO SyncQueue (...) SELECT ... FROM inserted;
-- No check if OLD.Days <> NEW.Days
```

Similarly, Supabase's PostgreSQL trigger:
```sql
CREATE TRIGGER handle_updated_at
BEFORE UPDATE ON aligner_batches
FOR EACH ROW
EXECUTE FUNCTION moddatetime(updated_at);
-- Fires on EVERY UPDATE, even if no data changed
```

## Why This Wasn't Obvious Initially

1. **The triggers worked fine before bidirectional sync** - one-way sync doesn't create loops
2. **Supabase's `updated_at` auto-updating is standard behavior** - most ORMs do this
3. **The loop only happens when both systems sync each other** - rare architecture

## The Real Solution

### SQL Server Trigger Fix (PROPER FIX)

Modify triggers to **compare OLD vs NEW values** before adding to SyncQueue:

```sql
CREATE TRIGGER trg_sync_tblAlignerBatches
ON tblAlignerBatches
AFTER INSERT, UPDATE
AS
BEGIN
    INSERT INTO SyncQueue (TableName, RecordID, Operation, JsonData)
    SELECT ...
    FROM inserted i
    LEFT JOIN deleted d ON i.AlignerBatchID = d.AlignerBatchID
    WHERE
        -- Always include INSERTs (no matching deleted record)
        d.AlignerBatchID IS NULL
        -- For UPDATEs, only include if ANY field actually changed
        OR (
            ISNULL(i.Days, -1) <> ISNULL(d.Days, -1)
            OR ISNULL(i.UpperAlignerCount, -1) <> ISNULL(d.UpperAlignerCount, -1)
            OR ... -- Check all relevant columns
        );
END
```

**How It Works:**
- `inserted` table = NEW values after UPDATE
- `deleted` table = OLD values before UPDATE
- Compare OLD vs NEW for every column
- Only add to SyncQueue if something actually changed

**Benefits:**
- ✅ Eliminates circular loops at the source
- ✅ Reduces SyncQueue clutter (only real changes)
- ✅ Reduces webhook spam
- ✅ No extra SELECT queries needed
- ✅ Happens in the database (zero network overhead)

### Alternative Solutions (Not Recommended)

#### Option 1: Application-Level Change Detection
```javascript
// BEFORE UPDATE, fetch current value
const existing = await supabase
    .from('aligner_batches')
    .select('days')
    .eq('id', 229)
    .single();

// Compare and only upsert if different
if (existing.days !== newData.days) {
    await supabase.from('aligner_batches').upsert(newData);
}
```

**Downsides:**
- Extra SELECT query for every sync (doubles database calls)
- Adds network latency
- Race condition potential

#### Option 2: Modify Supabase's `updated_at` Trigger
```sql
CREATE OR REPLACE FUNCTION smart_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    IF (OLD.days IS DISTINCT FROM NEW.days) OR ... THEN
        NEW.updated_at = NOW();
    ELSE
        NEW.updated_at = OLD.updated_at;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

**Downsides:**
- Requires modifying Supabase database
- May be overwritten during Supabase migrations
- Affects ALL updates (not just sync operations)

## Implementation

### 1. Apply The Fix

Run the migration to fix SQL Server triggers:

```bash
node scripts/apply-trigger-fix.js
```

This applies: `migrations/sqlserver/06_fix_trigger_change_detection.sql`

### 2. Clear Existing Queue (Optional)

If you want to start fresh:

```sql
-- Mark all pending items as handled
UPDATE SyncQueue SET Status = 'Synced' WHERE Status = 'Pending';

-- Or delete them entirely
DELETE FROM SyncQueue WHERE Status = 'Pending';
```

### 3. Restart Server

```bash
node index.js
```

## Expected Behavior After Fix

### First Run (After Applying Trigger Fix)
```
🚀 Starting server...
✅ Queue processor started
⏰ Starting periodic reverse sync
🚀 Running initial reverse sync on startup...

📦 Processing 50 items from sync queue...
   (These are old items from before the fix)
🔄 Syncing batch 229 days to SQL Server
  ✅ Batch days synced (trigger only fires if value changed)
   (Trigger compares: Days=11 vs Days=11 → NO CHANGE → No SyncQueue item added)

✅ Batch complete: 50 synced, 0 failed
✅ Queue fully processed - all items synced
```

### Second Run (Should be clean)
```
🚀 Starting server...
✅ Queue processor started
🚀 Running initial reverse sync on startup...

🔍 Polling for notes since ...
   ✓ No new notes found

🔍 Polling for batch updates since ...
   📦 Found 17 edited batch(es)
🔄 Syncing batch 11 days to SQL Server
  ✅ Batch days synced (trigger only fires if value changed)
   (Trigger compares: Days=11 vs Days=11 → NO CHANGE → No SyncQueue item added)

✅ Reverse sync complete: 0 notes, 17 batches

📦 Processing queue...
   (No items - queue is empty!)
✅ Queue fully processed - all items synced
```

**Key Indicators:**
- ✅ Reverse sync still runs and syncs batches (Supabase → SQL Server)
- ✅ SQL Server trigger doesn't fire when values match
- ✅ **Zero new items added to SyncQueue**
- ✅ Second startup has empty queue
- ✅ No webhook spam

## Testing

### Manual Test: Doctor Edits Batch

1. Doctor changes batch days in external portal (Supabase): 11 → 14
2. Expected flow:
   ```
   Supabase webhook → sync-engine.js → syncBatchDaysToSqlServer()
   → SQL Server: UPDATE Days = 14
   → SQL Trigger fires (14 ≠ 11, actual change!)
   → SyncQueue item added
   → Queue processor syncs to Supabase
   → Supabase updated_at changes
   → Reverse sync poller finds it
   → Compares: SQL Server Days=14, Supabase Days=14
   → SQL Trigger: 14 = 14, no change, skip
   → Loop broken!
   ```

3. Verify:
   ```sql
   -- Should have exactly 1 SyncQueue item for this change
   SELECT * FROM SyncQueue
   WHERE TableName = 'aligner_batches'
   AND RecordID = 229
   ORDER BY QueueID DESC;
   ```

## Summary

### The Ridiculous Behavior You Identified

**Question:** "Why do we receive it as a change when nothing changed? We should receive nothing!"

**Answer:** You're 100% correct. Database triggers (both SQL Server and PostgreSQL) don't automatically check if values changed - they fire on every UPDATE statement by default. This is a design pattern that works fine for one-way sync but creates loops in bidirectional sync.

### The Proper Fix

**NOT a workaround:** Modify triggers to compare OLD vs NEW values before firing

**Benefits:**
- Zero extra queries
- Zero network overhead
- Happens in database layer (fastest possible)
- Eliminates the problem at the source

### Files Modified

1. **Created:**
   - `migrations/sqlserver/06_fix_trigger_change_detection.sql` - Trigger fix
   - `scripts/apply-trigger-fix.js` - Migration script
   - `docs/CIRCULAR_SYNC_LOOP_FIX.md` - This documentation

2. **Updated:**
   - `services/sync/sync-engine.js` - Removed workaround, added comment about trigger fix

## Lessons Learned

1. **Bidirectional sync requires change detection** - triggers must compare values
2. **Auto-updating `updated_at` is standard** - can't rely on it for change detection
3. **Test both directions independently** - isolate SQL→Supabase and Supabase→SQL flows
4. **Database logs are essential** - we identified the issue through SyncQueue queries

---

**Status:** ✅ **RESOLVED** - Proper fix applied at database trigger level
