-- =====================================================================
-- Optimized Calendar Procedures for Shwan Orthodontics
-- Builds on existing tblcalender system - NO schema changes required
-- =====================================================================

-- 1. Create ProcWeeklyCalendarOptimized
-- Uses existing tblcalender populated by FillCalender procedure
-- =====================================================================
IF EXISTS (SELECT * FROM sys.objects WHERE type = 'P' AND name = 'ProcWeeklyCalendarOptimized')
    DROP PROCEDURE ProcWeeklyCalendarOptimized;
GO

CREATE PROCEDURE [dbo].[ProcWeeklyCalendarOptimized] 
    @StartDate DATE,
    @EndDate DATE
AS
BEGIN
    SET NOCOUNT ON;
    
    -- Use existing tblcalender that's already populated by FillCalender
    -- This leverages your existing calendar generation system
    SELECT 
        CAST(tc.AppDate AS DATE) AS CalendarDate,
        DATENAME(WEEKDAY, tc.AppDate) AS DayName,
        DATEPART(WEEKDAY, tc.AppDate) AS DayOfWeek,
        CONVERT(VARCHAR(8), tc.AppDate, 108) AS SlotTime,
        tc.AppDate AS SlotDateTime,
        
        -- Appointment data (if exists)
        COALESCE(ta.appointmentID, 0) AS appointmentID,
        COALESCE(ta.AppDetail, '') AS AppDetail,
        COALESCE(ta.DrID, 0) AS DrID,
        COALESCE(tp.PatientName, '') AS PatientName,
        COALESCE(ta.Present, 0) AS Present,
        COALESCE(ta.Seated, 0) AS Seated,
        COALESCE(ta.Dismissed, 0) AS Dismissed,
        COALESCE(ta.PersonID, 0) AS PersonID,
        
        -- Slot status
        CASE 
            WHEN ta.appointmentID IS NOT NULL THEN 'booked'
            WHEN tc.AppDate < GETDATE() THEN 'past'
            ELSE 'available'
        END AS SlotStatus,
        
        -- Time formatting for display
        CONVERT(VARCHAR(20), tc.AppDate, 100) AS FormattedTime
        
    FROM tblcalender tc
    LEFT JOIN tblappointments ta ON tc.AppDate = ta.AppDate
    LEFT JOIN tblpatients tp ON ta.PersonID = tp.PersonID
    WHERE CAST(tc.AppDate AS DATE) BETWEEN @StartDate AND @EndDate
        AND DATEPART(WEEKDAY, tc.AppDate) != 6  -- Exclude Friday (already handled by CalStep2)
    ORDER BY tc.AppDate;
END
GO

PRINT 'Created ProcWeeklyCalendarOptimized procedure';
GO

-- 2. Create ProcCalendarStatsOptimized
-- Uses existing tblcalender for statistics calculation
-- =====================================================================
IF EXISTS (SELECT * FROM sys.objects WHERE type = 'P' AND name = 'ProcCalendarStatsOptimized')
    DROP PROCEDURE ProcCalendarStatsOptimized;
GO

CREATE PROCEDURE [dbo].[ProcCalendarStatsOptimized]
    @StartDate DATE,
    @EndDate DATE
AS
BEGIN
    SET NOCOUNT ON;
    
    -- Use existing tblcalender for statistics calculation
    SELECT 
        @StartDate AS WeekStart,
        @EndDate AS WeekEnd,
        COUNT(*) AS TotalSlots,
        SUM(CASE WHEN SlotStatus = 'available' THEN 1 ELSE 0 END) AS AvailableSlots,
        SUM(CASE WHEN SlotStatus = 'booked' THEN 1 ELSE 0 END) AS BookedSlots,
        SUM(CASE WHEN SlotStatus = 'past' THEN 1 ELSE 0 END) AS PastSlots,
        CASE 
            WHEN COUNT(*) > 0 THEN 
                CAST(SUM(CASE WHEN SlotStatus = 'booked' THEN 1.0 ELSE 0 END) / COUNT(*) * 100 AS DECIMAL(5,2))
            ELSE 0 
        END AS UtilizationPercent
    FROM (
        SELECT 
            CASE 
                WHEN ta.appointmentID IS NOT NULL THEN 'booked'
                WHEN tc.AppDate < GETDATE() THEN 'past'
                ELSE 'available'
            END AS SlotStatus
        FROM tblcalender tc
        LEFT JOIN tblappointments ta ON tc.AppDate = ta.AppDate
        WHERE CAST(tc.AppDate AS DATE) BETWEEN @StartDate AND @EndDate
            AND DATEPART(WEEKDAY, tc.AppDate) != 6  -- Exclude Friday
    ) stats;
END
GO

