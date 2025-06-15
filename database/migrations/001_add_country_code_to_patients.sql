-- Database Migration: Add CountryCode field to tblpatients
-- This migration adds support for international phone numbers
-- Date: 2025-06-15

USE [ShwanNew];
GO

-- Step 1: Add CountryCode column to tblpatients
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[tblpatients]') AND name = 'CountryCode')
BEGIN
    ALTER TABLE [dbo].[tblpatients]
    ADD [CountryCode] [nvarchar](5) NULL;
    
    PRINT 'Added CountryCode column to tblpatients table';
END
ELSE
BEGIN
    PRINT 'CountryCode column already exists in tblpatients table';
END
GO

-- Step 2: Set default country code to '964' for existing records
UPDATE [dbo].[tblpatients] 
SET [CountryCode] = '964' 
WHERE [CountryCode] IS NULL;

PRINT 'Updated existing records with default country code 964';
GO

-- Step 3: Add default constraint for new records
IF NOT EXISTS (SELECT * FROM sys.default_constraints WHERE object_id = OBJECT_ID(N'[dbo].[DF_tblpatients_CountryCode]'))
BEGIN
    ALTER TABLE [dbo].[tblpatients]
    ADD CONSTRAINT [DF_tblpatients_CountryCode] DEFAULT ('964') FOR [CountryCode];
    
    PRINT 'Added default constraint for CountryCode column';
END
ELSE
BEGIN
    PRINT 'Default constraint for CountryCode already exists';
END
GO

-- Step 4: Add check constraint for valid country codes
IF NOT EXISTS (SELECT * FROM sys.check_constraints WHERE object_id = OBJECT_ID(N'[dbo].[CK_tblpatients_CountryCode]'))
BEGIN
    ALTER TABLE [dbo].[tblpatients]
    ADD CONSTRAINT [CK_tblpatients_CountryCode] 
    CHECK ([CountryCode] IS NOT NULL AND LEN([CountryCode]) BETWEEN 1 AND 5 AND [CountryCode] NOT LIKE '%[^0-9]%');
    
    PRINT 'Added check constraint for CountryCode validation';
END
ELSE
BEGIN
    PRINT 'Check constraint for CountryCode already exists';
END
GO

-- Step 5: Create index on CountryCode for better query performance
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID(N'[dbo].[tblpatients]') AND name = 'IX_tblpatients_CountryCode')
BEGIN
    CREATE NONCLUSTERED INDEX [IX_tblpatients_CountryCode]
    ON [dbo].[tblpatients] ([CountryCode])
    INCLUDE ([PersonID], [Phone]);
    
    PRINT 'Created index on CountryCode column';
END
ELSE
BEGIN
    PRINT 'Index on CountryCode already exists';
END
GO

-- Step 6: Add extended property for documentation
IF NOT EXISTS (SELECT * FROM sys.extended_properties WHERE major_id = OBJECT_ID('dbo.tblpatients') AND minor_id = (SELECT column_id FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tblpatients') AND name = 'CountryCode'))
BEGIN
    EXEC sys.sp_addextendedproperty 
        @name=N'MS_Description', 
        @value=N'International country code for phone numbers (e.g., 964 for Iraq, 1 for USA)', 
        @level0type=N'SCHEMA', @level0name=N'dbo', 
        @level1type=N'TABLE', @level1name=N'tblpatients', 
        @level2type=N'COLUMN', @level2name=N'CountryCode';
    
    PRINT 'Added documentation for CountryCode column';
END
GO

PRINT 'Migration completed successfully: CountryCode field added to tblpatients';
GO