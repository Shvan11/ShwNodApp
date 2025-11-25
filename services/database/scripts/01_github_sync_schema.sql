IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'tblAppointmentSyncLog')
BEGIN
    CREATE TABLE tblAppointmentSyncLog (
        SyncID INT IDENTITY(1,1) PRIMARY KEY,
        ActionDate DATE NOT NULL,
        DailySequence INT NOT NULL,
        AppointmentID INT NOT NULL,
        ActionType VARCHAR(50) NOT NULL,
        Payload NVARCHAR(MAX),
        CreatedAt DATETIME DEFAULT GETDATE(),
        CONSTRAINT UK_SyncLog_Date_Sequence UNIQUE (ActionDate, DailySequence)
    );
    CREATE INDEX IX_SyncLog_Date_Sequence ON tblAppointmentSyncLog(ActionDate, DailySequence);
    PRINT 'Table tblAppointmentSyncLog created.';
END
GO

CREATE OR ALTER PROCEDURE sp_LogAppointmentAction
    @ActionDate DATE,
    @AppointmentID INT,
    @ActionType VARCHAR(50),
    @Payload NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @NewSequence INT;

    BEGIN TRANSACTION;
    
    SELECT @NewSequence = ISNULL(MAX(DailySequence), 0) + 1
    FROM tblAppointmentSyncLog WITH (UPDLOCK, HOLDLOCK)
    WHERE ActionDate = @ActionDate;

    INSERT INTO tblAppointmentSyncLog (ActionDate, DailySequence, AppointmentID, ActionType, Payload)
    VALUES (@ActionDate, @NewSequence, @AppointmentID, @ActionType, @Payload);

    COMMIT TRANSACTION;

    SELECT @NewSequence as DailySequence;
END
GO
PRINT 'Procedure sp_LogAppointmentAction created/updated.';
GO
