-- Migration: Add DELETE support to trg_sync_tblAlignerBatches
-- Purpose: Queue deleted batch records for sync to external systems
-- Issue: Fix 4 from Aligner Batch Code Review - DELETE operations weren't being synced
-- Date: 2026-01-27

USE ShwanNew;
GO

SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- ============================================
-- Step 1: Drop existing trigger
-- ============================================

IF OBJECT_ID('dbo.trg_sync_tblAlignerBatches', 'TR') IS NOT NULL
    DROP TRIGGER dbo.trg_sync_tblAlignerBatches;
GO

PRINT 'Dropped existing trg_sync_tblAlignerBatches trigger';
GO

-- ============================================
-- Step 2: Recreate trigger with DELETE support
-- ============================================

CREATE TRIGGER dbo.trg_sync_tblAlignerBatches
ON dbo.tblAlignerBatches
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    -- Handle DELETE: queue deleted records for sync
    -- DELETE = records exist in 'deleted' but not in 'inserted'
    IF EXISTS (SELECT 1 FROM deleted) AND NOT EXISTS (SELECT 1 FROM inserted)
    BEGIN
        INSERT INTO SyncQueue (TableName, RecordID, Operation, Status, CreatedAt)
        SELECT 'aligner_batches', d.AlignerBatchID, 'DELETE', 'pending', GETDATE()
        FROM deleted d;
        RETURN;
    END

    -- Handle INSERT/UPDATE: existing logic with change detection
    -- Only insert if there are actual changes
    IF NOT EXISTS (
        SELECT 1 FROM inserted i
        LEFT JOIN deleted d ON i.AlignerBatchID = d.AlignerBatchID
        WHERE d.AlignerBatchID IS NULL  -- INSERT
           OR (  -- UPDATE with actual changes
               ISNULL(i.Days, -1) <> ISNULL(d.Days, -1)
               OR ISNULL(i.UpperAlignerCount, -1) <> ISNULL(d.UpperAlignerCount, -1)
               OR ISNULL(i.LowerAlignerCount, -1) <> ISNULL(d.LowerAlignerCount, -1)
               OR ISNULL(i.UpperAlignerStartSequence, -1) <> ISNULL(d.UpperAlignerStartSequence, -1)
               OR ISNULL(i.UpperAlignerEndSequence, -1) <> ISNULL(d.UpperAlignerEndSequence, -1)
               OR ISNULL(i.LowerAlignerStartSequence, -1) <> ISNULL(d.LowerAlignerStartSequence, -1)
               OR ISNULL(i.LowerAlignerEndSequence, -1) <> ISNULL(d.LowerAlignerEndSequence, -1)
               OR ISNULL(CAST(i.ManufactureDate AS VARCHAR), '') <> ISNULL(CAST(d.ManufactureDate AS VARCHAR), '')
               OR ISNULL(CAST(i.DeliveredToPatientDate AS VARCHAR), '') <> ISNULL(CAST(d.DeliveredToPatientDate AS VARCHAR), '')
               OR ISNULL(i.ValidityPeriod, -1) <> ISNULL(d.ValidityPeriod, -1)
               OR ISNULL(CAST(i.BatchExpiryDate AS VARCHAR), '') <> ISNULL(CAST(d.BatchExpiryDate AS VARCHAR), '')
               OR ISNULL(i.Notes, '') <> ISNULL(d.Notes, '')
               OR ISNULL(i.IsActive, 0) <> ISNULL(d.IsActive, 0)
               OR ISNULL(i.IsLast, 0) <> ISNULL(d.IsLast, 0)
               OR ISNULL(CAST(i.CreationDate AS VARCHAR), '') <> ISNULL(CAST(d.CreationDate AS VARCHAR), '')
           )
    )
    RETURN;

    -- Just store IDs - NO JSON building
    -- Queue processor will fetch data and build JSON asynchronously
    INSERT INTO SyncQueue (TableName, RecordID, Operation, Status, CreatedAt)
    SELECT
        'aligner_batches',
        i.AlignerBatchID,
        CASE WHEN d.AlignerBatchID IS NULL THEN 'INSERT' ELSE 'UPDATE' END,
        'pending',
        GETDATE()
    FROM inserted i
    LEFT JOIN deleted d ON i.AlignerBatchID = d.AlignerBatchID;

    -- Note: JsonData = NULL, queue processor will populate it
END
GO

PRINT 'Created trg_sync_tblAlignerBatches with DELETE support';
GO

-- ============================================
-- Step 3: Verify trigger events
-- ============================================

SELECT
    t.name AS TriggerName,
    te.type_desc AS EventType
FROM sys.triggers t
JOIN sys.trigger_events te ON t.object_id = te.object_id
WHERE t.parent_id = OBJECT_ID('tblAlignerBatches')
ORDER BY te.type_desc;
GO

PRINT 'Migration complete: trg_sync_tblAlignerBatches now handles INSERT, UPDATE, and DELETE operations';
GO
