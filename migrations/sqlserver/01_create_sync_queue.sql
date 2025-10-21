-- =============================================
-- SQL Server → PostgreSQL Sync Queue
-- =============================================
-- This table captures all changes that need to be synced to Supabase

-- Drop table if exists (for re-running)
IF OBJECT_ID('SyncQueue', 'U') IS NOT NULL
    DROP TABLE SyncQueue;
GO

-- Create sync queue table
CREATE TABLE SyncQueue (
    QueueID INT IDENTITY(1,1) PRIMARY KEY,
    TableName VARCHAR(50) NOT NULL,
    RecordID INT NOT NULL,
    Operation VARCHAR(10) NOT NULL CHECK (Operation IN ('INSERT', 'UPDATE', 'DELETE')),
    JsonData NVARCHAR(MAX) NOT NULL,
    CreatedAt DATETIME DEFAULT GETDATE(),
    Attempts INT DEFAULT 0,
    LastAttempt DATETIME NULL,
    LastError NVARCHAR(500) NULL,
    Status VARCHAR(20) DEFAULT 'Pending' CHECK (Status IN ('Pending', 'Synced', 'Failed'))
);
GO

-- Create indexes for performance
CREATE INDEX idx_sync_status ON SyncQueue(Status, CreatedAt);
CREATE INDEX idx_sync_table ON SyncQueue(TableName, RecordID);
GO

-- Create cleanup stored procedure (delete old synced records)
CREATE OR ALTER PROCEDURE sp_CleanupSyncQueue
    @DaysOld INT = 7
AS
BEGIN
    DELETE FROM SyncQueue
    WHERE Status = 'Synced'
      AND CreatedAt < DATEADD(DAY, -@DaysOld, GETDATE());

    PRINT 'Cleanup complete. Deleted old synced records.';
END
GO

PRINT '✅ Sync queue table created successfully';
PRINT 'Tables: SyncQueue';
PRINT 'Stored Procedures: sp_CleanupSyncQueue';
GO