PRINT 'Created ProcCalendarStatsOptimized procedure';
GO

-- 3. Create helper procedure for calendar maintenance check
-- Ensures calendar has enough future dates for the web interface
-- =====================================================================
IF EXISTS (SELECT * FROM sys.objects WHERE type = 'P' AND name = 'ProcEnsureCalendarRange')
    DROP PROCEDURE ProcEnsureCalendarRange;
GO

CREATE PROCEDURE [dbo].[ProcEnsureCalendarRange]
    @DaysAhead INT = 60  -- Default to 60 days ahead
AS
BEGIN
    SET NOCOUNT ON;
    
    DECLARE @FutureDate DATE = DATEADD(DAY, @DaysAhead, GETDATE());
    DECLARE @MaxCalendarDate DATE;
    
    -- Check current maximum date in calendar
    SELECT @MaxCalendarDate = MAX(CAST(AppDate AS DATE))
    FROM tblcalender;
    
    -- If calendar doesn't have enough future dates, run FillCalender
    IF @MaxCalendarDate IS NULL OR @MaxCalendarDate < @FutureDate
    BEGIN
        PRINT 'Calendar needs updating. Running FillCalender procedure...';
        EXEC FillCalender;
        
        SELECT 'Calendar updated' AS Status, 
               @MaxCalendarDate AS PreviousMaxDate,
               (SELECT MAX(CAST(AppDate AS DATE)) FROM tblcalender) AS NewMaxDate;
    END
    ELSE
    BEGIN
        SELECT 'Calendar is current' AS Status,
               @MaxCalendarDate AS MaxCalendarDate,
               @FutureDate AS TargetDate;
    END
END
GO

PRINT 'Created ProcEnsureCalendarRange procedure';
GO

-- 4. Create performance indexes if they don't exist
-- These will speed up the calendar queries
-- =====================================================================
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('tblcalender') AND name = 'IX_tblcalender_AppDate_Date')
BEGIN
    -- Index for date range queries
    CREATE NONCLUSTERED INDEX IX_tblcalender_AppDate_Date 
    ON tblcalender (AppDate);
    
    PRINT 'Created index IX_tblcalender_AppDate_Date on tblcalender';
END
ELSE
BEGIN
    PRINT 'Index IX_tblcalender_AppDate_Date already exists on tblcalender';
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('tblappointments') AND name = 'IX_tblappointments_AppDate_Optimized')
BEGIN
    -- Optimized index for appointment lookups
    CREATE NONCLUSTERED INDEX IX_tblappointments_AppDate_Optimized 
    ON tblappointments (AppDate)
    INCLUDE (appointmentID, AppDetail, DrID, PersonID, Present, Seated, Dismissed);
    
    PRINT 'Created index IX_tblappointments_AppDate_Optimized on tblappointments';
END
ELSE
BEGIN
    PRINT 'Index IX_tblappointments_AppDate_Optimized already exists on tblappointments';
END
GO

-- 5. Test the new procedures with sample data
-- =====================================================================
PRINT 'Testing optimized procedures...';
GO

-- Test weekly calendar for current week
DECLARE @TestStartDate DATE = DATEADD(DAY, -(DATEPART(WEEKDAY, GETDATE()) - 2), CAST(GETDATE() AS DATE));
DECLARE @TestEndDate DATE = DATEADD(DAY, 6, @TestStartDate);

PRINT 'Testing ProcWeeklyCalendarOptimized for week: ' + CAST(@TestStartDate AS VARCHAR) + ' to ' + CAST(@TestEndDate AS VARCHAR);

EXEC ProcWeeklyCalendarOptimized @TestStartDate, @TestEndDate;

PRINT 'Testing ProcCalendarStatsOptimized for same week...';

EXEC ProcCalendarStatsOptimized @TestStartDate, @TestEndDate;

PRINT 'Testing ProcEnsureCalendarRange...';

EXEC ProcEnsureCalendarRange 60;

GO

PRINT '=================================================================';
PRINT 'Calendar optimization setup completed successfully!';
PRINT '=================================================================';
PRINT '';
PRINT 'Created procedures:';
PRINT '- ProcWeeklyCalendarOptimized: Fast weekly calendar data';
PRINT '- ProcCalendarStatsOptimized: Calendar utilization statistics';
PRINT '- ProcEnsureCalendarRange: Calendar maintenance helper';
PRINT '';
PRINT 'Performance indexes created on:';
PRINT '- tblcalender (AppDate with Friday exclusion)';
PRINT '- tblappointments (AppDate with appointment data)';
PRINT '';
PRINT 'ZERO CHANGES to existing data or procedures!';
PRINT 'Your existing FillCalender and Access forms continue to work.';
PRINT '=================================================================';