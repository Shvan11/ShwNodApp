-- ============================================
-- Migration: Create Aligner Set Cost Sync Trigger
-- Description: Keeps tblWork.TotalRequired in sync with SUM(tblAlignerSets.SetCost)
-- Date: 2025-12-11
-- ============================================

-- Drop if exists
IF EXISTS (SELECT * FROM sys.triggers WHERE name = 'trg_AlignerSets_UpdateWorkTotal')
BEGIN
    DROP TRIGGER trg_AlignerSets_UpdateWorkTotal;
    PRINT 'Dropped existing trigger trg_AlignerSets_UpdateWorkTotal';
END
GO

-- Create the sync trigger
CREATE TRIGGER trg_AlignerSets_UpdateWorkTotal
ON tblAlignerSets
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    -- Handle INSERT and UPDATE
    IF EXISTS (SELECT * FROM inserted)
    BEGIN
        UPDATE w SET
            TotalRequired = ISNULL((SELECT SUM(SetCost) FROM tblAlignerSets WHERE WorkID = w.workid), 0),
            Currency = ISNULL((SELECT TOP 1 Currency FROM tblAlignerSets WHERE WorkID = w.workid AND Currency IS NOT NULL), w.Currency)
        FROM tblWork w
        WHERE w.workid IN (SELECT DISTINCT WorkID FROM inserted WHERE WorkID IS NOT NULL);
    END

    -- Handle DELETE
    IF EXISTS (SELECT * FROM deleted) AND NOT EXISTS (SELECT * FROM inserted)
    BEGIN
        UPDATE w SET
            TotalRequired = ISNULL((SELECT SUM(SetCost) FROM tblAlignerSets WHERE WorkID = w.workid), 0),
            Currency = ISNULL((SELECT TOP 1 Currency FROM tblAlignerSets WHERE WorkID = w.workid AND Currency IS NOT NULL), w.Currency)
        FROM tblWork w
        WHERE w.workid IN (SELECT DISTINCT WorkID FROM deleted WHERE WorkID IS NOT NULL);
    END
END
GO

PRINT 'Created trigger trg_AlignerSets_UpdateWorkTotal';
GO
