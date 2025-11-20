-- =====================================================================
-- Fix: Walk-in patient sorting issue
-- Change: ORDER BY Present instead of ORDER BY PresentTime
-- =====================================================================

CREATE PROCEDURE [dbo].[GetDailyAppointmentsOptimized]
    @AppsDate DATE
AS
BEGIN
    SET NOCOUNT ON;

    CREATE TABLE #BaseAppointments (
        appointmentID INT,
        PersonID INT,
        AppDetail NVARCHAR(MAX),
        Present DATETIME,
        Seated DATETIME,
        Dismissed DATETIME,
        AppDate DATETIME,
        AppCost MONEY,
        PatientName NVARCHAR(255),
        hasActiveAlert BIT,
        PatientType NVARCHAR(255),
        apptime NVARCHAR(50),
        PresentTime NVARCHAR(50),
        SeatedTime NVARCHAR(50),
        DismissedTime NVARCHAR(50),
        HasVisit BIT
    );

    WITH VisitCheck AS (
        SELECT DISTINCT
            w.PersonID,
            vis.VisitDate
        FROM dbo.tblwork w
        INNER JOIN dbo.tblvisits vis ON w.workid = vis.WorkID
        WHERE vis.VisitDate = @AppsDate
    )
    INSERT INTO #BaseAppointments
    SELECT
        a.appointmentID,
        a.PersonID,
        a.AppDetail,
        a.Present,
        a.Seated,
        a.Dismissed,
        a.AppDate,
        a.AppCost,
        p.PatientName,
        (SELECT CAST(CASE WHEN EXISTS (
            SELECT 1
            FROM tblAlerts al
            WHERE al.PersonID = p.PersonID AND al.IsActive = 1
        ) THEN 1 ELSE 0 END AS BIT)) AS hasActiveAlert,
        pt.PatientType,
        CASE
            WHEN CAST(a.AppDate AS TIME) = '00:00:00' THEN NULL
            ELSE FORMAT(a.AppDate, N'hh\:mm tt')
        END AS apptime,
        CASE
            WHEN a.Present IS NOT NULL THEN FORMAT(a.Present, N'hh\:mm')
            ELSE NULL
        END AS PresentTime,
        CASE
            WHEN a.Seated IS NOT NULL THEN FORMAT(a.Seated, N'hh\:mm')
            ELSE NULL
        END AS SeatedTime,
        CASE
            WHEN a.Dismissed IS NOT NULL THEN FORMAT(a.Dismissed, N'hh\:mm')
            ELSE NULL
        END AS DismissedTime,
        CASE
            WHEN v.PersonID IS NOT NULL THEN 1
            ELSE 0
        END AS HasVisit
    FROM dbo.tblappointments a
    INNER JOIN dbo.tblpatients p ON a.PersonID = p.PersonID
    LEFT OUTER JOIN dbo.tblPatientType pt ON p.PatientTypeID = pt.ID
    LEFT OUTER JOIN VisitCheck v ON a.PersonID = v.PersonID
        AND CAST(a.AppDate AS DATE) = v.VisitDate
    WHERE CAST(a.AppDate AS DATE) = @AppsDate;

    -- Result Set 1: All appointments (not checked in)
    SELECT
        appointmentID,
        PersonID,
        AppDetail,
        AppDate,
        PatientType,
        PatientName,
        hasActiveAlert,
        apptime
    FROM #BaseAppointments
    WHERE Present IS NULL
    ORDER BY
        CASE
            WHEN CAST(AppDate AS TIME) = '00:00:00' THEN 1
            ELSE 0
        END,
        AppDate;

    -- Result Set 2: Checked-in appointments
    -- FIX: Changed ORDER BY from PresentTime (string) to Present (datetime)
    SELECT
        appointmentID,
        PersonID,
        AppDetail,
        PresentTime,
        SeatedTime,
        DismissedTime,
        AppDate,
        AppCost,
        apptime,
        PatientType,
        PatientName,
        hasActiveAlert,
        HasVisit
    FROM #BaseAppointments
    WHERE Present IS NOT NULL
    ORDER BY Present;  -- FIXED: Was PresentTime, now Present for chronological sorting

    -- Result Set 3: Statistics
    SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN Present IS NOT NULL THEN 1 ELSE 0 END) AS checkedIn,
        SUM(CASE WHEN Present IS NOT NULL AND Seated IS NULL AND Dismissed IS NULL THEN 1 ELSE 0 END) AS waiting,
        SUM(CASE WHEN Dismissed IS NOT NULL THEN 1 ELSE 0 END) AS completed
    FROM #BaseAppointments;

    DROP TABLE #BaseAppointments;

END
GO
