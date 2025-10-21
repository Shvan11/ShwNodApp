-- =============================================
-- Webhook Notification System for SyncQueue
-- =============================================
-- SQL Server will call Node.js app directly when queue has new items

-- Step 1: Enable OLE Automation (required for HTTP calls)
PRINT 'Enabling OLE Automation Procedures...';
EXEC sp_configure 'show advanced options', 1;
RECONFIGURE;
EXEC sp_configure 'Ole Automation Procedures', 1;
RECONFIGURE;
PRINT '✅ OLE Automation enabled';
GO

-- Step 2: Create stored procedure to notify app via webhook
IF OBJECT_ID('sp_NotifyAppOfSync', 'P') IS NOT NULL
    DROP PROCEDURE sp_NotifyAppOfSync;
GO

CREATE PROCEDURE sp_NotifyAppOfSync
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Url NVARCHAR(500) = 'http://localhost:3000/api/sync/queue-notify';
    DECLARE @Object INT;
    DECLARE @ResponseText VARCHAR(8000);
    DECLARE @HR INT;

    -- Create HTTP object
    EXEC @HR = sp_OACreate 'MSXML2.ServerXMLHTTP', @Object OUT;
    IF @HR <> 0 RETURN;

    -- Open connection
    EXEC @HR = sp_OAMethod @Object, 'open', NULL, 'POST', @Url, 'false';
    IF @HR <> 0 GOTO CleanUp;

    -- Set headers
    EXEC @HR = sp_OAMethod @Object, 'setRequestHeader', NULL, 'Content-Type', 'application/json';
    IF @HR <> 0 GOTO CleanUp;

    -- Send request
    EXEC @HR = sp_OAMethod @Object, 'send', NULL, '{"source":"sqlserver"}';
    IF @HR <> 0 GOTO CleanUp;

CleanUp:
    EXEC sp_OADestroy @Object;
END
GO

-- Step 3: Create trigger on SyncQueue to notify app on INSERT
IF OBJECT_ID('trg_SyncQueue_NotifyApp', 'TR') IS NOT NULL
    DROP TRIGGER trg_SyncQueue_NotifyApp;
GO

CREATE TRIGGER trg_SyncQueue_NotifyApp
ON SyncQueue
AFTER INSERT
AS
BEGIN
    SET NOCOUNT ON;

    -- Only notify if at least one row was inserted
    IF (SELECT COUNT(*) FROM inserted) > 0
    BEGIN
        -- Call webhook asynchronously (don't wait for response)
        EXEC sp_NotifyAppOfSync;
    END
END
GO

PRINT '';
PRINT '✅ Webhook Notification System Setup Complete!';
PRINT '';
PRINT 'How it works:';
PRINT '  1. Data changes in SQL Server';
PRINT '  2. Existing triggers add to SyncQueue';
PRINT '  3. New trigger (trg_SyncQueue_NotifyApp) calls webhook';
PRINT '  4. Node.js app receives notification at /api/sync/queue-notify';
PRINT '  5. App processes queue immediately';
PRINT '';
PRINT '⚠️  Important: Your Node.js app must be running on localhost:3000';
PRINT '';
GO
