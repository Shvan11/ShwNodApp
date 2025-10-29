-- ========================================
-- Create both required stored procedures
-- Database: ShwanNew
-- ========================================

USE [ShwanNew]
GO

-- 1. UpdatePresent - Main procedure for updating appointment states
--    Used by the primary application
-- ========================================
CREATE PROCEDURE [dbo].[UpdatePresent]
  @Aid as int,
  @state as varchar(100),
  @Tim as varchar(10)  -- Time string like '09:30' or '09:30:00'
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Sql NVARCHAR(4000)

    -- Convert string to time format for the database
    SET @SQL = 'UPDATE tblappointments SET [' + @state + '] = CAST(''' + @Tim +
               ''' AS time(0)) WHERE AppointmentID = ' + CAST(@Aid AS varchar(10))

    EXECUTE sp_executesql @sql
END
GO

-- ========================================
-- 2. UndoAppointmentState - Dedicated procedure for undo operations
--    Used by the web application for clearing states
-- ========================================
CREATE PROCEDURE [dbo].[UndoAppointmentState]
  @AppointmentID as int,
  @StateField as varchar(100)  -- 'Present', 'Seated', or 'Dismissed'
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @SQL NVARCHAR(MAX)

    -- Validate state field to prevent SQL injection
    IF @StateField NOT IN ('Present', 'Seated', 'Dismissed')
    BEGIN
        RAISERROR('Invalid state field. Must be Present, Seated, or Dismissed.', 16, 1)
        RETURN
    END

    -- Build and execute the update query to set field to NULL
    SET @SQL = N'UPDATE tblappointments SET [' + @StateField + N'] = NULL WHERE AppointmentID = @AppointmentID'

    EXEC sp_executesql @SQL, N'@AppointmentID int', @AppointmentID

    -- Return success indicator
    SELECT
        @AppointmentID as AppointmentID,
        @StateField as StateCleared,
        1 as Success
END
GO
