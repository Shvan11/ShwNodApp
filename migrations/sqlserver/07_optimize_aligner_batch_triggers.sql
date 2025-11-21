/**
 * Migration: Optimize Aligner Batch Triggers
 *
 * Problem: INSERT operations on tblAlignerBatches timeout due to multiple cascading triggers
 * with expensive correlated subqueries and complex joins.
 *
 * Solution:
 * 1. Add indexes to support trigger queries
 * 2. Optimize trg_AlignerBatches_SetAlignerSequences with window functions
 * 3. Add performance monitoring
 */

-- =============================================================================
-- STEP 1: Add indexes to support trigger performance
-- =============================================================================

-- Index for foreign key join (supports validation and sync triggers)
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID('tblAlignerBatches')
    AND name = 'IX_tblAlignerBatches_AlignerSetID'
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_tblAlignerBatches_AlignerSetID
    ON dbo.tblAlignerBatches (AlignerSetID)
    INCLUDE (UpperAlignerCount, LowerAlignerCount, ManufactureDate, AlignerBatchID);
    PRINT 'Created index: IX_tblAlignerBatches_AlignerSetID';
END
ELSE
BEGIN
    PRINT 'Index IX_tblAlignerBatches_AlignerSetID already exists';
END
GO

-- Index for sequence calculation (supports SetAlignerSequences trigger)
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID('tblAlignerBatches')
    AND name = 'IX_tblAlignerBatches_SetID_MfgDate_BatchID'
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_tblAlignerBatches_SetID_MfgDate_BatchID
    ON dbo.tblAlignerBatches (AlignerSetID, ManufactureDate, AlignerBatchID)
    INCLUDE (UpperAlignerCount, LowerAlignerCount, UpperAlignerStartSequence, LowerAlignerStartSequence);
    PRINT 'Created index: IX_tblAlignerBatches_SetID_MfgDate_BatchID';
END
ELSE
BEGIN
    PRINT 'Index IX_tblAlignerBatches_SetID_MfgDate_BatchID already exists';
END
GO

-- =============================================================================
-- STEP 2: Optimize SetAlignerSequences trigger with window functions
-- =============================================================================

-- Drop existing trigger
IF OBJECT_ID('dbo.trg_AlignerBatches_SetAlignerSequences', 'TR') IS NOT NULL
BEGIN
    DROP TRIGGER dbo.trg_AlignerBatches_SetAlignerSequences;
    PRINT 'Dropped old trigger: trg_AlignerBatches_SetAlignerSequences';
END
GO

-- Create optimized trigger using window functions (much faster than correlated subqueries)
CREATE TRIGGER dbo.trg_AlignerBatches_SetAlignerSequences
ON dbo.tblAlignerBatches
AFTER INSERT
AS
BEGIN
    SET NOCOUNT ON;

    -- Use window functions instead of correlated subqueries for better performance
    -- Note: UpperAlignerEndSequence and LowerAlignerEndSequence are computed columns
    WITH OrderedBatches AS (
        SELECT
            b.AlignerBatchID,
            b.AlignerSetID,
            b.UpperAlignerCount,
            b.LowerAlignerCount,
            b.ManufactureDate,
            -- Use window function to calculate cumulative sum up to previous row
            ISNULL(SUM(b.UpperAlignerCount) OVER (
                PARTITION BY b.AlignerSetID
                ORDER BY b.ManufactureDate, b.AlignerBatchID
                ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
            ), 0) AS PrevUpperCount,
            ISNULL(SUM(b.LowerAlignerCount) OVER (
                PARTITION BY b.AlignerSetID
                ORDER BY b.ManufactureDate, b.AlignerBatchID
                ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
            ), 0) AS PrevLowerCount
        FROM dbo.tblAlignerBatches b
        WHERE b.AlignerSetID IN (SELECT DISTINCT AlignerSetID FROM inserted)
    )
    UPDATE b
    SET
        UpperAlignerStartSequence = CASE
            WHEN o.UpperAlignerCount > 0
            THEN o.PrevUpperCount + 1
            ELSE NULL
        END,
        LowerAlignerStartSequence = CASE
            WHEN o.LowerAlignerCount > 0
            THEN o.PrevLowerCount + 1
            ELSE NULL
        END
    FROM dbo.tblAlignerBatches b
    INNER JOIN OrderedBatches o ON b.AlignerBatchID = o.AlignerBatchID
    WHERE EXISTS (SELECT 1 FROM inserted i WHERE i.AlignerBatchID = b.AlignerBatchID);
END
GO

PRINT 'Created optimized trigger: trg_AlignerBatches_SetAlignerSequences';
GO

-- =============================================================================
-- STEP 3: Add performance monitoring view
-- =============================================================================

IF OBJECT_ID('vw_TriggerPerformance', 'V') IS NOT NULL
BEGIN
    DROP VIEW vw_TriggerPerformance;
END
GO

CREATE VIEW vw_TriggerPerformance AS
SELECT
    OBJECT_NAME(s.object_id) AS TriggerName,
    OBJECT_NAME(p.object_id) AS TableName,
    s.execution_count,
    s.total_worker_time / 1000 AS total_worker_time_ms,
    s.total_elapsed_time / 1000 AS total_elapsed_time_ms,
    (s.total_worker_time / s.execution_count) / 1000 AS avg_worker_time_ms,
    (s.total_elapsed_time / s.execution_count) / 1000 AS avg_elapsed_time_ms,
    s.last_execution_time
FROM sys.dm_exec_trigger_stats s
INNER JOIN sys.triggers t ON s.object_id = t.object_id
INNER JOIN sys.objects p ON t.parent_id = p.object_id
WHERE OBJECT_NAME(p.object_id) = 'tblAlignerBatches';
GO

PRINT 'Created performance monitoring view: vw_TriggerPerformance';
GO

-- =============================================================================
-- STEP 4: Update statistics for optimal query plans
-- =============================================================================

UPDATE STATISTICS dbo.tblAlignerBatches WITH FULLSCAN;
UPDATE STATISTICS dbo.tblAlignerSets WITH FULLSCAN;
PRINT 'Updated table statistics';
GO

PRINT '';
PRINT '========================================';
PRINT 'Migration completed successfully!';
PRINT '';
PRINT 'Changes made:';
PRINT '1. Added two indexes to tblAlignerBatches';
PRINT '2. Optimized trg_AlignerBatches_SetAlignerSequences trigger';
PRINT '3. Created vw_TriggerPerformance monitoring view';
PRINT '4. Updated table statistics';
PRINT '';
PRINT 'Monitor performance with:';
PRINT 'SELECT * FROM vw_TriggerPerformance ORDER BY avg_elapsed_time_ms DESC';
PRINT '========================================';
GO
