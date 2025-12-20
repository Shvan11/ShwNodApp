-- Migration: Fix V_AllSets to show batch info even when no batch is active yet
-- Date: 2025-12-20
-- Issue: View only showed batches where IsActive=1, but batches can only be active
--        after delivery (CK_AlignerBatches_Active_Requires_Delivery constraint).
--        This left undelivered batches (including those marked as Final) invisible.
-- Fix: Show the most relevant batch per set (active first, then highest sequence)

DROP VIEW IF EXISTS dbo.V_AllSets;
GO

CREATE VIEW dbo.V_AllSets
AS
SELECT
    dbo.tblpatients.PatientName,
    dbo.tblAlignerSets.AlignerSetID,
    dbo.tblAlignerSets.SetSequence,
    dbo.tblAlignerSets.CreationDate,
    lb.AlignerBatchID,
    lb.BatchSequence,
    lb.CreationDate AS BatchCreationDate,
    lb.ManufactureDate,
    lb.DeliveredToPatientDate,
    lb.NextBatchReadyDate,
    lb.Notes,
    lb.IsLast,
    -- NextBatchPresent: True if any manufactured-but-undelivered batch is NEWER than the current (last delivered)
    CASE WHEN EXISTS (
        SELECT 1
        FROM dbo.tblAlignerBatches ReadyBatch
        WHERE ReadyBatch.AlignerSetID = dbo.tblAlignerSets.AlignerSetID
        AND ReadyBatch.ManufactureDate IS NOT NULL
        AND ReadyBatch.DeliveredToPatientDate IS NULL
        AND ReadyBatch.BatchSequence > ISNULL(
            (SELECT MAX(b2.BatchSequence)
             FROM dbo.tblAlignerBatches b2
             WHERE b2.AlignerSetID = dbo.tblAlignerSets.AlignerSetID
             AND b2.DeliveredToPatientDate IS NOT NULL),
            0)
    ) THEN 'True' ELSE 'False' END AS NextBatchPresent,
    -- LabStatus
    CASE
        WHEN NOT EXISTS (
            SELECT 1 FROM dbo.tblAlignerBatches b2
            WHERE b2.AlignerSetID = dbo.tblAlignerSets.AlignerSetID
        ) THEN 'no_batches'
        WHEN EXISTS (
            SELECT 1 FROM dbo.tblAlignerBatches b2
            WHERE b2.AlignerSetID = dbo.tblAlignerSets.AlignerSetID
            AND b2.ManufactureDate IS NOT NULL
            AND b2.DeliveredToPatientDate IS NULL
        ) THEN 'in_lab'
        WHEN EXISTS (
            SELECT 1 FROM dbo.tblAlignerBatches b2
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
    -- Get the most relevant batch for each set:
    -- 1. Active batch first (if exists) - the one patient is currently using
    -- 2. Otherwise, highest batch sequence (most recent batch)
    SELECT
        AlignerSetID,
        AlignerBatchID,
        BatchSequence,
        CreationDate,
        ManufactureDate,
        DeliveredToPatientDate,
        NextBatchReadyDate,
        Notes,
        IsLast,
        IsActive,
        ROW_NUMBER() OVER (
            PARTITION BY AlignerSetID
            ORDER BY
                CASE WHEN IsActive = 1 THEN 0 ELSE 1 END,
                BatchSequence DESC
        ) AS RowNum
    FROM dbo.tblAlignerBatches
) lb ON dbo.tblAlignerSets.AlignerSetID = lb.AlignerSetID AND lb.RowNum = 1
WHERE (dbo.tblwork.Typeofwork = 19 OR dbo.tblwork.Typeofwork = 20 OR dbo.tblwork.Typeofwork = 21)
    AND (dbo.tblAlignerSets.IsActive = 1);
GO
