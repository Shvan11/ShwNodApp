-- Migration script to move data from the old tblpatients.Alerts column
-- to the new tblAlerts table.

-- Declare variables for default IDs
DECLARE @DefaultAlertTypeID INT;
DECLARE @DefaultSeverity INT;

-- Get the ID for the 'Other' alert type.
SELECT @DefaultAlertTypeID = AlertTypeID FROM tblAlertTypes WHERE TypeName = 'Other';

-- Set the default severity.
SET @DefaultSeverity = 1; -- 1: Mild

-- Check if the default type was found
IF @DefaultAlertTypeID IS NULL
BEGIN
    PRINT 'ERROR: Default alert type "Other" not found in tblAlertTypes. Migration cannot proceed.';
    -- This will cause sqlcmd to stop if run with -b
    RAISERROR ('Default alert type "Other" not found.', 16, 1);
    RETURN;
END

-- Insert data into tblAlerts from tblpatients
-- This will create a new alert for each patient that has a non-empty value in the old Alerts column.
INSERT INTO tblAlerts (PersonID, AlertTypeID, AlertSeverity, AlertDetails)
SELECT
    PersonID,
    @DefaultAlertTypeID,
    @DefaultSeverity,
    RTRIM(LTRIM(Alerts)) -- Trim whitespace from the old alert text
FROM
    tblpatients
WHERE
    Alerts IS NOT NULL AND RTRIM(LTRIM(Alerts)) <> '';

PRINT 'Alert data migration complete.';
PRINT 'Please review the data in tblAlerts to ensure it was migrated correctly before dropping the old column.';
GO
