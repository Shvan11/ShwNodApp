# Transfer Aligner Sets Between Patients

This guide explains how to transfer aligner sets (and their related batches, notes, and activity flags) from one patient/work to another.

## Database Schema Overview

```
tblAlignerSets (WorkID) ─┬─► tblAlignerBatches (AlignerSetID)
                         ├─► tblAlignerNotes (AlignerSetID)
                         └─► tblAlignerActivityFlags (AlignerSetID)
```

**Key Point**: Only `tblAlignerSets` has `WorkID`. Batches, notes, and activity flags link via `AlignerSetID`, so they automatically follow when you update the set's `WorkID`.

---

## Step-by-Step Transfer Process

### Step 1: Identify the Aligner Sets to Transfer

```sql
-- Find aligner sets on the WRONG WorkID
SELECT
    s.AlignerSetID,
    s.WorkID,
    s.SetSequence,
    s.Type,
    s.CreationDate,
    s.UpperAlignersCount,
    s.LowerAlignersCount,
    p.PatientName
FROM tblAlignerSets s
JOIN tblWork w ON s.WorkID = w.workid
JOIN tblpatients p ON w.PersonID = p.PersonID
WHERE s.WorkID = @WrongWorkID  -- Replace with actual WorkID
```

### Step 2: Verify the Target Patient/Work

```sql
-- Confirm the CORRECT target WorkID exists
SELECT
    w.workid,
    p.PatientName
FROM tblWork w
JOIN tblpatients p ON w.PersonID = p.PersonID
WHERE w.workid = @CorrectWorkID  -- Replace with actual WorkID
```

### Step 3: Check Related Data (Optional but Recommended)

```sql
-- View batches that will be transferred
SELECT
    b.AlignerBatchID,
    b.AlignerSetID,
    b.BatchSequence,
    b.UpperAlignerCount,
    b.LowerAlignerCount,
    b.ManufactureDate
FROM tblAlignerBatches b
JOIN tblAlignerSets s ON b.AlignerSetID = s.AlignerSetID
WHERE s.WorkID = @WrongWorkID

-- View notes that will be transferred
SELECT n.NoteID, n.AlignerSetID, n.NoteType, n.NoteText, n.CreatedAt
FROM tblAlignerNotes n
JOIN tblAlignerSets s ON n.AlignerSetID = s.AlignerSetID
WHERE s.WorkID = @WrongWorkID

-- View activity flags that will be transferred
SELECT a.ActivityID, a.AlignerSetID, a.ActivityType, a.ActivityDescription
FROM tblAlignerActivityFlags a
JOIN tblAlignerSets s ON a.AlignerSetID = s.AlignerSetID
WHERE s.WorkID = @WrongWorkID
```

### Step 4: Execute the Transfer

```sql
-- Transfer ALL aligner sets from one WorkID to another
UPDATE tblAlignerSets
SET WorkID = @CorrectWorkID
WHERE WorkID = @WrongWorkID

-- OR transfer specific sets by AlignerSetID
UPDATE tblAlignerSets
SET WorkID = @CorrectWorkID
WHERE AlignerSetID IN (@SetID1, @SetID2, ...)
```

### Step 5: Verify the Transfer

```sql
-- Confirm sets are now on correct patient
SELECT
    s.AlignerSetID,
    s.WorkID,
    s.SetSequence,
    p.PatientName
FROM tblAlignerSets s
JOIN tblWork w ON s.WorkID = w.workid
JOIN tblpatients p ON w.PersonID = p.PersonID
WHERE s.WorkID = @CorrectWorkID
```

---

## Example: Transfer from WorkID 10475 to 10441

This was the actual case where aligner set was entered for wrong patient.

**Wrong patient**: نور الهدى (WorkID: 10475)
**Correct patient**: نورالهدى محمود (WorkID: 10441)

```sql
-- Verify before transfer
SELECT AlignerSetID, WorkID, SetSequence, UpperAlignersCount, LowerAlignersCount
FROM tblAlignerSets WHERE WorkID = 10475;
-- Result: AlignerSetID=148, 33 upper, 15 lower aligners

-- Check batches (4 batches will follow)
SELECT AlignerBatchID, BatchSequence FROM tblAlignerBatches WHERE AlignerSetID = 148;
-- Result: Batches 133, 176, 218, 261

-- EXECUTE TRANSFER
UPDATE tblAlignerSets
SET WorkID = 10441
WHERE WorkID = 10475;

-- Verify after transfer
SELECT s.AlignerSetID, s.WorkID, p.PatientName
FROM tblAlignerSets s
JOIN tblWork w ON s.WorkID = w.workid
JOIN tblpatients p ON w.PersonID = p.PersonID
WHERE s.AlignerSetID = 148;
```

---

## Important Notes

1. **Batches, notes, and activity flags automatically transfer** - they reference `AlignerSetID`, not `WorkID`

2. **SetSequence may need adjustment** - if the target patient already has aligner sets, you may need to update `SetSequence` to avoid duplicates:
   ```sql
   -- Check existing sets on target
   SELECT SetSequence FROM tblAlignerSets WHERE WorkID = @CorrectWorkID;

   -- Update sequence if needed
   UPDATE tblAlignerSets SET SetSequence = @NewSequence WHERE AlignerSetID = @SetID;
   ```

3. **Google Drive files (SetPdfUrl, DriveFileId)** - these remain unchanged and will still work

4. **Backup first** - for critical data, consider backing up before transfer:
   ```sql
   SELECT * INTO tblAlignerSets_Backup FROM tblAlignerSets WHERE WorkID = @WrongWorkID;
   ```

---

## Quick Reference Template

```sql
-- =============================================
-- ALIGNER SET TRANSFER TEMPLATE
-- =============================================
-- Wrong WorkID:   ________
-- Correct WorkID: ________
-- Date: ________
-- Reason: ________
-- =============================================

-- 1. VERIFY SOURCE (copy results for record)
SELECT AlignerSetID, WorkID, SetSequence, UpperAlignersCount, LowerAlignersCount
FROM tblAlignerSets WHERE WorkID = ________;

-- 2. VERIFY TARGET
SELECT w.workid, p.PatientName FROM tblWork w
JOIN tblpatients p ON w.PersonID = p.PersonID
WHERE w.workid = ________;

-- 3. TRANSFER
UPDATE tblAlignerSets SET WorkID = ________ WHERE WorkID = ________;

-- 4. CONFIRM
SELECT s.AlignerSetID, s.WorkID, p.PatientName
FROM tblAlignerSets s
JOIN tblWork w ON s.WorkID = w.workid
JOIN tblpatients p ON w.PersonID = p.PersonID
WHERE s.WorkID = ________;
```
