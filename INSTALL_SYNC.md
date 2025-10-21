# 🚀 Quick Installation Guide - SQL Server Sync

Follow these 3 simple steps to enable automatic sync from SQL Server to Supabase.

---

## ✅ Step 1: Run SQL Scripts (5 minutes)

### **Open SQL Server Management Studio:**

1. **Connect to your SQL Server**
2. **Create SyncQueue table:**
   - Open file: `/migrations/sqlserver/01_create_sync_queue.sql`
   - Execute (F5)
   - ✅ You should see: "SyncQueue table created successfully"

3. **Create all 4 triggers:**
   - Open file: `/migrations/sqlserver/02_create_sync_triggers.sql`
   - Execute (F5)
   - ✅ You should see: "All sync triggers created successfully"

**Or run manually from** `/docs/SYNC_TRIGGERS_REFERENCE.md` (copy/paste each trigger)

---

## ✅ Step 2: Update index.js (1 minute)

Add these lines to your `/home/administrator/projects/ShwNodApp/index.js`:

```javascript
// Add near top with other imports
import queueProcessor from './services/sync/queue-processor.js';

// Add AFTER server starts (after app.listen(...))
// Start SQL Server → PostgreSQL sync
queueProcessor.start();
console.log('✅ Queue processor started - SQL Server sync enabled');
```

**Example placement:**

```javascript
// ... your existing code ...

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});

// ADD THIS HERE ↓
queueProcessor.start();
console.log('✅ Queue processor started - SQL Server sync enabled');

// ... rest of your code ...
```

---

## ✅ Step 3: Restart Server (30 seconds)

```bash
# Stop current server (Ctrl+C if running)
# Then start:
node index.js
```

**You should see:**

```
Server running on port 3000
🚀 Queue Processor Started (Smart Polling)
   Fast interval: 5 seconds (when busy)
   Slow interval: 60 seconds (when idle)
   Batch size: 50
   Max attempts: 10
═══════════════════════════════════════
✅ Queue processor started - SQL Server sync enabled
```

---

## 🧪 Step 4: Test It! (2 minutes)

### Test in SQL Server:

```sql
-- Add a test aligner set
INSERT INTO tblAlignerSets (WorkID, AlignerDrID, SetSequence, UpperAlignersCount, LowerAlignersCount, CreationDate, IsActive)
VALUES (999, 1, 1, 15, 15, GETDATE(), 1);

-- Check it was queued
SELECT * FROM SyncQueue ORDER BY QueueID DESC;
```

**Expected:** 1 new row with Status = 'Pending'

### Wait 5-10 seconds, then check:

```sql
-- Should show Status = 'Synced'
SELECT * FROM SyncQueue WHERE Status = 'Synced' ORDER BY QueueID DESC;
```

### Check Supabase:

1. Go to Supabase → Table Editor → `aligner_sets`
2. Look for WorkID = 999
3. ✅ It should be there!

### Check Portal:

1. Go to your portal URL
2. Login as doctor with ID 1
3. ✅ You should see the new case!

---

## 📊 Monitor Sync

### Check queue status:

```sql
-- Summary
SELECT Status, COUNT(*) as Count
FROM SyncQueue
GROUP BY Status;

-- Recent activity
SELECT TOP 10 * FROM SyncQueue ORDER BY QueueID DESC;
```

### Check server logs:

You'll see output like:
```
📦 Processing 5 items from sync queue...
🔄 Syncing aligner_sets ID 123 (INSERT)
  ✅ Synced successfully
✅ Batch complete: 5 synced, 0 failed
```

---

## 🎉 You're Done!

**What you now have:**

- ✅ Automatic sync from SQL Server to Supabase
- ✅ Changes appear in portal within 5-10 seconds
- ✅ Smart polling (saves resources when idle)
- ✅ Automatic retry on failure
- ✅ Full monitoring via SyncQueue table

**Next step:** Set up reverse sync (PostgreSQL → SQL Server) for doctor edits!

---

## 🆘 Troubleshooting

### No items in queue?

- Check triggers exist: `SELECT * FROM sys.triggers WHERE name LIKE 'trg_sync%'`
- Should show 4 triggers

### Items stuck as "Pending"?

- Check server logs for errors
- Verify Supabase credentials in `.env`
- Check internet connection

### Need help?

See `/docs/SQL_SERVER_SYNC_SETUP.md` for detailed troubleshooting.

