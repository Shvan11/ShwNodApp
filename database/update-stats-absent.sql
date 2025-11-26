-- =====================================================================
-- Update Statistics to show Absent instead of Completed
-- This updates the GetDailyAppointmentsOptimized stored procedure
-- =====================================================================

USE [ShwanOrthodontics]
GO

-- Update the stored procedure
IF OBJECT_ID('dbo.GetDailyAppointmentsOptimized', 'P') IS NOT NULL
    DROP PROCEDURE dbo.GetDailyAppointmentsOptimized;
GO

-- Run the updated stored procedure creation script
:r ./stored-procedures/GetDailyAppointmentsOptimized.sql
GO

PRINT 'Statistics updated: Absent stat now replaces Completed stat';
PRINT 'Stats returned: total, checkedIn, absent, waiting';
GO
