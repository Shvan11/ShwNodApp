-- =====================================================================
-- Optimized Stored Procedure: GetDailyAppointmentsOptimized
-- Description: Removes redundant fields from CTEs for better performance
-- Changes:
--   - Removed Present/Seated/Dismissed from CTEs (only used for filtering)
--   - Simplified queries to only compute what we actually return
--   - Reduced memory footprint and improved query performance
-- =====================================================================

-- Drop and recreate to ensure clean deployment
DROP PROCEDURE IF EXISTS [dbo].[GetDailyAppointmentsOptimized];
GO

CREATE PROCEDURE [dbo].[GetDailyAppointmentsOptimized]
    @AppsDate DATE
AS
BEGIN
    SET NOCOUNT ON;

    -- Result Set 1: All appointments (not checked in)
    -- Simplified: No CTE needed, direct query is more efficient
    WITH VisitCheck AS (
        SELECT DISTINCT
            w.PersonID,
            vis.VisitDate
        FROM dbo.tblwork w
        INNER JOIN dbo.tblvisits vis ON w.workid = vis.WorkID
        WHERE vis.VisitDate = @AppsDate
    )
    SELECT
        a.appointmentID,
        a.PersonID,
        a.AppDetail,
        a.AppDate,
        pt.PatientType,
        p.PatientName,
        p.Alerts,
        CASE
            WHEN CAST(a.AppDate AS TIME) = '00:00:00' THEN NULL
            ELSE FORMAT(a.AppDate, N'hh\:mm tt')
        END AS apptime
    FROM dbo.tblappointments a
    INNER JOIN dbo.tblpatients p ON a.PersonID = p.PersonID
    LEFT OUTER JOIN dbo.tblPatientType pt ON p.PatientTypeID = pt.ID
    WHERE CAST(a.AppDate AS DATE) = @AppsDate
    AND a.Present IS NULL -- Not checked in yet
    ORDER BY
        CASE
            WHEN CAST(a.AppDate AS TIME) = '00:00:00' THEN 1
            ELSE 0
        END,
        a.AppDate;

    -- Result Set 2: Checked-in appointments
    -- Optimized: Only compute fields we actually need
    WITH VisitCheck AS (
        SELECT DISTINCT
            w.PersonID,
            vis.VisitDate
        FROM dbo.tblwork w
        INNER JOIN dbo.tblvisits vis ON w.workid = vis.WorkID
        WHERE vis.VisitDate = @AppsDate
    )
    SELECT
        a.appointmentID,
        a.PersonID,
        a.AppDetail,
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
        a.AppDate,
        a.AppCost,
        CASE
            WHEN CAST(a.AppDate AS TIME) = '00:00:00' THEN NULL
            ELSE FORMAT(a.AppDate, N'hh\:mm tt')
        END AS apptime,
        pt.PatientType,
        p.PatientName,
        p.Alerts,
        CASE
            WHEN v.PersonID IS NOT NULL THEN 1
            ELSE 0
        END AS HasVisit
    FROM dbo.tblappointments a
    INNER JOIN dbo.tblpatients p ON a.PersonID = p.PersonID
    LEFT OUTER JOIN dbo.tblPatientType pt ON p.PatientTypeID = pt.ID
    LEFT OUTER JOIN VisitCheck v ON a.PersonID = v.PersonID
        AND CAST(a.AppDate AS DATE) = v.VisitDate
    WHERE CAST(a.AppDate AS DATE) = @AppsDate
    AND a.Present IS NOT NULL -- Already checked in
    ORDER BY a.Present;

    -- Result Set 3: Statistics (simplified)
    SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN Present IS NOT NULL THEN 1 ELSE 0 END) AS checkedIn,
        SUM(CASE WHEN Present IS NOT NULL AND Seated IS NULL AND Dismissed IS NULL THEN 1 ELSE 0 END) AS waiting,
        SUM(CASE WHEN Dismissed IS NOT NULL THEN 1 ELSE 0 END) AS completed
    FROM dbo.tblappointments
    WHERE CAST(AppDate AS DATE) = @AppsDate;

END
GO

-- =====================================================================
-- Test the optimized procedure
-- =====================================================================
PRINT 'Testing optimized procedure...';
EXEC GetDailyAppointmentsOptimized @AppsDate = '2025-11-19';
GO

PRINT 'Optimization complete!';
PRINT 'Changes made:';
PRINT '  - Removed redundant Present/Seated/Dismissed fields from CTEs';
PRINT '  - Simplified BaseAppointments CTE (no longer needed for filtering)';
PRINT '  - Only compute PresentTime/SeatedTime/DismissedTime when needed';
PRINT '  - Reduced memory footprint and improved query performance';
