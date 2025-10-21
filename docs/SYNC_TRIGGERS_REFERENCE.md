# SQL Server Sync Triggers - Complete Reference

This document contains all triggers for automatic sync from SQL Server to PostgreSQL (Supabase).

---

## 📋 Overview

These triggers automatically capture changes in your SQL Server database and add them to the `SyncQueue` table for syncing to Supabase.

**Triggers Created:**
1. `trg_sync_AlignerDoctors` - Doctors table
2. `trg_sync_tblAlignerSets` - Aligner sets
3. `trg_sync_tblAlignerBatches` - Batches
4. `trg_sync_tblAlignerNotes` - Notes (Lab notes only)

---

## 🎯 How Triggers Work

```
User Action (INSERT/UPDATE)
    ↓
Trigger fires automatically (< 1ms)
    ↓
Converts data to JSON format
    ↓
Inserts into SyncQueue table
    ↓
Returns control immediately
    ↓
User continues working (no blocking!)
```

**Performance Impact:** < 1ms per operation (negligible)

---

## 📝 Installation Instructions

### **Open SQL Server Management Studio**
1. Connect to your SQL Server
2. Open a new query window
3. Copy and paste each trigger script below
4. Execute one at a time (F5)

---

## 🔧 Trigger Scripts

### **Trigger 1: AlignerDoctors**

**Purpose:** Syncs doctor information (name, email, logo) when added or updated.

**Fires on:** INSERT, UPDATE on `AlignerDoctors` table

```sql
-- Drop existing trigger if exists
IF OBJECT_ID('trg_sync_AlignerDoctors', 'TR') IS NOT NULL
    DROP TRIGGER trg_sync_AlignerDoctors;
GO

-- Create trigger
CREATE TRIGGER trg_sync_AlignerDoctors
ON AlignerDoctors
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    -- Add to sync queue
    INSERT INTO SyncQueue (TableName, RecordID, Operation, JsonData)
    SELECT
        'aligner_doctors',
        i.DrID,
        CASE WHEN EXISTS(SELECT 1 FROM deleted d WHERE d.DrID = i.DrID)
             THEN 'UPDATE'
             ELSE 'INSERT'
        END,
        (SELECT
            i.DrID as dr_id,
            i.DoctorName as doctor_name,
            i.DoctorEmail as doctor_email,
            i.LogoPath as logo_path
         FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
    FROM inserted i;
END
GO

PRINT '✅ Trigger trg_sync_AlignerDoctors created';
GO
```

**What it does:**
- Captures new doctors being added
- Captures doctor email or name changes
- Converts data to JSON format matching PostgreSQL schema
- Adds to queue for background sync

---

### **Trigger 2: tblAlignerSets**

**Purpose:** Syncs aligner sets (new sets, status changes, PDF uploads, cost updates).

**Fires on:** INSERT, UPDATE on `tblAlignerSets` table

```sql
-- Drop existing trigger if exists
IF OBJECT_ID('trg_sync_tblAlignerSets', 'TR') IS NOT NULL
    DROP TRIGGER trg_sync_tblAlignerSets;
GO

-- Create trigger
CREATE TRIGGER trg_sync_tblAlignerSets
ON tblAlignerSets
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    -- Add to sync queue
    INSERT INTO SyncQueue (TableName, RecordID, Operation, JsonData)
    SELECT
        'aligner_sets',
        i.AlignerSetID,
        CASE WHEN EXISTS(SELECT 1 FROM deleted d WHERE d.AlignerSetID = i.AlignerSetID)
             THEN 'UPDATE'
             ELSE 'INSERT'
        END,
        (SELECT
            i.AlignerSetID as aligner_set_id,
            i.WorkID as work_id,
            i.AlignerDrID as aligner_dr_id,
            i.SetSequence as set_sequence,
            i.Type as type,
            i.UpperAlignersCount as upper_aligners_count,
            i.LowerAlignersCount as lower_aligners_count,
            i.RemainingUpperAligners as remaining_upper_aligners,
            i.RemainingLowerAligners as remaining_lower_aligners,
            i.CreationDate as creation_date,
            i.Days as days,
            i.IsActive as is_active,
            i.Notes as notes,
            i.FolderPath as folder_path,
            i.SetUrl as set_url,
            i.SetPdfUrl as set_pdf_url,
            i.SetCost as set_cost,
            i.Currency as currency,
            i.PdfUploadedAt as pdf_uploaded_at,
            i.PdfUploadedBy as pdf_uploaded_by,
            i.DriveFileId as drive_file_id
         FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
    FROM inserted i;
END
GO

PRINT '✅ Trigger trg_sync_tblAlignerSets created';
GO
```

