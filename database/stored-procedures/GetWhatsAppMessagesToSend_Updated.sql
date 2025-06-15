-- Updated GetWhatsAppMessagesToSend stored procedure
-- Now includes CountryCode support for consistent phone number formatting
-- Date: 2025-06-15

USE [ShwanNew]
GO

ALTER PROCEDURE [dbo].[GetWhatsAppMessagesToSend]
    @ADate as date
AS
BEGIN
    SET NOCOUNT ON;
    
    -- Calculate day difference
    DECLARE @DD as SMALLINT;
    SET @DD = DATEDIFF(day, CAST(getdate() AS date), @ADate);
    
    -- Return early if date is not tomorrow or day after tomorrow
    IF @DD NOT IN (1, 2)
        RETURN -1;
    
    -- Prepare message templates
    DECLARE @A_Mes as NVARCHAR(max);
    DECLARE @E_Mes as NVARCHAR(max);
    DECLARE @ArabicDayName as NVARCHAR(50) = dbo.ArabicDay(@ADate);
    DECLARE @EnglishDayName as NVARCHAR(50) = DATENAME(dw, @ADate);
    
    -- Set messages based on day difference
    IF @DD = 1
    BEGIN
        SET @A_Mes = N'غدا ' + @ArabicDayName + N' موعدك مع عيادة د.شوان لتقويم الاسنان الساعة';
        SET @E_Mes = N'Tomorrow "' + @EnglishDayName + N'" is your appointment with Dr. Shwan orthodontic clinic at';
    END
    ELSE -- @DD = 2
    BEGIN
        SET @A_Mes = N'بعد غد ' + @ArabicDayName + N' موعدك مع عيادة د.شوان لتقويم الاسنان الساعة';
        SET @E_Mes = N'The day after tomorrow "' + @EnglishDayName + N'" is your appointment with Dr. Shwan orthodontic clinic at';
    END
    
    -- Get appointments with validated and consistently formatted phone numbers
    SELECT
        a.appointmentID,
        -- Consistently format phone number: CountryCode + LocalNumber
        CASE 
            WHEN p.Phone LIKE '+' + COALESCE(p.CountryCode, '964') + '%' THEN
                -- Already has country code with +: +9647XXXXXXXX -> 9647XXXXXXXX
                SUBSTRING(p.Phone, 2, LEN(p.Phone))
            WHEN p.Phone LIKE '00' + COALESCE(p.CountryCode, '964') + '%' THEN
                -- Has 00 prefix: 009647XXXXXXXX -> 9647XXXXXXXX
                SUBSTRING(p.Phone, 3, LEN(p.Phone))
            WHEN p.Phone LIKE COALESCE(p.CountryCode, '964') + '%' THEN
                -- Already has country code: 9647XXXXXXXX -> 9647XXXXXXXX
                p.Phone
            WHEN p.Phone LIKE '0%' THEN
                -- Local format with 0: 07XXXXXXXX -> 9647XXXXXXXX
                COALESCE(p.CountryCode, '964') + SUBSTRING(p.Phone, 2, LEN(p.Phone))
            ELSE
                -- Assume local number without 0: 7XXXXXXXX -> 9647XXXXXXXX
                COALESCE(p.CountryCode, '964') + p.Phone
        END AS Phone,
        p.PatientName,
        CASE
            WHEN p.Language = 1 THEN
                N'Hello ' + COALESCE(p.FirstName, p.PatientName) + N'. ' + @E_Mes + N' ' + format(a.AppDate, 'h:mm')
            ELSE -- Default to Arabic (Language = 0, NULL, or any other value)
                N'السلام عليك ' + p.PatientName + N'. ' + @A_Mes + N' ' + format(a.AppDate, 'h:mm')
        END AS message,
        a.AppTime,
        COALESCE(p.CountryCode, '964') AS CountryCode
    FROM dbo.tblpatients p
    INNER JOIN dbo.tblappointments a ON p.PersonID = a.PersonID
    WHERE a.AppDay = @ADate
        AND a.WantWa = 1
        AND COALESCE(a.Notified, 0) = 0
        AND COALESCE(a.SentWa, 0) = 0
        -- Validate phone numbers
        AND p.Phone IS NOT NULL
        AND LEN(TRIM(p.Phone)) > 0
        AND p.Phone NOT LIKE '%[^0-9+]%'
        AND p.Phone LIKE '%[0-9]%'
    ORDER BY a.AppTime;
    
    -- Mark SMS as sent for this date
    UPDATE dbo.tblsms 
    SET [smssent] = 1 
    WHERE [date] = @ADate;
END
GO