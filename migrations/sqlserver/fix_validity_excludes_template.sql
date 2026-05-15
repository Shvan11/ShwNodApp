-- =============================================
-- Migration: Exclude template slot from ValidityPeriod / BatchExpiryDate
-- =============================================
-- BUG: The computed columns ValidityPeriod and BatchExpiryDate on
--      tblAlignerBatches use UpperAlignerCount / LowerAlignerCount directly,
--      ignoring HasUpperTemplate / HasLowerTemplate. A first batch that
--      includes a template (slot 0) over-counts validity by one aligner's
--      worth of days when the templated side is the dominant (larger) side.
--
-- FIX:  Real aligners per side = Count - IIF(HasTemplate = 1, 1, 0).
--       The dominant side determines validity, so the formula becomes:
--         max(UpperReal, LowerReal) * Days
--       (with NULL handling preserved from the original formulas).
--
-- COMPANION SEMANTICS (already enforced in usp_CreateAlignerBatch /
-- usp_UpdateAlignerBatch — see update_aligner_batch_sps_template_flag.sql):
--   - HasTemplate = 1 is only valid on the first batch in a set.
--   - Count must be >= 1 when HasTemplate = 1.
--   So the (Count - flag) expression is always >= 0 for valid rows.
--
-- POST-MIGRATION:
--   - Computed columns recompute on read, so existing rows pick up the new
--     formula immediately. No data update required.
--   - Supabase mirror copies persisted ValidityPeriod / BatchExpiryDate
--     values. The sync trigger fires on UPDATE to underlying columns only,
--     so we explicitly enqueue affected rows in SyncQueue for resync.
-- =============================================

USE ShwanNew;
GO

SET QUOTED_IDENTIFIER ON;
GO

-- -----------------------------------------------------------------
-- STEP 1: Drop existing computed columns (idempotent)
-- -----------------------------------------------------------------
IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.tblAlignerBatches') AND name = 'BatchExpiryDate'
)
BEGIN
    ALTER TABLE dbo.tblAlignerBatches DROP COLUMN BatchExpiryDate;
    PRINT 'Dropped BatchExpiryDate';
END
GO

IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.tblAlignerBatches') AND name = 'ValidityPeriod'
)
BEGIN
    ALTER TABLE dbo.tblAlignerBatches DROP COLUMN ValidityPeriod;
    PRINT 'Dropped ValidityPeriod';
END
GO

-- -----------------------------------------------------------------
-- STEP 2: Add new computed columns with template-aware formula
-- -----------------------------------------------------------------
ALTER TABLE dbo.tblAlignerBatches
ADD ValidityPeriod AS (
    CASE
        WHEN [Days] IS NULL THEN NULL
        WHEN ([UpperAlignerCount] - CASE WHEN [HasUpperTemplate] = 1 THEN 1 ELSE 0 END)
           >= ([LowerAlignerCount] - CASE WHEN [HasLowerTemplate] = 1 THEN 1 ELSE 0 END)
        THEN ([UpperAlignerCount] - CASE WHEN [HasUpperTemplate] = 1 THEN 1 ELSE 0 END) * [Days]
        ELSE ([LowerAlignerCount] - CASE WHEN [HasLowerTemplate] = 1 THEN 1 ELSE 0 END) * [Days]
    END
);
GO
PRINT 'Added ValidityPeriod (template-aware)';
GO

ALTER TABLE dbo.tblAlignerBatches
ADD BatchExpiryDate AS (
    DATEADD(DAY,
        CASE
            WHEN [Days] IS NULL THEN NULL
            WHEN ([UpperAlignerCount] - CASE WHEN [HasUpperTemplate] = 1 THEN 1 ELSE 0 END)
               >= ([LowerAlignerCount] - CASE WHEN [HasLowerTemplate] = 1 THEN 1 ELSE 0 END)
            THEN ([UpperAlignerCount] - CASE WHEN [HasUpperTemplate] = 1 THEN 1 ELSE 0 END) * [Days]
            ELSE ([LowerAlignerCount] - CASE WHEN [HasLowerTemplate] = 1 THEN 1 ELSE 0 END) * [Days]
        END,
        [DeliveredToPatientDate]
    )
);
GO
PRINT 'Added BatchExpiryDate (template-aware)';
GO

-- -----------------------------------------------------------------
-- STEP 3: Force Supabase resync for templated batches
--          (computed values changed but trigger does not fire on
--           pure computed-column shifts)
-- -----------------------------------------------------------------
INSERT INTO SyncQueue (TableName, RecordID, Operation, Status)
SELECT 'aligner_batches', AlignerBatchID, 'UPDATE', 'Pending'
FROM dbo.tblAlignerBatches
WHERE HasUpperTemplate = 1 OR HasLowerTemplate = 1;

DECLARE @Queued INT = @@ROWCOUNT;
PRINT CONCAT('Queued ', @Queued, ' templated batch(es) for Supabase resync');
GO

-- -----------------------------------------------------------------
-- STEP 4: Verification snapshot
-- -----------------------------------------------------------------
SELECT
    AlignerBatchID,
    AlignerSetID,
    UpperAlignerCount,
    LowerAlignerCount,
    HasUpperTemplate,
    HasLowerTemplate,
    Days,
    ValidityPeriod,
    DeliveredToPatientDate,
    BatchExpiryDate
FROM dbo.tblAlignerBatches
WHERE HasUpperTemplate = 1 OR HasLowerTemplate = 1
ORDER BY AlignerBatchID DESC;
GO

PRINT 'Migration complete: ValidityPeriod / BatchExpiryDate now exclude template slot';
GO
