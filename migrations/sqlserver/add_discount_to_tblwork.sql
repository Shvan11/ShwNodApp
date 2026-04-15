-- Migration: Add Discount fields to tblwork
-- Created: 2026-04-15
-- Description: Adds Discount (amount in work currency), DiscountDate, and
--              DiscountReason columns. Discount is a post-creation concession
--              applied by admin only. DiscountReason is an optional free-text
--              note editable by any authenticated user.
--
-- Effective amount owed = TotalRequired - ISNULL(Discount, 0)
-- Remaining balance     = TotalRequired - ISNULL(Discount, 0) - TotalPaid

-- ============================================================================
-- Add Discount column (same currency as work, stored as positive INT)
-- ============================================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.tblwork') AND name = 'Discount'
)
BEGIN
    ALTER TABLE dbo.tblwork ADD Discount INT NULL;
    PRINT '✅ Added Discount column to tblwork';
END
ELSE
    PRINT 'ℹ️  Discount column already exists on tblwork';
GO

-- ============================================================================
-- Add DiscountDate column (date the discount was granted)
-- ============================================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.tblwork') AND name = 'DiscountDate'
)
BEGIN
    ALTER TABLE dbo.tblwork ADD DiscountDate DATE NULL;
    PRINT '✅ Added DiscountDate column to tblwork';
END
ELSE
    PRINT 'ℹ️  DiscountDate column already exists on tblwork';
GO

-- ============================================================================
-- Add DiscountReason column (optional free-text, editable by any user)
-- ============================================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.tblwork') AND name = 'DiscountReason'
)
BEGIN
    ALTER TABLE dbo.tblwork ADD DiscountReason NVARCHAR(500) NULL;
    PRINT '✅ Added DiscountReason column to tblwork';
END
ELSE
    PRINT 'ℹ️  DiscountReason column already exists on tblwork';
GO

-- ============================================================================
-- Extended properties (documentation)
-- ============================================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.extended_properties
    WHERE major_id = OBJECT_ID('dbo.tblwork')
      AND minor_id = COLUMNPROPERTY(OBJECT_ID('dbo.tblwork'), 'Discount', 'ColumnId')
      AND name = 'MS_Description'
)
    EXEC sp_addextendedproperty
        @name = N'MS_Description',
        @value = N'Discount amount applied to work, in same currency as work. NULL/0 = no discount.',
        @level0type = N'SCHEMA', @level0name = N'dbo',
        @level1type = N'TABLE',  @level1name = N'tblwork',
        @level2type = N'COLUMN', @level2name = N'Discount';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.extended_properties
    WHERE major_id = OBJECT_ID('dbo.tblwork')
      AND minor_id = COLUMNPROPERTY(OBJECT_ID('dbo.tblwork'), 'DiscountDate', 'ColumnId')
      AND name = 'MS_Description'
)
    EXEC sp_addextendedproperty
        @name = N'MS_Description',
        @value = N'Date the discount was granted.',
        @level0type = N'SCHEMA', @level0name = N'dbo',
        @level1type = N'TABLE',  @level1name = N'tblwork',
        @level2type = N'COLUMN', @level2name = N'DiscountDate';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.extended_properties
    WHERE major_id = OBJECT_ID('dbo.tblwork')
      AND minor_id = COLUMNPROPERTY(OBJECT_ID('dbo.tblwork'), 'DiscountReason', 'ColumnId')
      AND name = 'MS_Description'
)
    EXEC sp_addextendedproperty
        @name = N'MS_Description',
        @value = N'Optional internal note explaining why the discount was granted. Not shown on receipt.',
        @level0type = N'SCHEMA', @level0name = N'dbo',
        @level1type = N'TABLE',  @level1name = N'tblwork',
        @level2type = N'COLUMN', @level2name = N'DiscountReason';
GO

-- ============================================================================
-- Verification (optional)
-- ============================================================================
-- SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
-- FROM INFORMATION_SCHEMA.COLUMNS
-- WHERE TABLE_NAME = 'tblwork' AND COLUMN_NAME IN ('Discount', 'DiscountDate', 'DiscountReason');
