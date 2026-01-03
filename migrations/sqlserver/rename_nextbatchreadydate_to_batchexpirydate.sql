-- Migration: Rename NextBatchReadyDate to BatchExpiryDate
-- Purpose: Clarify that this column represents when THIS batch expires, not when next is ready
-- Also updates v_allsets to calculate NextDueDate from latest DELIVERED batch

SET QUOTED_IDENTIFIER ON;
GO

-- ============================================
-- Step 1: Rename computed column on tblAlignerBatches
-- ============================================

-- Drop the old computed columns
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('tblAlignerBatches') AND name = 'NextBatchReadyDate')
BEGIN
    ALTER TABLE tblAlignerBatches DROP COLUMN NextBatchReadyDate;
    PRINT 'Dropped NextBatchReadyDate column';
END
GO

-- Create the new BatchExpiryDate computed column (same formula, better name)
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('tblAlignerBatches') AND name = 'BatchExpiryDate')
BEGIN
    ALTER TABLE tblAlignerBatches ADD BatchExpiryDate AS (
        DATEADD(DAY,
            CASE
                WHEN [Days] IS NULL THEN NULL
                WHEN [UpperAlignerCount] >= [LowerAlignerCount] THEN [UpperAlignerCount] * [Days]
                ELSE [LowerAlignerCount] * [Days]
            END,
            [DeliveredToPatientDate]
        )
    );
    PRINT 'Created BatchExpiryDate computed column';
END
GO

-- ============================================
-- Step 2: Update v_allsets view
-- ============================================

IF OBJECT_ID('dbo.v_allsets', 'V') IS NOT NULL
    DROP VIEW dbo.v_allsets;
GO

CREATE VIEW dbo.v_allsets AS
SELECT
    dbo.tblpatients.PatientName,
    dbo.tblAlignerSets.AlignerSetID,
    dbo.tblAlignerSets.SetSequence,
    dbo.tblAlignerSets.CreationDate,
    dbo.tblAlignerSets.IsActive AS SetIsActive,
    lb.AlignerBatchID,
    lb.BatchSequence,
    lb.CreationDate AS BatchCreationDate,
    lb.ManufactureDate,
    lb.DeliveredToPatientDate,
    lb.BatchExpiryDate,
    lb.Notes,
    lb.IsLast,
    -- NextDueDate: Based on the latest DELIVERED batch's expiry date
    (SELECT TOP 1 b.BatchExpiryDate
     FROM dbo.tblAlignerBatches b
     WHERE b.AlignerSetID = dbo.tblAlignerSets.AlignerSetID
       AND b.DeliveredToPatientDate IS NOT NULL
     ORDER BY b.BatchSequence DESC
    ) AS NextDueDate,
    -- NextBatchPresent: Is there a manufactured batch waiting to be delivered?
    CASE
        WHEN EXISTS (
            SELECT 1
            FROM dbo.tblAlignerBatches ReadyBatch
            WHERE ReadyBatch.AlignerSetID = dbo.tblAlignerSets.AlignerSetID
              AND ReadyBatch.ManufactureDate IS NOT NULL
              AND ReadyBatch.DeliveredToPatientDate IS NULL
              AND ReadyBatch.BatchSequence > ISNULL(
                  (SELECT MAX(b2.BatchSequence)
                   FROM dbo.tblAlignerBatches b2
                   WHERE b2.AlignerSetID = dbo.tblAlignerSets.AlignerSetID
                     AND b2.DeliveredToPatientDate IS NOT NULL), 0)
        ) THEN 'True'
        ELSE 'False'
    END AS NextBatchPresent,
    -- LabStatus: What's the current manufacturing status?
    CASE
        WHEN NOT EXISTS (
            SELECT 1
            FROM dbo.tblAlignerBatches b2
            WHERE b2.AlignerSetID = dbo.tblAlignerSets.AlignerSetID
        ) THEN 'no_batches'
        WHEN EXISTS (
            SELECT 1
            FROM dbo.tblAlignerBatches b2
            WHERE b2.AlignerSetID = dbo.tblAlignerSets.AlignerSetID
              AND b2.ManufactureDate IS NOT NULL
              AND b2.DeliveredToPatientDate IS NULL
        ) THEN 'in_lab'
        WHEN EXISTS (
            SELECT 1
            FROM dbo.tblAlignerBatches b2
            WHERE b2.AlignerSetID = dbo.tblAlignerSets.AlignerSetID
              AND b2.ManufactureDate IS NULL
        ) THEN 'needs_mfg'
        ELSE 'all_delivered'
    END AS LabStatus,
    dbo.tblAlignerSets.WorkID,
    dbo.tblAlignerSets.AlignerDrID,
    dbo.tblwork.PersonID
