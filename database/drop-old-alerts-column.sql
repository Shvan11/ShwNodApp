-- Drop the old 'Alerts' column from the tblpatients table
-- WARNING: This is a destructive action. Ensure data has been successfully migrated
-- to the new tblAlerts table before running this script.

IF EXISTS(SELECT * FROM sys.columns WHERE Name = N'Alerts' AND Object_ID = Object_ID(N'tblpatients'))
BEGIN
    ALTER TABLE tblpatients DROP COLUMN Alerts;
    PRINT 'Successfully dropped the "Alerts" column from the "tblpatients" table.';
END
ELSE
BEGIN
    PRINT 'Column "Alerts" does not exist in "tblpatients" table. No action taken.';
END
GO
