-- =============================================
-- Add SetVideo field to tblAlignerSets
-- Migration: 10_add_set_video_field.sql
-- Purpose: Add YouTube video URL field for case explanations
-- =============================================

PRINT 'Starting migration: Add SetVideo column to tblAlignerSets';
GO

-- Check if column already exists
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('tblAlignerSets')
    AND name = 'SetVideo'
)
BEGIN
    -- Add column
    ALTER TABLE tblAlignerSets
    ADD SetVideo NVARCHAR(2000) NULL;

    PRINT '✅ SetVideo column added to tblAlignerSets';
END
ELSE
BEGIN
    PRINT '⚠️  SetVideo column already exists, skipping';
END
GO

-- Add description
IF NOT EXISTS (
    SELECT 1 FROM sys.extended_properties
    WHERE major_id = OBJECT_ID('tblAlignerSets')
    AND minor_id = (SELECT column_id FROM sys.columns WHERE object_id = OBJECT_ID('tblAlignerSets') AND name = 'SetVideo')
    AND name = 'MS_Description'
)
BEGIN
    EXEC sp_addextendedproperty
        @name = N'MS_Description',
        @value = N'YouTube URL (unlisted) for case explanation video by Dr. Shwan',
        @level0type = N'SCHEMA', @level0name = N'dbo',
        @level1type = N'TABLE', @level1name = N'tblAlignerSets',
        @level2type = N'COLUMN', @level2name = N'SetVideo';

    PRINT '✅ Column description added';
END
GO

PRINT '✅ Migration complete: SetVideo field added';
PRINT '';
PRINT 'Next step: Run migration 11 to update the sync trigger';
GO