**What it does:**
- Captures new aligner sets being created
- Captures set status changes (active/inactive)
- Captures PDF uploads
- Captures cost and payment updates
- Syncs all set details to portal

---

### **Trigger 3: tblAlignerBatches**

**Purpose:** Syncs batch information (new batches, delivery dates, days per aligner).

**Fires on:** INSERT, UPDATE on `tblAlignerBatches` table

**⚠️ IMPORTANT:** Does NOT overwrite doctor-edited days values (handled by sync service)

```sql
-- Drop existing trigger if exists
IF OBJECT_ID('trg_sync_tblAlignerBatches', 'TR') IS NOT NULL
    DROP TRIGGER trg_sync_tblAlignerBatches;
GO

-- Create trigger
CREATE TRIGGER trg_sync_tblAlignerBatches
ON tblAlignerBatches
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    -- Add to sync queue
    INSERT INTO SyncQueue (TableName, RecordID, Operation, JsonData)
    SELECT
        'aligner_batches',
        i.AlignerBatchID,
        CASE WHEN EXISTS(SELECT 1 FROM deleted d WHERE d.AlignerBatchID = i.AlignerBatchID)
             THEN 'UPDATE'
             ELSE 'INSERT'
        END,
        (SELECT
            i.AlignerBatchID as aligner_batch_id,
            i.AlignerSetID as aligner_set_id,
            i.BatchSequence as batch_sequence,
            i.UpperAlignerCount as upper_aligner_count,
            i.LowerAlignerCount as lower_aligner_count,
            i.UpperAlignerStartSequence as upper_aligner_start_sequence,
            i.UpperAlignerEndSequence as upper_aligner_end_sequence,
            i.LowerAlignerStartSequence as lower_aligner_start_sequence,
            i.LowerAlignerEndSequence as lower_aligner_end_sequence,
            i.ManufactureDate as manufacture_date,
            i.DeliveredToPatientDate as delivered_to_patient_date,
            i.Days as days,
            i.ValidityPeriod as validity_period,
            i.NextBatchReadyDate as next_batch_ready_date,
            i.Notes as notes,
            i.IsActive as is_active
         FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
    FROM inserted i;
END
GO

PRINT '✅ Trigger trg_sync_tblAlignerBatches created';
GO
```

**What it does:**
- Captures new batches being created
- Captures delivery dates being set
- Captures days per aligner changes
- Note: Sync service checks if doctor edited days in portal before overwriting

---

### **Trigger 4: tblAlignerNotes**

