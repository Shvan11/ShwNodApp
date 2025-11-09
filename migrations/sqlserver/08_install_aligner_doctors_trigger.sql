-- ============================================
-- Install Sync Trigger for AlignerDoctors
-- Migration: 08_install_aligner_doctors_trigger.sql
-- Date: 2025-11-09
-- Description: Install missing sync trigger for AlignerDoctors table
-- ============================================

-- Drop existing trigger if it exists
IF OBJECT_ID('trg_sync_AlignerDoctors', 'TR') IS NOT NULL
BEGIN
    DROP TRIGGER trg_sync_AlignerDoctors;
    PRINT '✓ Dropped existing trigger';
END
GO

-- Create the sync trigger
CREATE TRIGGER trg_sync_AlignerDoctors
ON AlignerDoctors
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    INSERT INTO SyncQueue (TableName, RecordID, Operation, JsonData)
    SELECT
        'aligner_doctors',
        i.DrID,
        CASE WHEN EXISTS(SELECT 1 FROM deleted d WHERE d.DrID = i.DrID)
             THEN 'UPDATE'
             ELSE 'INSERT'
        END,
        (SELECT
            i.DrID as dr_id,
            i.DoctorName as doctor_name,
            i.DoctorEmail as doctor_email,
            i.LogoPath as logo_path
         FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
    FROM inserted i;
END
GO

-- Verify trigger was created
IF OBJECT_ID('trg_sync_AlignerDoctors', 'TR') IS NOT NULL
BEGIN
    PRINT '✅ Trigger trg_sync_AlignerDoctors created successfully';

    SELECT
        'AlignerDoctors' AS TableName,
        name AS TriggerName,
        is_disabled AS IsDisabled,
        create_date AS CreatedDate,
        type_desc AS TriggerType
    FROM sys.triggers
    WHERE name = 'trg_sync_AlignerDoctors';
END
ELSE
BEGIN
    PRINT '❌ ERROR: Trigger creation failed';
END
GO
