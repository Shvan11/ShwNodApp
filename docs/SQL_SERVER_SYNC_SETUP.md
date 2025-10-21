# SQL Server → PostgreSQL Auto-Sync Setup

This guide will set up **automatic real-time sync** from your SQL Server database to Supabase PostgreSQL.

---

## 🎯 How It Works

```
SQL Server Change
    ↓ (<1ms)
Trigger captures change → adds to SyncQueue
    ↓ (instant)
User continues working ✅
    ↓ (every 5 seconds)
Background service reads queue
    ↓
Pushes to Supabase
    ↓
Portal updated ✅
```

**Result:** Changes appear in portal within 5-10 seconds!

---

## 📋 Installation Steps

### Step 1: Create Sync Queue Table

Run this SQL script on your **SQL Server**:

```
/migrations/sqlserver/01_create_sync_queue.sql
```

**In SQL Server Management Studio:**
1. Open the file
2. Execute (F5)
3. You should see: ✅ Sync queue table created successfully

### Step 2: Create Triggers

Run this SQL script on your **SQL Server**:

```
/migrations/sqlserver/02_create_sync_triggers.sql
```

**In SQL Server Management Studio:**
1. Open the file
2. Execute (F5)
3. You should see: ✅ All sync triggers created successfully

### Step 3: Start Queue Processor

Update your `index.js` to start the queue processor:

```javascript
// Add to index.js
import queueProcessor from './services/sync/queue-processor.js';

// After server starts, start queue processor
queueProcessor.start();
```

### Step 4: Restart Your Server

```bash
node index.js
```

You should see:
```
🚀 Queue Processor Started
   Interval: 5 seconds
   Batch size: 50
   Max attempts: 10
```

---

## ✅ Testing

### Test 1: Add New Aligner Set

1. In your SQL Server, add a new aligner set:
```sql
INSERT INTO tblAlignerSets (WorkID, AlignerDrID, SetSequence, UpperAlignersCount, LowerAlignersCount, CreationDate, IsActive)
VALUES (999, 1, 1, 10, 10, GETDATE(), 1)
```

2. Check the sync queue:
```sql
SELECT * FROM SyncQueue ORDER BY QueueID DESC
```

3. Wait 5-10 seconds

4. Check Supabase Table Editor → `aligner_sets`
   - The new set should appear! ✅

### Test 2: Update Batch Delivery

1. Mark a batch as delivered:
```sql
UPDATE tblAlignerBatches
SET DeliveredToPatientDate = GETDATE()
WHERE AlignerBatchID = 1
```

2. Wait 5-10 seconds

3. Check portal - batch should show "Delivered" ✅

---

## 📊 Monitoring

### Check Queue Status

```sql
-- How many pending?
SELECT COUNT(*) as Pending FROM SyncQueue WHERE Status = 'Pending'

-- How many failed?
SELECT COUNT(*) as Failed FROM SyncQueue WHERE Status = 'Failed'

-- Recent activity
SELECT TOP 10 * FROM SyncQueue ORDER BY CreatedAt DESC

-- Failed items with errors
SELECT QueueID, TableName, RecordID, Attempts, LastError
FROM SyncQueue
WHERE Status = 'Failed'
ORDER BY CreatedAt DESC
```

### Check Service Logs

The queue processor logs to console:
```
🔄 Syncing aligner_sets ID 123 (INSERT)
  ✅ Synced successfully

📊 Queue Statistics:
═══════════════════════════════════════
  Pending: 5 items
  Synced: 1234 items
═══════════════════════════════════════
```

---

## 🛠️ Maintenance

### Cleanup Old Synced Records

Run periodically (weekly):
```sql
EXEC sp_CleanupSyncQueue @DaysOld = 7
```

This deletes synced records older than 7 days to keep queue table small.

### Retry Failed Items

If items failed due to temporary issue (e.g., internet down):
```sql
-- Reset failed items to retry
UPDATE SyncQueue
SET Status = 'Pending',
    Attempts = 0,
    LastError = NULL
WHERE Status = 'Failed'
```

---

## 🐛 Troubleshooting

### Queue items not syncing?

1. **Check service is running:**
   - Look for "🚀 Queue Processor Started" in logs

2. **Check Supabase credentials:**
   - Verify `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env`

3. **Check internet connection:**
   - Service needs internet to reach Supabase

4. **Check error messages:**
```sql
SELECT TOP 10 QueueID, TableName, LastError
FROM SyncQueue
WHERE Status = 'Failed'
ORDER BY CreatedAt DESC
```

### Triggers not firing?

1. **Check triggers exist:**
```sql
SELECT name FROM sys.triggers
WHERE parent_class_desc = 'OBJECT_OR_COLUMN'
  AND name LIKE 'trg_sync%'
```

Should show 4 triggers.

2. **Test manually:**
```sql
-- Insert test record
INSERT INTO SyncQueue (TableName, RecordID, Operation, JsonData)
VALUES ('aligner_sets', 999, 'INSERT', '{"test": true}')

-- Check if it appears
SELECT * FROM SyncQueue WHERE RecordID = 999
```

---

## 🎯 Performance

**Trigger Overhead:**
- < 1ms per insert/update
- No blocking
- Minimal impact

**Queue Processing:**
- Runs every 5 seconds
- Processes 50 items per batch
- Can handle 1000s of changes per minute

**Typical Sync Delay:**
- 5-10 seconds under normal conditions
- Retries automatically if Supabase unreachable

---

## 🔒 Security

- ✅ Uses `SUPABASE_SERVICE_ROLE_KEY` (not exposed to frontend)
- ✅ Triggers run with SQL Server privileges
- ✅ Queue table tracks all sync attempts
- ✅ Failed items can be audited

---

## 📈 What Gets Synced

| SQL Server Table | PostgreSQL Table | What Changes |
|-----------------|------------------|--------------|
| `AlignerDoctors` | `aligner_doctors` | New doctors, email changes |
| `tblAlignerSets` | `aligner_sets` | New sets, status changes, PDFs |
| `tblAlignerBatches` | `aligner_batches` | New batches, deliveries |
| `tblAlignerNotes` | `aligner_notes` | Lab notes only (not doctor notes) |

**Note:** Doctor notes from portal sync the opposite direction (PostgreSQL → SQL Server via webhooks).

---

## ✅ Success Checklist

- [ ] Queue table created
- [ ] All 4 triggers created
- [ ] Queue processor started in `index.js`
- [ ] Server restarted
- [ ] Test insert performed
- [ ] Data appeared in Supabase
- [ ] Portal shows new data

---

**You're all set!** Any changes in SQL Server will automatically sync to the portal! 🚀