FROM dbo.tblpatients
INNER JOIN dbo.tblwork ON dbo.tblwork.PersonID = dbo.tblpatients.PersonID
INNER JOIN dbo.tblAlignerSets ON dbo.tblwork.workid = dbo.tblAlignerSets.WorkID
LEFT OUTER JOIN (
    SELECT
        AlignerSetID,
        AlignerBatchID,
        BatchSequence,
        CreationDate,
        ManufactureDate,
        DeliveredToPatientDate,
        BatchExpiryDate,
        Notes,
        IsLast,
        IsActive,
        ROW_NUMBER() OVER (
            PARTITION BY AlignerSetID
            ORDER BY CASE WHEN IsActive = 1 THEN 0 ELSE 1 END, BatchSequence DESC
        ) AS RowNum
    FROM dbo.tblAlignerBatches
) lb ON dbo.tblAlignerSets.AlignerSetID = lb.AlignerSetID AND lb.RowNum = 1
WHERE dbo.tblwork.Typeofwork = 19
   OR dbo.tblwork.Typeofwork = 20
   OR dbo.tblwork.Typeofwork = 21;
GO

PRINT 'Updated v_allsets view with NextDueDate calculation';
GO

-- ============================================
-- Step 3: Update sync trigger for new column name
-- ============================================

IF OBJECT_ID('dbo.trg_sync_tblAlignerBatches', 'TR') IS NOT NULL
    DROP TRIGGER dbo.trg_sync_tblAlignerBatches;
GO

CREATE TRIGGER dbo.trg_sync_tblAlignerBatches
ON dbo.tblAlignerBatches
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

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
           )
    )
    RETURN;

    -- Just store IDs - queue processor will fetch data and build JSON asynchronously
    INSERT INTO SyncQueue (TableName, RecordID, Operation, Status)
    SELECT
        'aligner_batches',
        i.AlignerBatchID,
        CASE WHEN d.AlignerBatchID IS NULL THEN 'INSERT' ELSE 'UPDATE' END,
        'pending'
    FROM inserted i
    LEFT JOIN deleted d ON i.AlignerBatchID = d.AlignerBatchID;
END
GO

PRINT 'Updated trg_sync_tblAlignerBatches trigger';
GO

-- ============================================
-- Step 4: Update trg_AlignerSets_UpdateBatchDays trigger
-- ============================================

IF OBJECT_ID('dbo.trg_AlignerSets_UpdateBatchDays', 'TR') IS NOT NULL
    DROP TRIGGER dbo.trg_AlignerSets_UpdateBatchDays;
GO

CREATE TRIGGER [dbo].[trg_AlignerSets_UpdateBatchDays]
ON [dbo].[tblAlignerSets]
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    -- Only proceed if Days column was actually changed
    IF NOT UPDATE(Days)
    BEGIN
        RETURN; -- Days wasn't updated, exit early
    END

    -- Check if Days value actually changed
    IF NOT EXISTS (
        SELECT 1
        FROM inserted i
        INNER JOIN deleted d ON i.AlignerSetID = d.AlignerSetID
        WHERE ISNULL(i.Days, 0) <> ISNULL(d.Days, 0)
    )
    BEGIN
        RETURN; -- Days value didn't actually change, exit early
    END

    -- Update Days for all non-expired batches
    -- A batch is considered "not expired" if:
    -- 1. It has no DeliveredToPatientDate (not yet delivered), OR
    -- 2. BatchExpiryDate is in the future or today (still active/valid)
    UPDATE b
    SET b.Days = i.Days
    FROM [dbo].[tblAlignerBatches] b
    INNER JOIN inserted i ON b.AlignerSetID = i.AlignerSetID
    WHERE
        -- Batch is not yet delivered
        b.DeliveredToPatientDate IS NULL
        OR
        -- Batch is delivered but not expired yet
        (
            b.DeliveredToPatientDate IS NOT NULL
            AND b.BatchExpiryDate >= CAST(GETDATE() AS DATE)
        )

    -- Log the number of batches updated
    DECLARE @UpdatedCount INT = @@ROWCOUNT;

    IF @UpdatedCount > 0
    BEGIN
        PRINT 'Updated Days value for ' + CAST(@UpdatedCount AS VARCHAR(10)) + ' non-expired batch(es)';
    END
END
GO

PRINT 'Updated trg_AlignerSets_UpdateBatchDays trigger';
GO

PRINT 'Migration complete: NextBatchReadyDate renamed to BatchExpiryDate';
GO
