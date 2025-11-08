/**
 * Script to fix calendar timezone issue by modifying ProcWeeklyCalendarOptimized
 * to return datetime values as strings instead of datetime objects
 */

import { executeQuery, TYPES } from '../services/database/index.js';

const alterProcedureSQL = `
ALTER PROCEDURE [dbo].[ProcWeeklyCalendarOptimized]
    @StartDate DATE,
    @EndDate DATE,
    @DoctorID INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        -- Return datetime as formatted string to avoid timezone conversion
        CONVERT(VARCHAR(23), tc.AppDate, 121) AS SlotDateTime,
        CONVERT(VARCHAR(10), CAST(tc.AppDate AS DATE), 23) AS CalendarDate,
        DATENAME(WEEKDAY, tc.AppDate) AS DayName,
        DATEPART(WEEKDAY, tc.AppDate) AS DayOfWeek,
        ISNULL(ta.appointmentID, 0) AS appointmentID,
        ISNULL(ta.AppDetail, '') AS AppDetail,
        ISNULL(ta.DrID, 0) AS DrID,
        ISNULL(tp.PatientName, '') AS PatientName,
        ISNULL(ta.PersonID, 0) AS PersonID,
        CASE
            WHEN EXISTS (
                SELECT 1
                FROM tblappointments ta_check
                WHERE ta_check.AppDate = tc.AppDate
                AND (@DoctorID IS NULL OR ta_check.DrID = @DoctorID)
            ) THEN 'booked'
            WHEN tc.AppDate < GETDATE() THEN 'past'
            ELSE 'available'
        END AS SlotStatus,
        (SELECT COUNT(*)
         FROM tblappointments ta_count
         WHERE ta_count.AppDate = tc.AppDate
         AND (@DoctorID IS NULL OR ta_count.DrID = @DoctorID)
        ) AS AppointmentCount
    FROM tblcalender tc
    LEFT JOIN tblappointments ta ON tc.AppDate = ta.AppDate
        AND (@DoctorID IS NULL OR ta.DrID = @DoctorID)
    LEFT JOIN tblpatients tp ON ta.PersonID = tp.PersonID
    WHERE tc.AppDate >= @StartDate
        AND tc.AppDate < DATEADD(DAY, 1, @EndDate)
        AND DATEPART(WEEKDAY, tc.AppDate) != 6
    ORDER BY tc.AppDate, ta.appointmentID;
END
`;

async function fixCalendarTimezone() {
    try {
        console.log('🔧 Fixing calendar timezone issue...');
        console.log('📝 Altering ProcWeeklyCalendarOptimized to return datetime as string...');

        await executeQuery(alterProcedureSQL, []);

        console.log('✅ Procedure altered successfully!');
        console.log('🎉 Calendar timezone issue fixed');

        process.exit(0);
    } catch (error) {
        console.error('❌ Error fixing calendar timezone:', error);
        process.exit(1);
    }
}

fixCalendarTimezone();
