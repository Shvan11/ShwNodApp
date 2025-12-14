-- =============================================
-- Add CreationDate to tblAlignerBatches
-- =============================================
-- Purpose: Track when batches are created in the system
-- This enables the three-stage workflow:
--   1. Pending Manufacturing (has CreationDate, no ManufactureDate)
--   2. Pending Delivery (has ManufactureDate, no DeliveredToPatientDate)
--   3. Delivered (has DeliveredToPatientDate)
-- =============================================

USE [ShwanNew]
GO

PRINT '';
PRINT '========================================';
PRINT 'Adding CreationDate to tblAlignerBatches';
PRINT '========================================';
PRINT '';

-- =============================================
-- STEP 1: Check if column already exists
-- =============================================

IF NOT EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'tblAlignerBatches'
    AND COLUMN_NAME = 'CreationDate'
)
BEGIN
    -- Add CreationDate column with default GETDATE()
    ALTER TABLE dbo.tblAlignerBatches
    ADD CreationDate DATETIME NOT NULL
    CONSTRAINT DF_tblAlignerBatches_CreationDate DEFAULT GETDATE();

    PRINT '  Added CreationDate column';
END
ELSE
BEGIN
    PRINT '  CreationDate column already exists - skipping';
END
GO

-- =============================================
-- STEP 2: Backfill existing batches
-- =============================================
-- Set CreationDate = ManufactureDate for existing records
-- If ManufactureDate is NULL, use current date

PRINT '';
PRINT 'Backfilling existing batches...';

UPDATE dbo.tblAlignerBatches
SET CreationDate = ISNULL(ManufactureDate, GETDATE())
WHERE CreationDate = (SELECT CONSTRAINT_DEFINITION
                       FROM INFORMATION_SCHEMA.CHECK_CONSTRAINTS
                       WHERE CONSTRAINT_NAME = 'DF_tblAlignerBatches_CreationDate')
   OR CreationDate IS NULL;

-- Alternative backfill for records where CreationDate defaulted to current time
-- but ManufactureDate has a different (earlier) value
UPDATE dbo.tblAlignerBatches
SET CreationDate = ManufactureDate
WHERE ManufactureDate IS NOT NULL
  AND ManufactureDate < CreationDate;

PRINT '  Backfilled ' + CAST(@@ROWCOUNT AS VARCHAR) + ' records';
GO

-- =============================================
-- STEP 3: Create index for efficient queries
-- =============================================

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'IX_tblAlignerBatches_CreationDate'
    AND object_id = OBJECT_ID('dbo.tblAlignerBatches')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_tblAlignerBatches_CreationDate
    ON dbo.tblAlignerBatches(CreationDate);

    PRINT '  Created index IX_tblAlignerBatches_CreationDate';
END
ELSE
BEGIN
    PRINT '  Index IX_tblAlignerBatches_CreationDate already exists - skipping';
END
GO

-- =============================================
-- STEP 4: Create index for pending manufacture queries
-- =============================================
-- Filtered index for efficient lookup of batches pending manufacture

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'IX_tblAlignerBatches_PendingManufacture'
    AND object_id = OBJECT_ID('dbo.tblAlignerBatches')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_tblAlignerBatches_PendingManufacture
    ON dbo.tblAlignerBatches(AlignerSetID, CreationDate)
    WHERE ManufactureDate IS NULL;

    PRINT '  Created filtered index IX_tblAlignerBatches_PendingManufacture';
END
ELSE
BEGIN
    PRINT '  Index IX_tblAlignerBatches_PendingManufacture already exists - skipping';
END
GO

-- =============================================
-- Summary
-- =============================================

PRINT '';
PRINT '========================================';
PRINT 'Migration Complete!';
PRINT '========================================';
PRINT '';
PRINT 'Summary:';
PRINT '  - Added CreationDate column (DATETIME, NOT NULL, DEFAULT GETDATE())';
PRINT '  - Backfilled existing batches with ManufactureDate or current date';
PRINT '  - Created index for CreationDate queries';
PRINT '  - Created filtered index for pending manufacture queries';
PRINT '';
PRINT 'Next Steps:';
PRINT '  1. Update stored procedures to make ManufactureDate optional';
PRINT '  2. Update v_allsets view to include CreationDate and BatchStatus';
PRINT '  3. Update sync trigger to track CreationDate changes';
PRINT '';
GO
