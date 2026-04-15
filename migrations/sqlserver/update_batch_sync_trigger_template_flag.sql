-- =============================================
-- Add HasUpperTemplate / HasLowerTemplate to trg_sync_tblAlignerBatches change detection
-- =============================================
-- PURPOSE: The existing trg_sync_tblAlignerBatches change-detection clause did
--          not list HasUpperTemplate / HasLowerTemplate. A flag-only UPDATE
--          would have been dropped. The update SP currently resequences on
--          flag changes, so UpperAlignerStartSequence / LowerAlignerStartSequence
--          differ and the trigger fires by side effect — but that is brittle.
--          Add the flags to the comparison explicitly.
--
--          This migration supersedes add_delete_to_batch_sync_trigger.sql and
--          preserves its behavior:
--            - AFTER INSERT, UPDATE, DELETE
--            - DELETE records are enqueued
--            - Change-detection includes IsLast and CreationDate
--
-- PAYLOAD: This trigger writes only IDs to SyncQueue; the queue processor
--          fetches the row via fetchAlignerBatchFromSqlServer(), which already
--          reads HasUpperTemplate / HasLowerTemplate. No payload change needed.
-- =============================================

USE ShwanNew;
GO

SET ANSI_NULLS ON;
GO
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID('dbo.trg_sync_tblAlignerBatches', 'TR') IS NOT NULL
    DROP TRIGGER dbo.trg_sync_tblAlignerBatches;
GO

CREATE TRIGGER dbo.trg_sync_tblAlignerBatches
ON dbo.tblAlignerBatches
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    -- Handle DELETE: queue deleted records for sync
    IF EXISTS (SELECT 1 FROM deleted) AND NOT EXISTS (SELECT 1 FROM inserted)
    BEGIN
        INSERT INTO SyncQueue (TableName, RecordID, Operation, Status, CreatedAt)
        SELECT 'aligner_batches', d.AlignerBatchID, 'DELETE', 'pending', GETDATE()
        FROM deleted d;
        RETURN;
    END

    -- Handle INSERT / UPDATE with change detection
    IF NOT EXISTS (
        SELECT 1 FROM inserted i
        LEFT JOIN deleted d ON i.AlignerBatchID = d.AlignerBatchID
        WHERE d.AlignerBatchID IS NULL  -- INSERT
           OR (  -- UPDATE with actual changes
               ISNULL(i.Days, -1) <> ISNULL(d.Days, -1)
               OR ISNULL(i.UpperAlignerCount, -1) <> ISNULL(d.UpperAlignerCount, -1)
               OR ISNULL(i.LowerAlignerCount, -1) <> ISNULL(d.LowerAlignerCount, -1)
               OR ISNULL(i.UpperAlignerStartSequence, -1) <> ISNULL(d.UpperAlignerStartSequence, -1)
               OR ISNULL(i.UpperAlignerEndSequence, -1) <> ISNULL(d.UpperAlignerEndSequence, -1)
               OR ISNULL(i.LowerAlignerStartSequence, -1) <> ISNULL(d.LowerAlignerStartSequence, -1)
               OR ISNULL(i.LowerAlignerEndSequence, -1) <> ISNULL(d.LowerAlignerEndSequence, -1)
               OR ISNULL(CAST(i.ManufactureDate AS VARCHAR), '') <> ISNULL(CAST(d.ManufactureDate AS VARCHAR), '')
               OR ISNULL(CAST(i.DeliveredToPatientDate AS VARCHAR), '') <> ISNULL(CAST(d.DeliveredToPatientDate AS VARCHAR), '')
               OR ISNULL(i.ValidityPeriod, -1) <> ISNULL(d.ValidityPeriod, -1)
               OR ISNULL(CAST(i.BatchExpiryDate AS VARCHAR), '') <> ISNULL(CAST(d.BatchExpiryDate AS VARCHAR), '')
               OR ISNULL(i.Notes, '') <> ISNULL(d.Notes, '')
               OR ISNULL(i.IsActive, 0) <> ISNULL(d.IsActive, 0)
               OR ISNULL(i.IsLast, 0) <> ISNULL(d.IsLast, 0)
               OR ISNULL(CAST(i.CreationDate AS VARCHAR), '') <> ISNULL(CAST(d.CreationDate AS VARCHAR), '')
               OR ISNULL(i.HasUpperTemplate, 0) <> ISNULL(d.HasUpperTemplate, 0)
               OR ISNULL(i.HasLowerTemplate, 0) <> ISNULL(d.HasLowerTemplate, 0)
           )
    )
    RETURN;

    -- Store IDs only; queue processor fetches data on-demand
    INSERT INTO SyncQueue (TableName, RecordID, Operation, Status, CreatedAt)
    SELECT
        'aligner_batches',
        i.AlignerBatchID,
        CASE WHEN d.AlignerBatchID IS NULL THEN 'INSERT' ELSE 'UPDATE' END,
        'pending',
        GETDATE()
    FROM inserted i
    LEFT JOIN deleted d ON i.AlignerBatchID = d.AlignerBatchID;
END
GO

PRINT 'Updated trg_sync_tblAlignerBatches: AFTER INSERT/UPDATE/DELETE, change detection includes HasUpperTemplate/HasLowerTemplate';
GO
