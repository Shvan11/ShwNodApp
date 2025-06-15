-- Updated GetNewAppointmentMessage stored procedure
-- Now includes CountryCode support for consistent phone number formatting
-- Date: 2025-06-15

USE [ShwanNew]
GO

ALTER PROCEDURE [dbo].[GetNewAppointmentMessage]
    @PersonID INT,
    @AppointmentID INT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @AppDate DATE;
    DECLARE @AppDateTime AS DATETIME2(0);
    DECLARE @PatientName NVARCHAR(255);
    DECLARE @FirstName NVARCHAR(255);
    DECLARE @Phone NVARCHAR(255);
    DECLARE @CountryCode NVARCHAR(5);
    DECLARE @Language TINYINT;
    DECLARE @Message NVARCHAR(MAX);
    DECLARE @ArabicDayName NVARCHAR(50);
    DECLARE @EnglishDayName NVARCHAR(50);
    DECLARE @DD SMALLINT;
    DECLARE @FormattedPhone NVARCHAR(255);

    -- Fetch patient and appointment data
    SELECT 
        @PatientName = p.PatientName,
        @FirstName = p.FirstName,
        @Phone = p.Phone,
        @CountryCode = COALESCE(p.CountryCode, '964'), -- Default to Iraq if NULL
        @Language = COALESCE(p.Language, 0),
        @AppDate = a.AppDay,
        @AppDateTime = a.AppDate
    FROM dbo.tblpatients p
    INNER JOIN dbo.tblappointments a ON p.PersonID = a.PersonID
    WHERE p.PersonID = @PersonID AND a.appointmentID = @AppointmentID;

    -- Validation: missing record
    IF @PatientName IS NULL
    BEGIN
        SELECT -1 AS Result, 'Patient or appointment not found' AS Message, NULL AS Phone;
        RETURN;
    END

    -- Validation: phone number format
    IF @Phone IS NULL 
        OR LEN(LTRIM(RTRIM(@Phone))) = 0 
        OR @Phone LIKE '%[^0-9+]%' 
        OR @Phone NOT LIKE '%[0-9]%'
    BEGIN
        SELECT -2 AS Result, 'Invalid phone number' AS Message, NULL AS Phone;
        RETURN;
    END

    -- Format phone number consistently: CountryCode + LocalNumber
    -- Remove any existing country code prefixes and normalize
    SET @Phone = LTRIM(RTRIM(@Phone));
    
    -- Handle different phone number formats
    IF @Phone LIKE '+' + @CountryCode + '%'
    BEGIN
        -- Already has country code with +: +9647XXXXXXXX -> 9647XXXXXXXX
        SET @FormattedPhone = SUBSTRING(@Phone, 2, LEN(@Phone));
    END
    ELSE IF @Phone LIKE '00' + @CountryCode + '%'
    BEGIN
        -- Has 00 prefix: 009647XXXXXXXX -> 9647XXXXXXXX
        SET @FormattedPhone = SUBSTRING(@Phone, 3, LEN(@Phone));
    END
    ELSE IF @Phone LIKE @CountryCode + '%'
    BEGIN
        -- Already has country code: 9647XXXXXXXX -> 9647XXXXXXXX
        SET @FormattedPhone = @Phone;
    END
    ELSE IF @Phone LIKE '0%'
    BEGIN
        -- Local format with 0: 07XXXXXXXX -> 9647XXXXXXXX
        SET @FormattedPhone = @CountryCode + SUBSTRING(@Phone, 2, LEN(@Phone));
    END
    ELSE
    BEGIN
        -- Assume local number without 0: 7XXXXXXXX -> 9647XXXXXXXX
        SET @FormattedPhone = @CountryCode + @Phone;
    END

    -- Compute relative day
    SET @DD = DATEDIFF(DAY, CAST(GETDATE() AS DATE), @AppDate);
    SET @ArabicDayName = dbo.ArabicDay(@AppDate);
    SET @EnglishDayName = DATENAME(dw, @AppDate);

    -- Construct message
    IF @Language = 1 -- English
    BEGIN
        IF @DD = 1
            SET @Message = N'Hello ' + COALESCE(@FirstName, @PatientName) +
                          N'. Tomorrow "' + @EnglishDayName +
                          N'" is your appointment with Dr. Shwan orthodontic clinic at ' + FORMAT(@AppDateTime, 'h:mm tt');
        ELSE IF @DD = 2
            SET @Message = N'Hello ' + COALESCE(@FirstName, @PatientName) +
                          N'. The day after tomorrow "' + @EnglishDayName +
                          N'" is your appointment with Dr. Shwan orthodontic clinic at ' + FORMAT(@AppDateTime, 'h:mm tt');
        ELSE
            SET @Message = N'Hello ' + COALESCE(@FirstName, @PatientName) +
                          N'. Your appointment with Dr. Shwan orthodontic clinic is on ' +
                          @EnglishDayName + ' ' + FORMAT(@AppDate, 'dd/MM/yyyy') +
                          ' at ' + FORMAT(@AppDateTime, 'h:mm tt');
    END
    ELSE -- Arabic
    BEGIN
        IF @DD = 1
            SET @Message = N'السلام عليك ' + @PatientName +
                          N'. غدا ' + @ArabicDayName +
                          N' موعدك مع عيادة د.شوان لتقويم الاسنان الساعة ' + FORMAT(@AppDateTime, 'h:mm');
        ELSE IF @DD = 2
            SET @Message = N'السلام عليك ' + @PatientName +
                          N'. بعد غد ' + @ArabicDayName +
                          N' موعدك مع عيادة د.شوان لتقويم الاسنان الساعة ' + FORMAT(@AppDateTime, 'h:mm');
        ELSE
            SET @Message = N'السلام عليك ' + @PatientName +
                          N'. موعدك مع عيادة د.شوان لتقويم الاسنان يوم ' +
                          @ArabicDayName + ' ' + FORMAT(@AppDate, 'dd/MM/yyyy') +
                          ' الساعة ' + FORMAT(@AppDateTime, 'h:mm');
    END

    -- Final output with consistently formatted phone number
    SELECT 
        0 AS Result,
        @FormattedPhone AS Phone,
        @Message AS Message,
        @CountryCode AS CountryCode;
END
GO