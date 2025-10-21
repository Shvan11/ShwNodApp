-- =============================================
-- Aligner Activity Flags System
-- =============================================
-- Tracks doctor activity (notes added, days changed) for staff notifications
-- Automatically populated by database triggers

-- Create activity flags table
IF OBJECT_ID('tblAlignerActivityFlags', 'U') IS NOT NULL
    DROP TABLE tblAlignerActivityFlags;
GO

CREATE TABLE tblAlignerActivityFlags (
    ActivityID INT IDENTITY(1,1) PRIMARY KEY,
    AlignerSetID INT NOT NULL,
    ActivityType NVARCHAR(50) NOT NULL,
    ActivityDescription NVARCHAR(500) NOT NULL,
    CreatedAt DATETIME DEFAULT GETDATE(),
    IsRead BIT DEFAULT 0,
    ReadAt DATETIME NULL,
    RelatedRecordID INT NULL, -- NoteID or BatchID

    CONSTRAINT FK_ActivityFlags_AlignerSet
        FOREIGN KEY (AlignerSetID)
        REFERENCES tblAlignerSets(AlignerSetID)
        ON DELETE CASCADE,

    CONSTRAINT CK_ActivityType
        CHECK (ActivityType IN ('DoctorNote', 'DaysChanged'))
);

-- Create indexes for performance
CREATE INDEX idx_activity_set_unread
    ON tblAlignerActivityFlags(AlignerSetID, IsRead);

CREATE INDEX idx_activity_created
    ON tblAlignerActivityFlags(CreatedAt DESC);

PRINT '✅ Activity flags table created';
GO

-- =============================================
-- TRIGGER 1: Detect Doctor Notes
-- =============================================
IF OBJECT_ID('trg_AlignerNotes_DoctorActivity', 'TR') IS NOT NULL
    DROP TRIGGER trg_AlignerNotes_DoctorActivity;
GO

CREATE TRIGGER trg_AlignerNotes_DoctorActivity
ON tblAlignerNotes
AFTER INSERT
AS
BEGIN
    SET NOCOUNT ON;

    -- Only create activity flag for Doctor notes (not Lab notes)
    INSERT INTO tblAlignerActivityFlags (
        AlignerSetID,
        ActivityType,
        ActivityDescription,
        RelatedRecordID
    )
    SELECT
        i.AlignerSetID,
        'DoctorNote',
        'Dr. ' + ISNULL(d.DoctorName, 'Unknown') + ' added a note',
        i.NoteID
    FROM inserted i
    INNER JOIN tblAlignerSets s ON i.AlignerSetID = s.AlignerSetID
    LEFT JOIN AlignerDoctors d ON s.AlignerDrID = d.DrID
    WHERE i.NoteType = 'Doctor';

    IF @@ROWCOUNT > 0
        PRINT '🔔 Activity flag created for doctor note';
END
GO

PRINT '✅ Doctor notes trigger created';
GO

-- =============================================
-- TRIGGER 2: Detect Days Changes by Doctor
-- =============================================
IF OBJECT_ID('trg_AlignerBatches_DaysChanged', 'TR') IS NOT NULL
    DROP TRIGGER trg_AlignerBatches_DaysChanged;
GO

CREATE TRIGGER trg_AlignerBatches_DaysChanged
ON tblAlignerBatches
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    -- Only create activity flag when Days field changes
    IF UPDATE(Days)
    BEGIN
        INSERT INTO tblAlignerActivityFlags (
            AlignerSetID,
            ActivityType,
            ActivityDescription,
            RelatedRecordID
        )
        SELECT
            i.AlignerSetID,
            'DaysChanged',
            'Days changed from ' +
                ISNULL(CAST(d.Days AS VARCHAR), 'not set') +
                ' to ' +
                ISNULL(CAST(i.Days AS VARCHAR), 'not set'),
            i.AlignerBatchID
        FROM inserted i
        INNER JOIN deleted d ON i.AlignerBatchID = d.AlignerBatchID
        WHERE
            -- Days actually changed (not just updated to same value)
            (i.Days != d.Days)
            OR (i.Days IS NOT NULL AND d.Days IS NULL)
            OR (i.Days IS NULL AND d.Days IS NOT NULL);

        IF @@ROWCOUNT > 0
            PRINT '🔔 Activity flag created for days change';
    END
END
GO

PRINT '✅ Days changed trigger created';
GO

-- =============================================
-- Test the system
-- =============================================
PRINT '';
PRINT '🎉 Aligner Activity Flags System Setup Complete!';
PRINT '';
PRINT 'How it works:';
PRINT '1. Doctor adds note in portal → Syncs to SQL Server → Trigger creates activity flag';
PRINT '2. Doctor changes days in portal → Syncs to SQL Server → Trigger creates activity flag';
PRINT '3. Staff sees visual indicators on affected aligner sets';
PRINT '4. Staff can mark activities as read';
PRINT '';
PRINT 'Tables created:';
PRINT '  - tblAlignerActivityFlags';
PRINT '';
PRINT 'Triggers created:';
PRINT '  - trg_AlignerNotes_DoctorActivity';
PRINT '  - trg_AlignerBatches_DaysChanged';
PRINT '';
