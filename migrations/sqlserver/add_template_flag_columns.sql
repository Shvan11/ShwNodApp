-- =============================================
-- Add HasUpperTemplate / HasLowerTemplate flag columns to tblAlignerBatches
-- =============================================
-- PURPOSE: Make template presence an explicit flag rather than inferring
--          it from UpperAlignerStartSequence = 0. Required so that batches
--          that include a template (slot 0) do not consume a "real aligner"
--          slot from the set's remaining count.
--
-- SEMANTICS AFTER THIS MIGRATION:
--   - UpperAlignerCount / LowerAlignerCount: total slots in the batch
--     (continues to include the template slot when HasTemplate = 1)
--   - HasUpperTemplate / HasLowerTemplate: 1 when slot 0 of the batch is
--     a template (not a real aligner)
--   - Real aligners consumed per batch = Count - IIF(HasTemplate = 1, 1, 0)
--   - Only the first batch in a set can have HasTemplate = 1 (enforced in SPs)
--
-- HISTORICAL DATA:
--   - Flag is backfilled from StartSequence = 0
--   - Counts, Start/End sequences and RemainingUpperAligners/LowerAligners
--     on tblAlignerSets are NOT modified. Some historical sets will have
--     Remaining values that are off by 1 per previously-templated batch;
--     these are corrected manually by the user on a case-by-case basis.
-- =============================================

USE ShwanNew;
GO

-- -----------------------------------------------------------------
-- STEP 1: Add columns (idempotent)
-- -----------------------------------------------------------------
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.tblAlignerBatches') AND name = 'HasUpperTemplate'
)
BEGIN
    ALTER TABLE dbo.tblAlignerBatches
    ADD HasUpperTemplate BIT NOT NULL CONSTRAINT DF_tblAlignerBatches_HasUpperTemplate DEFAULT 0;
    PRINT 'Added HasUpperTemplate column';
END
ELSE
    PRINT 'HasUpperTemplate column already exists';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.tblAlignerBatches') AND name = 'HasLowerTemplate'
)
BEGIN
    ALTER TABLE dbo.tblAlignerBatches
    ADD HasLowerTemplate BIT NOT NULL CONSTRAINT DF_tblAlignerBatches_HasLowerTemplate DEFAULT 0;
    PRINT 'Added HasLowerTemplate column';
END
ELSE
    PRINT 'HasLowerTemplate column already exists';
GO

-- -----------------------------------------------------------------
-- STEP 2: Backfill flags from StartSequence = 0 (idempotent)
-- -----------------------------------------------------------------
UPDATE dbo.tblAlignerBatches
SET HasUpperTemplate = CASE WHEN UpperAlignerStartSequence = 0 THEN 1 ELSE 0 END,
    HasLowerTemplate = CASE WHEN LowerAlignerStartSequence = 0 THEN 1 ELSE 0 END
WHERE HasUpperTemplate <> CASE WHEN UpperAlignerStartSequence = 0 THEN 1 ELSE 0 END
   OR HasLowerTemplate <> CASE WHEN LowerAlignerStartSequence = 0 THEN 1 ELSE 0 END;

PRINT CONCAT('Backfilled ', @@ROWCOUNT, ' batch row(s)');
GO

-- -----------------------------------------------------------------
-- STEP 3: Verification
-- -----------------------------------------------------------------
SELECT
    COUNT(*) AS TotalBatches,
    SUM(CASE WHEN HasUpperTemplate = 1 THEN 1 ELSE 0 END) AS BatchesWithUpperTemplate,
    SUM(CASE WHEN HasLowerTemplate = 1 THEN 1 ELSE 0 END) AS BatchesWithLowerTemplate,
    SUM(CASE WHEN HasUpperTemplate = 1 AND UpperAlignerStartSequence <> 0 THEN 1 ELSE 0 END) AS UpperFlagMismatch,
    SUM(CASE WHEN HasLowerTemplate = 1 AND LowerAlignerStartSequence <> 0 THEN 1 ELSE 0 END) AS LowerFlagMismatch
FROM dbo.tblAlignerBatches;
-- Expected: UpperFlagMismatch = 0 AND LowerFlagMismatch = 0
GO
