-- =============================================
-- Additional Sync Triggers for Patient/Work Data
-- =============================================

-- ============================================
-- 5. TRIGGER: tblPatients
-- ============================================
IF OBJECT_ID('trg_sync_tblPatients', 'TR') IS NOT NULL
    DROP TRIGGER trg_sync_tblPatients;
GO

CREATE TRIGGER trg_sync_tblPatients
ON tblPatients
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    -- Only sync patients that have aligner works
    INSERT INTO SyncQueue (TableName, RecordID, Operation, JsonData)
    SELECT
        'patients',
        i.PersonID,
        CASE WHEN EXISTS(SELECT 1 FROM deleted d WHERE d.PersonID = i.PersonID)
             THEN 'UPDATE'
             ELSE 'INSERT'
        END,
        (SELECT
            i.PersonID as person_id,
            i.PatientName as patient_name,
            i.FirstName as first_name,
            i.LastName as last_name,
            i.Phone as phone
         FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
    FROM inserted i
    WHERE EXISTS (
        SELECT 1 FROM tblWork w
        INNER JOIN tblAlignerSets s ON w.workid = s.WorkID
        WHERE w.PersonID = i.PersonID
    );
END
GO

-- ============================================
-- 6. TRIGGER: tblWork
-- ============================================
IF OBJECT_ID('trg_sync_tblWork', 'TR') IS NOT NULL
    DROP TRIGGER trg_sync_tblWork;
GO

CREATE TRIGGER trg_sync_tblWork
ON tblWork
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    -- Only sync work records that have aligner sets
    INSERT INTO SyncQueue (TableName, RecordID, Operation, JsonData)
    SELECT
        'work',
        i.workid,
        CASE WHEN EXISTS(SELECT 1 FROM deleted d WHERE d.workid = i.workid)
             THEN 'UPDATE'
             ELSE 'INSERT'
        END,
        (SELECT
            i.workid as work_id,
            i.PersonID as person_id,
            i.Typeofwork as type_of_work,
            i.AdditionDate as addition_date
         FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
    FROM inserted i
    WHERE EXISTS (
        SELECT 1 FROM tblAlignerSets
        WHERE WorkID = i.workid
    );
END
GO

PRINT '✅ Patient and Work sync triggers created successfully';
PRINT 'Triggers created:';
PRINT '  - trg_sync_tblPatients';
PRINT '  - trg_sync_tblWork';
GO
