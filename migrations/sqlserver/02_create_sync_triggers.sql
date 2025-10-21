-- =============================================
-- SQL Server Triggers for Automatic Sync
-- =============================================
-- These triggers capture changes and add them to SyncQueue

-- ============================================
-- 1. TRIGGER: AlignerDoctors
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
    FROM inserted i;
END
GO

-- ============================================
-- 2. TRIGGER: tblAlignerSets
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
    FROM inserted i;
END
GO

-- ============================================
-- 3. TRIGGER: tblAlignerBatches
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
    FROM inserted i;
END
GO

-- ============================================
-- 4. TRIGGER: tblAlignerNotes (Lab notes only)
-- ============================================
IF OBJECT_ID('trg_sync_tblAlignerNotes', 'TR') IS NOT NULL
    DROP TRIGGER trg_sync_tblAlignerNotes;
GO

CREATE TRIGGER trg_sync_tblAlignerNotes
ON tblAlignerNotes
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    -- Only sync Lab notes (Doctor notes come from portal)
    INSERT INTO SyncQueue (TableName, RecordID, Operation, JsonData)
    SELECT
        'aligner_notes',
        i.NoteID,
        CASE WHEN EXISTS(SELECT 1 FROM deleted d WHERE d.NoteID = i.NoteID)
             THEN 'UPDATE'
             ELSE 'INSERT'
        END,
        (SELECT
            i.NoteID as note_id,
            i.AlignerSetID as aligner_set_id,
            i.NoteType as note_type,
            i.NoteText as note_text,
            i.CreatedAt as created_at,
            i.IsEdited as is_edited,
            i.EditedAt as edited_at
         FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
    FROM inserted i
    WHERE i.NoteType = 'Lab'; -- Only sync lab notes
END
GO

PRINT '✅ All sync triggers created successfully';
PRINT 'Triggers created:';
PRINT '  - trg_sync_AlignerDoctors';
PRINT '  - trg_sync_tblAlignerSets';
PRINT '  - trg_sync_tblAlignerBatches';
PRINT '  - trg_sync_tblAlignerNotes';
GO
