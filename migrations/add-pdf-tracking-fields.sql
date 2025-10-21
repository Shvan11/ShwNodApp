-- Migration: Add PDF tracking fields to tblAlignerSets
-- Purpose: Track when PDFs are uploaded and who uploaded them

USE ShwanNew;
GO

-- Add PdfUploadedAt field if it doesn't exist
IF NOT EXISTS (
    SELECT * FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'tblAlignerSets'
    AND COLUMN_NAME = 'PdfUploadedAt'
)
BEGIN
    ALTER TABLE tblAlignerSets
    ADD PdfUploadedAt DATETIME NULL;
    PRINT 'Added PdfUploadedAt column to tblAlignerSets';
END
ELSE
BEGIN
    PRINT 'PdfUploadedAt column already exists';
END
GO

-- Add PdfUploadedBy field if it doesn't exist
IF NOT EXISTS (
    SELECT * FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'tblAlignerSets'
    AND COLUMN_NAME = 'PdfUploadedBy'
)
BEGIN
    ALTER TABLE tblAlignerSets
    ADD PdfUploadedBy NVARCHAR(255) NULL;
    PRINT 'Added PdfUploadedBy column to tblAlignerSets';
END
ELSE
BEGIN
    PRINT 'PdfUploadedBy column already exists';
END
GO

-- Add DriveFileId field if it doesn't exist (for future deletion/updates)
IF NOT EXISTS (
    SELECT * FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'tblAlignerSets'
    AND COLUMN_NAME = 'DriveFileId'
)
BEGIN
    ALTER TABLE tblAlignerSets
    ADD DriveFileId NVARCHAR(255) NULL;
    PRINT 'Added DriveFileId column to tblAlignerSets';
END
ELSE
BEGIN
    PRINT 'DriveFileId column already exists';
END
GO

PRINT 'Migration completed successfully';
GO
