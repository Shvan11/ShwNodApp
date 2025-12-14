-- =============================================
-- Fix V_AllSets view QUOTED_IDENTIFIER setting
-- =============================================
-- The view was created with QUOTED_IDENTIFIER OFF which causes
-- errors when updating tblAlignerBatches (which has persisted computed columns)
-- =============================================

USE [ShwanNew]
GO

SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- Drop and recreate the view with correct settings
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
    dbo.tblAlignerBatches.BatchSequence,
    dbo.tblAlignerBatches.CreationDate AS BatchCreationDate,
    dbo.tblAlignerBatches.ManufactureDate,
    dbo.tblAlignerBatches.DeliveredToPatientDate,
    dbo.tblAlignerBatches.NextBatchReadyDate,
    dbo.tblAlignerBatches.Notes,
    dbo.tblAlignerBatches.IsLast,
    CASE
        WHEN dbo.tblAlignerBatches.ManufactureDate IS NULL THEN 'pending_manufacture'
        WHEN dbo.tblAlignerBatches.DeliveredToPatientDate IS NULL THEN 'pending_delivery'
        ELSE 'delivered'
    END AS BatchStatus,
    CASE WHEN EXISTS (
        SELECT 1
        FROM dbo.tblAlignerBatches NextBatch
        WHERE NextBatch.AlignerSetID = dbo.tblAlignerBatches.AlignerSetID
        AND NextBatch.BatchSequence = dbo.tblAlignerBatches.BatchSequence + 1
        AND NextBatch.ManufactureDate IS NOT NULL
        AND NextBatch.DeliveredToPatientDate IS NULL
        AND (dbo.tblAlignerBatches.ManufactureDate IS NULL OR NextBatch.ManufactureDate > dbo.tblAlignerBatches.ManufactureDate)
    ) THEN 'True' ELSE 'False' END AS NextBatchPresent,
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

-- Verify the fix
SELECT
    OBJECT_NAME(object_id) as ViewName,
    uses_quoted_identifier
FROM sys.sql_modules
WHERE object_id = OBJECT_ID('V_AllSets');
GO

PRINT 'V_AllSets view recreated with QUOTED_IDENTIFIER ON';
GO
