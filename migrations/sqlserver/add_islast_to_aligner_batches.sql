-- =============================================
-- Add IsLast field to tblAlignerBatches
-- =============================================
-- Purpose: Track the final batch in an aligner set
-- When IsLast=1, indicates treatment is nearing completion
-- (before new scan or treatment finish)
-- =============================================

USE [ShwanNew]
GO

PRINT '';
PRINT '========================================';
PRINT 'Adding IsLast column to tblAlignerBatches';
PRINT '========================================';
PRINT '';

-- Add IsLast column with default value of 0 (false)
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.tblAlignerBatches')
    AND name = 'IsLast'
)
BEGIN
    ALTER TABLE dbo.tblAlignerBatches
    ADD IsLast BIT NOT NULL DEFAULT 0;

    PRINT 'IsLast column added successfully';
END
ELSE
BEGIN
    PRINT 'IsLast column already exists - skipping';
END
GO

-- Create filtered index for efficient queries on IsLast=1
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_tblAlignerBatches_IsLast'
    AND object_id = OBJECT_ID('dbo.tblAlignerBatches')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_tblAlignerBatches_IsLast
    ON dbo.tblAlignerBatches(AlignerSetID, IsLast)
    WHERE IsLast = 1;

    PRINT 'Index IX_tblAlignerBatches_IsLast created successfully';
END
ELSE
BEGIN
    PRINT 'Index IX_tblAlignerBatches_IsLast already exists - skipping';
END
GO

PRINT '';
PRINT 'IsLast column migration complete';
PRINT '';
GO
