-- Migration: Add DELETE trigger for tblAlignerNotes to sync deletions to Supabase
-- This ensures that when notes are deleted from the management page, the deletions are synced

-- Create DELETE trigger for tblAlignerNotes
IF OBJECT_ID('trg_sync_tblAlignerNotes_Delete', 'TR') IS NOT NULL
    DROP TRIGGER trg_sync_tblAlignerNotes_Delete;
GO

CREATE TRIGGER trg_sync_tblAlignerNotes_Delete
ON tblAlignerNotes
AFTER DELETE
AS
BEGIN
    SET NOCOUNT ON;

    -- Sync ALL note deletions (both Lab and Doctor types)
    -- Management page can delete any note, and it should sync to Supabase
    INSERT INTO SyncQueue (TableName, RecordID, Operation, JsonData)
    SELECT
        'aligner_notes',
        d.NoteID,
        'DELETE',
        (SELECT
            d.NoteID as note_id,
            d.AlignerSetID as aligner_set_id,
            d.NoteType as note_type
         FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
    FROM deleted d;
END
GO
