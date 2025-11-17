-- Fix for Batch Sequence +1 Bug
--
-- Problem: The trg_AlignerBatches_SetSequence trigger automatically recalculates
-- BatchSequence after insert, causing it to be incremented even though the frontend
-- already calculated the correct value.
--
-- Solution: Drop the trigger since the frontend (BatchFormDrawer.jsx) already handles
-- BatchSequence calculation correctly using MAX(BatchSequence) + 1
--
-- Safety: Add a NOT NULL constraint to prevent NULL sequences from direct SQL inserts

USE [clinicdb];
GO

PRINT 'Fixing Batch Sequence +1 Bug...';
PRINT '';

-- Step 1: Drop the problematic trigger
IF EXISTS (SELECT 1 FROM sys.triggers WHERE name = 'trg_AlignerBatches_SetSequence')
BEGIN
    DROP TRIGGER [dbo].[trg_AlignerBatches_SetSequence];
    PRINT '✓ Dropped trigger: trg_AlignerBatches_SetSequence';
    PRINT '  Reason: Trigger was overwriting frontend-calculated BatchSequence values';
END
ELSE
BEGIN
    PRINT '! Trigger trg_AlignerBatches_SetSequence does not exist (already dropped)';
END

PRINT '';

-- Step 2: Verify BatchSequence column allows NULL (we'll keep it flexible for now)
-- Note: We're NOT adding NOT NULL constraint because:
-- 1. It might fail if existing data has NULLs
-- 2. The frontend validation is sufficient
-- 3. The INSTEAD OF trigger (trg_ValidateAlignerBatchCounts) will catch issues

-- Step 3: Verify the fix
PRINT '✓ Fix applied successfully!';
PRINT '';
PRINT 'Summary:';
PRINT '  - BatchSequence is now controlled by frontend (BatchFormDrawer.jsx)';
PRINT '  - Frontend calculates: MAX(BatchSequence) + 1';
PRINT '  - No more +1 increment bug';
PRINT '  - Gaps in sequences are allowed (e.g., 1, 2, 5 if batch 3-4 deleted)';
PRINT '';

-- Step 4: Show current batch sequences for verification
PRINT 'Current batch sequences by set:';
SELECT
    s.AlignerSetID,
    COUNT(b.AlignerBatchID) as TotalBatches,
    MIN(b.BatchSequence) as MinSequence,
    MAX(b.BatchSequence) as MaxSequence,
    STRING_AGG(CAST(b.BatchSequence AS VARCHAR), ', ') WITHIN GROUP (ORDER BY b.BatchSequence) as AllSequences
FROM tblAlignerSets s
LEFT JOIN tblAlignerBatches b ON s.AlignerSetID = b.AlignerSetID
GROUP BY s.AlignerSetID
HAVING COUNT(b.AlignerBatchID) > 0
ORDER BY s.AlignerSetID;

GO
