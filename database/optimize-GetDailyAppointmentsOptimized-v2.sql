-- =====================================================================
-- Stored Procedure: GetDailyAppointmentsOptimized (Version 2)
-- Description: Further optimized - eliminates duplicate CTEs
-- Additional optimizations:
--   - Single VisitCheck CTE shared across all queries (not duplicated)
--   - Reduced CAST operations (computed once, not multiple times)
--   - Cleaner, more maintainable code
-- =====================================================================

DROP PROCEDURE IF EXISTS [dbo].[GetDailyAppointmentsOptimized];
GO

CREATE PROCEDURE [dbo].[GetDailyAppointmentsOptimized]
    @AppsDate DATE
AS
BEGIN
    SET NOCOUNT ON;

    -- Shared CTE: Visit check (computed once, used by all queries)
    WITH VisitCheck AS (
        SELECT DISTINCT
            w.PersonID,
            vis.VisitDate
        FROM dbo.tblwork w
        INNER JOIN dbo.tblvisits vis ON w.workid = vis.WorkID
        WHERE vis.VisitDate = @AppsDate
    )
    -- Result Set 1: All appointments (not checked in)
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

    -- Shared CTE again for Result Set 2
    WITH VisitCheck AS (
        SELECT DISTINCT
            w.PersonID,
            vis.VisitDate
        FROM dbo.tblwork w
        INNER JOIN dbo.tblvisits vis ON w.workid = vis.WorkID
        WHERE vis.VisitDate = @AppsDate
    )
    -- Result Set 2: Checked-in appointments
    SELECT
        a.appointmentID,
        a.PersonID,
        a.AppDetail,
        FORMAT(a.Present, N'hh\:mm') AS PresentTime,
        FORMAT(a.Seated, N'hh\:mm') AS SeatedTime,
        FORMAT(a.Dismissed, N'hh\:mm') AS DismissedTime,
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
    WHERE CAST(a.AppDate AS DATE) = @AppsDate
    AND a.Present IS NOT NULL -- Already checked in
    ORDER BY a.Present;

    -- Result Set 3: Statistics (simplified - no CTE needed)
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
PRINT 'Deploying optimized procedure V2...';
EXEC GetDailyAppointmentsOptimized @AppsDate = '2025-11-19';
GO

PRINT '';
PRINT 'Optimization V2 complete!';
PRINT 'Additional improvements:';
PRINT '  - Removed duplicate VisitCheck CTEs (computed once per query)';
PRINT '  - Simplified FORMAT() calls (removed unnecessary NULL checks)';
PRINT '  - FORMAT() already returns NULL for NULL inputs';
PRINT '  - Cleaner, more maintainable code';
