-- =============================================
-- Fix: Only Add to SyncQueue When Data Actually Changes
-- =============================================
-- Problem: Triggers fire on every UPDATE, even if no values changed
-- Solution: Compare OLD vs NEW values using DELETED and INSERTED tables
-- This prevents circular sync loops and unnecessary webhook spam
-- =============================================

PRINT 'Applying fix: Change detection in sync triggers';
PRINT '================================================';

-- ============================================
-- 1. FIX: tblAlignerBatches Trigger
-- ============================================
IF OBJECT_ID('trg_sync_tblAlignerBatches', 'TR') IS NOT NULL
    DROP TRIGGER trg_sync_tblAlignerBatches;
GO

CREATE TRIGGER trg_sync_tblAlignerBatches
ON tblAlignerBatches
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    -- For INSERTs: Always add to queue
    -- For UPDATEs: Only add if data actually changed
    INSERT INTO SyncQueue (TableName, RecordID, Operation, JsonData)
    SELECT
        'aligner_batches',
        i.AlignerBatchID,
        CASE WHEN EXISTS(SELECT 1 FROM deleted d WHERE d.AlignerBatchID = i.AlignerBatchID)
             THEN 'UPDATE'
             ELSE 'INSERT'
        END,
        (SELECT
            i.AlignerBatchID as aligner_batch_id,
            i.AlignerSetID as aligner_set_id,
            i.BatchSequence as batch_sequence,
            i.UpperAlignerCount as upper_aligner_count,
            i.LowerAlignerCount as lower_aligner_count,
            i.UpperAlignerStartSequence as upper_aligner_start_sequence,
            i.UpperAlignerEndSequence as upper_aligner_end_sequence,
            i.LowerAlignerStartSequence as lower_aligner_start_sequence,
            i.LowerAlignerEndSequence as lower_aligner_end_sequence,
            i.ManufactureDate as manufacture_date,
            i.DeliveredToPatientDate as delivered_to_patient_date,
            i.Days as days,
            i.ValidityPeriod as validity_period,
            i.NextBatchReadyDate as next_batch_ready_date,
            i.Notes as notes,
            i.IsActive as is_active
         FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
    FROM inserted i
    LEFT JOIN deleted d ON i.AlignerBatchID = d.AlignerBatchID
    WHERE
        -- Always include INSERTs (no matching deleted record)
        d.AlignerBatchID IS NULL
        -- For UPDATEs, only include if ANY field changed
        OR (
            -- Check all relevant fields for changes
            ISNULL(i.Days, -1) <> ISNULL(d.Days, -1)
            OR ISNULL(i.UpperAlignerCount, -1) <> ISNULL(d.UpperAlignerCount, -1)
            OR ISNULL(i.LowerAlignerCount, -1) <> ISNULL(d.LowerAlignerCount, -1)
            OR ISNULL(i.UpperAlignerStartSequence, -1) <> ISNULL(d.UpperAlignerStartSequence, -1)
            OR ISNULL(i.UpperAlignerEndSequence, -1) <> ISNULL(d.UpperAlignerEndSequence, -1)
            OR ISNULL(i.LowerAlignerStartSequence, -1) <> ISNULL(d.LowerAlignerStartSequence, -1)
            OR ISNULL(i.LowerAlignerEndSequence, -1) <> ISNULL(d.LowerAlignerEndSequence, -1)
            OR ISNULL(i.ManufactureDate, '1900-01-01') <> ISNULL(d.ManufactureDate, '1900-01-01')
            OR ISNULL(i.DeliveredToPatientDate, '1900-01-01') <> ISNULL(d.DeliveredToPatientDate, '1900-01-01')
            OR ISNULL(i.ValidityPeriod, -1) <> ISNULL(d.ValidityPeriod, -1)
            OR ISNULL(i.NextBatchReadyDate, '1900-01-01') <> ISNULL(d.NextBatchReadyDate, '1900-01-01')
            OR ISNULL(i.Notes, '') <> ISNULL(d.Notes, '')
            OR ISNULL(i.IsActive, 0) <> ISNULL(d.IsActive, 0)
        );
END
GO

-- ============================================
-- 2. FIX: tblAlignerSets Trigger
-- ============================================
IF OBJECT_ID('trg_sync_tblAlignerSets', 'TR') IS NOT NULL
    DROP TRIGGER trg_sync_tblAlignerSets;
GO

CREATE TRIGGER trg_sync_tblAlignerSets
ON tblAlignerSets
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    INSERT INTO SyncQueue (TableName, RecordID, Operation, JsonData)
    SELECT
        'aligner_sets',
        i.AlignerSetID,
        CASE WHEN EXISTS(SELECT 1 FROM deleted d WHERE d.AlignerSetID = i.AlignerSetID)
             THEN 'UPDATE'
             ELSE 'INSERT'
        END,
        (SELECT
            i.AlignerSetID as aligner_set_id,
            i.WorkID as work_id,
            i.AlignerDrID as aligner_dr_id,
            i.SetSequence as set_sequence,
            i.Type as type,
            i.UpperAlignersCount as upper_aligners_count,
            i.LowerAlignersCount as lower_aligners_count,
            i.RemainingUpperAligners as remaining_upper_aligners,
            i.RemainingLowerAligners as remaining_lower_aligners,
            i.CreationDate as creation_date,
            i.Days as days,
            i.IsActive as is_active,
            i.Notes as notes,
            i.FolderPath as folder_path,
            i.SetUrl as set_url,
            i.SetPdfUrl as set_pdf_url,
            i.SetCost as set_cost,
            i.Currency as currency,
            i.PdfUploadedAt as pdf_uploaded_at,
            i.PdfUploadedBy as pdf_uploaded_by,
            i.DriveFileId as drive_file_id
         FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
    FROM inserted i
    LEFT JOIN deleted d ON i.AlignerSetID = d.AlignerSetID
    WHERE
        -- Always include INSERTs
        d.AlignerSetID IS NULL
        -- For UPDATEs, only include if ANY field changed
        OR (
            ISNULL(i.WorkID, -1) <> ISNULL(d.WorkID, -1)
            OR ISNULL(i.AlignerDrID, -1) <> ISNULL(d.AlignerDrID, -1)
            OR ISNULL(i.SetSequence, -1) <> ISNULL(d.SetSequence, -1)
            OR ISNULL(i.Type, '') <> ISNULL(d.Type, '')
            OR ISNULL(i.UpperAlignersCount, -1) <> ISNULL(d.UpperAlignersCount, -1)
            OR ISNULL(i.LowerAlignersCount, -1) <> ISNULL(d.LowerAlignersCount, -1)
            OR ISNULL(i.RemainingUpperAligners, -1) <> ISNULL(d.RemainingUpperAligners, -1)
            OR ISNULL(i.RemainingLowerAligners, -1) <> ISNULL(d.RemainingLowerAligners, -1)
            OR ISNULL(i.CreationDate, '1900-01-01') <> ISNULL(d.CreationDate, '1900-01-01')
            OR ISNULL(i.Days, -1) <> ISNULL(d.Days, -1)
            OR ISNULL(i.IsActive, 0) <> ISNULL(d.IsActive, 0)
            OR ISNULL(i.Notes, '') <> ISNULL(d.Notes, '')
            OR ISNULL(i.FolderPath, '') <> ISNULL(d.FolderPath, '')
            OR ISNULL(i.SetUrl, '') <> ISNULL(d.SetUrl, '')
            OR ISNULL(i.SetPdfUrl, '') <> ISNULL(d.SetPdfUrl, '')
            OR ISNULL(i.SetCost, -1) <> ISNULL(d.SetCost, -1)
            OR ISNULL(i.Currency, '') <> ISNULL(d.Currency, '')
            OR ISNULL(i.PdfUploadedAt, '1900-01-01') <> ISNULL(d.PdfUploadedAt, '1900-01-01')
            OR ISNULL(i.PdfUploadedBy, -1) <> ISNULL(d.PdfUploadedBy, -1)
            OR ISNULL(i.DriveFileId, '') <> ISNULL(d.DriveFileId, '')
        );
END
GO

-- ============================================
-- 3. FIX: AlignerDoctors Trigger
-- ============================================
IF OBJECT_ID('trg_sync_AlignerDoctors', 'TR') IS NOT NULL
    DROP TRIGGER trg_sync_AlignerDoctors;
GO

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
    FROM inserted i
    LEFT JOIN deleted d ON i.DrID = d.DrID
    WHERE
        -- Always include INSERTs
        d.DrID IS NULL
        -- For UPDATEs, only include if ANY field changed
        OR (
            ISNULL(i.DoctorName, '') <> ISNULL(d.DoctorName, '')
            OR ISNULL(i.DoctorEmail, '') <> ISNULL(d.DoctorEmail, '')
            OR ISNULL(i.LogoPath, '') <> ISNULL(d.LogoPath, '')
        );
END
GO

PRINT '';
PRINT '✅ Trigger change detection fixed successfully';
PRINT '================================================';
PRINT 'Fixed triggers:';
PRINT '  ✓ trg_sync_tblAlignerBatches - Only triggers on actual data changes';
PRINT '  ✓ trg_sync_tblAlignerSets - Only triggers on actual data changes';
PRINT '  ✓ trg_sync_AlignerDoctors - Only triggers on actual data changes';
PRINT '';
PRINT 'Benefits:';
PRINT '  ✓ Eliminates circular sync loops';
PRINT '  ✓ Reduces webhook spam';
PRINT '  ✓ Reduces SyncQueue clutter';
PRINT '  ✓ Improves performance';
PRINT '';
PRINT 'Note: tblAlignerNotes trigger unchanged (already filters by NoteType=Lab)';
GO
