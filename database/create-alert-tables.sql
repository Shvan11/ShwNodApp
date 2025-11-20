-- Create lookup table for Alert Types
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='tblAlertTypes' and xtype='U')
CREATE TABLE tblAlertTypes (
    AlertTypeID INT PRIMARY KEY IDENTITY(1,1),
    TypeName NVARCHAR(100) UNIQUE NOT NULL
);
GO

-- Create the main Alerts table
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='tblAlerts' and xtype='U')
CREATE TABLE tblAlerts (
    AlertID INT PRIMARY KEY IDENTITY(1,1),
    PersonID INT NOT NULL,
    AlertTypeID INT NOT NULL,
    AlertSeverity INT NOT NULL,
    AlertDetails NVARCHAR(MAX),
    CreationDate DATETIME NOT NULL DEFAULT GETDATE(),
    IsActive BIT NOT NULL DEFAULT 1,
    CONSTRAINT FK_Alerts_Patient FOREIGN KEY (PersonID) REFERENCES tblpatients(PersonID) ON DELETE CASCADE,
    CONSTRAINT FK_Alerts_AlertType FOREIGN KEY (AlertTypeID) REFERENCES tblAlertTypes(AlertTypeID),
    CONSTRAINT CHK_AlertSeverity CHECK (AlertSeverity IN (1, 2, 3)) -- 1: Mild, 2: Moderate, 3: Severe
);
GO

-- Populate the lookup table with initial data
IF NOT EXISTS (SELECT 1 FROM tblAlertTypes WHERE TypeName = 'Financial')
    INSERT INTO tblAlertTypes (TypeName) VALUES ('Financial');
IF NOT EXISTS (SELECT 1 FROM tblAlertTypes WHERE TypeName = 'Appointment')
    INSERT INTO tblAlertTypes (TypeName) VALUES ('Appointment');
IF NOT EXISTS (SELECT 1 FROM tblAlertTypes WHERE TypeName = 'Appliance')
    INSERT INTO tblAlertTypes (TypeName) VALUES ('Appliance');
IF NOT EXISTS (SELECT 1 FROM tblAlertTypes WHERE TypeName = 'Attitude')
    INSERT INTO tblAlertTypes (TypeName) VALUES ('Attitude');
IF NOT EXISTS (SELECT 1 FROM tblAlertTypes WHERE TypeName = 'Clinical')
    INSERT INTO tblAlertTypes (TypeName) VALUES ('Clinical');
IF NOT EXISTS (SELECT 1 FROM tblAlertTypes WHERE TypeName = 'Other')
    INSERT INTO tblAlertTypes (TypeName) VALUES ('Other');
GO

PRINT 'Alert system tables created and populated successfully.';
GO
