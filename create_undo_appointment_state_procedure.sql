-- Create a new dedicated procedure for undoing appointment states
-- This procedure is specifically designed for setting state fields to NULL
-- and doesn't affect the existing UpdatePresent procedure used by other apps

CREATE PROCEDURE [dbo].[UndoAppointmentState]
  @AppointmentID as int,
  @StateField as varchar(100)  -- 'Present', 'Seated', or 'Dismissed'
AS
BEGIN
    SET NOCOUNT ON;

    -- Use parameterized query for security (prevents SQL injection)
    DECLARE @SQL NVARCHAR(MAX)

    -- Validate state field to prevent SQL injection
    IF @StateField NOT IN ('Present', 'Seated', 'Dismissed')
    BEGIN
        RAISERROR('Invalid state field. Must be Present, Seated, or Dismissed.', 16, 1)
        RETURN
    END

    -- Build and execute the update query
    SET @SQL = N'UPDATE tblappointments SET [' + @StateField + N'] = NULL WHERE AppointmentID = @AppointmentID'

    EXEC sp_executesql @SQL, N'@AppointmentID int', @AppointmentID

    -- Return success indicator
    SELECT
        @AppointmentID as AppointmentID,
        @StateField as StateCleared,
        1 as Success
END
GO
