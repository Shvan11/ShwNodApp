-- =============================================
-- Update V_AllSets view
-- - Remove unused BatchStatus column
-- =============================================

USE [ShwanNew]
GO

SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

IF OBJECT_ID('dbo.V_AllSets', 'V') IS NOT NULL
    DROP VIEW dbo.V_AllSets;
GO

CREATE VIEW dbo.V_AllSets
AS
SELECT
    dbo.tblpatients.PatientName,
    dbo.tblAlignerSets.AlignerSetID,
    dbo.tblAlignerSets.SetSequence,
    dbo.tblAlignerSets.CreationDate,
    dbo.tblAlignerBatches.AlignerBatchID,
    dbo.tblAlignerBatches.BatchSequence,
    dbo.tblAlignerBatches.CreationDate AS BatchCreationDate,
    dbo.tblAlignerBatches.ManufactureDate,
    dbo.tblAlignerBatches.DeliveredToPatientDate,
    dbo.tblAlignerBatches.NextBatchReadyDate,
    dbo.tblAlignerBatches.Notes,
    dbo.tblAlignerBatches.IsLast,
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
LEFT OUTER JOIN dbo.tblAlignerBatches ON dbo.tblAlignerSets.AlignerSetID = dbo.tblAlignerBatches.AlignerSetID
    AND dbo.tblAlignerBatches.IsActive = 1
WHERE (dbo.tblwork.Typeofwork = 19 OR dbo.tblwork.Typeofwork = 20 OR dbo.tblwork.Typeofwork = 21)
    AND (dbo.tblAlignerSets.IsActive = 1);
GO