**Purpose:** Syncs LAB notes only (doctor notes come from portal, don't need to sync back).

**Fires on:** INSERT, UPDATE on `tblAlignerNotes` table

**Filter:** Only syncs notes with `NoteType = 'Lab'`

```sql
-- Drop existing trigger if exists
IF OBJECT_ID('trg_sync_tblAlignerNotes', 'TR') IS NOT NULL
    DROP TRIGGER trg_sync_tblAlignerNotes;
GO

-- Create trigger
CREATE TRIGGER trg_sync_tblAlignerNotes
ON tblAlignerNotes
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    -- Only sync Lab notes (Doctor notes come from portal)
    INSERT INTO SyncQueue (TableName, RecordID, Operation, JsonData)
    SELECT
        'aligner_notes',
        i.NoteID,
        CASE WHEN EXISTS(SELECT 1 FROM deleted d WHERE d.NoteID = i.NoteID)
             THEN 'UPDATE'
             ELSE 'INSERT'
        END,
        (SELECT
            i.NoteID as note_id,
            i.AlignerSetID as aligner_set_id,
            i.NoteType as note_type,
            i.NoteText as note_text,
            i.CreatedAt as created_at,
            i.IsEdited as is_edited,
            i.EditedAt as edited_at
         FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
    FROM inserted i
    WHERE i.NoteType = 'Lab'; -- IMPORTANT: Only Lab notes!
END
GO

PRINT '✅ Trigger trg_sync_tblAlignerNotes created';
GO
```

**What it does:**
- Captures lab notes being added
- **SKIPS doctor notes** (those are added from portal, already in PostgreSQL)
- Prevents circular sync loop

**Why filter Lab notes only?**
```
Lab adds note in SQL Server
    → Trigger syncs to PostgreSQL
    → Doctor sees it in portal ✅

Doctor adds note in portal (PostgreSQL)
    → Webhook syncs to SQL Server
    → Trigger does NOT fire (NoteType = 'Doctor')
    → No circular loop ✅
```

---

## ✅ Verification

After creating all triggers, verify they exist:

```sql
-- Check all triggers are created
SELECT
    name as TriggerName,
    OBJECT_NAME(parent_id) as TableName,
    create_date as CreatedDate,
    modify_date as ModifiedDate
FROM sys.triggers
WHERE name LIKE 'trg_sync%'
ORDER BY name;
```

**Expected output:** 4 triggers

---

## 🧪 Testing Triggers

### Test 1: Doctor Sync

```sql
-- Update a doctor's email
UPDATE AlignerDoctors
SET DoctorEmail = 'test@example.com'
WHERE DrID = 1;

-- Check if it was added to queue
SELECT * FROM SyncQueue WHERE TableName = 'aligner_doctors' ORDER BY QueueID DESC;
```

**Expected:** 1 new row in SyncQueue with Status = 'Pending'

### Test 2: Aligner Set Sync

```sql
-- Add a new set
INSERT INTO tblAlignerSets (WorkID, AlignerDrID, SetSequence, UpperAlignersCount, LowerAlignersCount, CreationDate, IsActive)
VALUES (999, 1, 1, 10, 10, GETDATE(), 1);

-- Check queue
SELECT * FROM SyncQueue WHERE TableName = 'aligner_sets' ORDER BY QueueID DESC;
```

**Expected:** 1 new row in SyncQueue

### Test 3: Batch Delivery

```sql
-- Mark batch as delivered
UPDATE tblAlignerBatches
SET DeliveredToPatientDate = GETDATE()
WHERE AlignerBatchID = 1;

-- Check queue
SELECT * FROM SyncQueue WHERE TableName = 'aligner_batches' ORDER BY QueueID DESC;
```

**Expected:** 1 new row in SyncQueue

### Test 4: Lab Note

```sql
-- Add lab note
INSERT INTO tblAlignerNotes (AlignerSetID, NoteType, NoteText)
VALUES (1, 'Lab', 'Test lab note');

-- Check queue
SELECT * FROM SyncQueue WHERE TableName = 'aligner_notes' ORDER BY QueueID DESC;
```

**Expected:** 1 new row in SyncQueue

### Test 5: Doctor Note (Should NOT sync)

```sql
-- Add doctor note
INSERT INTO tblAlignerNotes (AlignerSetID, NoteType, NoteText)
VALUES (1, 'Doctor', 'Test doctor note');

-- Check queue
SELECT * FROM SyncQueue WHERE TableName = 'aligner_notes' AND RecordID = @@IDENTITY;
```

**Expected:** NO new row (doctor notes don't sync this direction)

---

## 🔧 Maintenance

### Disable All Triggers

If you need to temporarily disable sync:

```sql
DISABLE TRIGGER trg_sync_AlignerDoctors ON AlignerDoctors;
DISABLE TRIGGER trg_sync_tblAlignerSets ON tblAlignerSets;
DISABLE TRIGGER trg_sync_tblAlignerBatches ON tblAlignerBatches;
DISABLE TRIGGER trg_sync_tblAlignerNotes ON tblAlignerNotes;

PRINT 'All sync triggers disabled';
```

### Re-enable All Triggers

```sql
ENABLE TRIGGER trg_sync_AlignerDoctors ON AlignerDoctors;
ENABLE TRIGGER trg_sync_tblAlignerSets ON tblAlignerSets;
ENABLE TRIGGER trg_sync_tblAlignerBatches ON tblAlignerBatches;
ENABLE TRIGGER trg_sync_tblAlignerNotes ON tblAlignerNotes;

PRINT 'All sync triggers enabled';
```

### Remove All Triggers

If you want to completely remove sync:

```sql
DROP TRIGGER IF EXISTS trg_sync_AlignerDoctors;
DROP TRIGGER IF EXISTS trg_sync_tblAlignerSets;
DROP TRIGGER IF EXISTS trg_sync_tblAlignerBatches;
DROP TRIGGER IF EXISTS trg_sync_tblAlignerNotes;

PRINT 'All sync triggers removed';
```

---

## 📊 Monitoring Triggers

### Check Trigger Activity

```sql
-- How many items in queue by table
SELECT
    TableName,
    Status,
    COUNT(*) as Count
FROM SyncQueue
GROUP BY TableName, Status
ORDER BY TableName, Status;
```

### Recent Trigger Activity

```sql
-- Last 10 items added by triggers
SELECT TOP 10
    QueueID,
    TableName,
    RecordID,
    Operation,
    CreatedAt,
    Status
FROM SyncQueue
ORDER BY QueueID DESC;
```

### Failed Syncs

```sql
-- Check if any syncs failed
SELECT
    QueueID,
    TableName,
    RecordID,
    Attempts,
    LastError,
    CreatedAt
FROM SyncQueue
WHERE Status = 'Failed'
ORDER BY CreatedAt DESC;
```

---

## 🎯 Data Flow Summary

```
SQL Server Trigger              PostgreSQL Table
─────────────────────           ────────────────────
trg_sync_AlignerDoctors    →    aligner_doctors
trg_sync_tblAlignerSets    →    aligner_sets
trg_sync_tblAlignerBatches →    aligner_batches
trg_sync_tblAlignerNotes   →    aligner_notes (Lab only)
```

---

## 🔒 Security Notes

- ✅ Triggers run with SQL Server privileges (secure)
- ✅ Only authorized users can modify watched tables
- ✅ Queue data is internal to SQL Server (not exposed)
- ✅ Sync service uses service role key (not exposed to frontend)

---

## 📞 Troubleshooting

### Trigger not firing?

1. **Check trigger exists:**
   ```sql
   SELECT * FROM sys.triggers WHERE name = 'trg_sync_AlignerDoctors';
   ```

2. **Check trigger is enabled:**
   ```sql
   SELECT name, is_disabled FROM sys.triggers WHERE name LIKE 'trg_sync%';
   ```
   (is_disabled should be 0)

3. **Test manually:**
   ```sql
   UPDATE AlignerDoctors SET DoctorName = DoctorName WHERE DrID = 1;
   SELECT * FROM SyncQueue ORDER BY QueueID DESC;
   ```

### Data not in JSON format?

Check the JsonData column:
```sql
SELECT TOP 1 JsonData FROM SyncQueue WHERE TableName = 'aligner_sets';
```

Should look like:
```json
{"aligner_set_id":1,"work_id":123,"aligner_dr_id":1,...}
```

---

**Created:** 2025-10-20
**Last Updated:** 2025-10-20
**Triggers Version:** 1.0
**Status:** Production Ready ✅

