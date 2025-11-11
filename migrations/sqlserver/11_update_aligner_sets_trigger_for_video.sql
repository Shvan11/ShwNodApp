-- =============================================
-- Update tblAlignerSets trigger to include SetVideo
-- Migration: 11_update_aligner_sets_trigger_for_video.sql
-- Purpose: Ensure SetVideo changes sync to Supabase automatically
-- =============================================

PRINT 'Starting migration: Update sync trigger for SetVideo field';
GO

-- Drop existing trigger
IF OBJECT_ID('trg_sync_tblAlignerSets', 'TR') IS NOT NULL
BEGIN
    DROP TRIGGER trg_sync_tblAlignerSets;
    PRINT '  Dropped existing trigger';
END
GO

-- Create updated trigger with SetVideo field
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
            i.DriveFileId as drive_file_id,
            i.SetVideo as set_video  -- ⭐ NEW FIELD - ensures video URL syncs to Supabase
         FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
    FROM inserted i;
END
GO

PRINT '✅ Trigger trg_sync_tblAlignerSets updated successfully';
PRINT '✅ SetVideo changes will now automatically sync to Supabase';
PRINT '';
PRINT 'Migration complete!';
GO
