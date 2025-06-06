USE [ShwanNew]
GO
/****** Object:  StoredProcedure [dbo].[AddDolph]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE PROCEDURE  [dbo].[AddDolph] @FN varchar(50),@LN varchar(50),@BD datetime, @ID Varchar(50), @Ge Char(1)
	-- Add the parameters for the stored procedure here
	
AS
BEGIN
	-- SET NOCOUNT ON added to prevent extra result sets from
	-- interfering with SELECT statements.
	SET NOCOUNT ON;

    -- Insert statements for procedure here
	--SELECT <@Param1, sysname, @p1>, <@Param2, sysname, @p2>
	INSERT INTO [DolphinPlatform].dbo.[Patients]
           ([patFirstName]
           ,[patLastName]
           ,[patBirthdate]
           ,[patOtherID]
		   ,[patGender]
		   ,[patName]
		   ,[patIndexName]
		   ,[patStatusID]
		   ,[normID]
		   ,patEntryDate
		   ,patNorm
           )
     VALUES
           (@FN,
		   @LN,
		   @BD,
		   @ID,
		   @Ge,
		   @FN + ' ' + @LN,
		   @LN + ', ' + @FN,
		   cast('6F583B65-1EC9-4F02-B2E4-37CD8318C695' as uniqueidentifier),
		   cast('6F999E7E-D010-4C44-961B-14C66A322ACF' as uniqueidentifier),
		   GETDATE(),
		   0
		    )
          
Select @@ROWCOUNT As Added
END
GO
/****** Object:  StoredProcedure [dbo].[AddTimePoint]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE PROCEDURE [dbo].[AddTimePoint]
@ID VarChar(50), @TPName Varchar(50), @TPDate DateTime
AS
BEGIN
SET NOCOUNT ON;

Declare @PatID UniqueIdentifier, @Pos int

Set @PatID = (Select P.PatID from DolphinPlatform.dbo.Patients P Where P.patOtherID = @ID)
Set @Pos = isnull((Select (Max(Cast(tpcode as int))+1) from DolphinPlatform.dbo.TimePoints as T Where T.PatID = @PatID),0)
    Begin Transaction
	Insert into DolphinPlatform.dbo.TimePoints
	([tpCode],[tpDescription],[patID],[tpDateTime])
	Values
	(Cast(@Pos as Varchar(12)),@TPName,@PatID,@TPDate)

	if @TPName = 'Initial'
	Begin
	Declare @IPD as date
	set @IPD = (Select W.IPhotoDate from ShwanNew.dbo.tblwork W Where W.PersonID = @ID and Finished = 0)
	
	if @IPD is null
	Begin
	Update ShwanNew.dbo.tblwork 
	set  IPhotoDate =  @TPDate
	Where PersonID = @ID and Finished = 0
	End

	else if @IPD is not null and @IPD <> @TPDate 
	Begin
	;THROW 51000, '_There is a conflict. Please correct initial photos date.', 1;  
	Rollback Transaction
	Return
	END  
	
	
	End

		if @TPName = 'Final'
	Begin
	Declare @FPD as date
	set @FPD = (Select W.FPhotoDate from ShwanNew.dbo.tblwork W Where W.PersonID = @ID and Finished = 0)
	
	if @fpd is null
	 Begin
	 	Update ShwanNew.dbo.tblwork 
	set  FPhotoDate =  @TPDate
	Where PersonID = @ID and Finished = 0 
	End

	else if @FPD is not null and @FPD <> @TPDate 
	Begin
	;THROW 51000, '_There is a conflict. Please correct final photos date.', 1; 
	Rollback Transaction
	Return
	END  
	

	End

	select @Pos as MyTP
	Commit Transaction
END

GO
/****** Object:  StoredProcedure [dbo].[AllTodayApps]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE procedure [dbo].[AllTodayApps] @AppsDate date as
SELECT        dbo.tblappointments.appointmentID, dbo.tblappointments.PersonID, dbo.tblappointments.AppDetail, 
dbo.tblappointments.AppDate, dbo.tblPatientType.PatientType  ,dbo.tblpatients.PatientName, dbo.tblpatients.Alerts, 
Format(dbo.tblappointments.AppDate,N'hh\:mm') as apptime 
FROM            dbo.tblappointments INNER JOIN
                         dbo.tblpatients ON dbo.tblappointments.PersonID = dbo.tblpatients.PersonID left outer join
						 dbo.tblPatientType on dbo.tblpatients.PatientTypeID = dbo.tblPatientType.ID
where cast( dbo.tblappointments.AppDate as date) = @appsdate and dbo.tblappointments.Present is null
order by dbo.tblappointments.AppDate
GO
/****** Object:  StoredProcedure [dbo].[ApposforOne]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE procedure [dbo].[ApposforOne] @ID int as
SELECT        cast( dbo.tblappointments.AppDate as date) As AppDate
                      
FROM            dbo.tblappointments
where PersonID = @ID
order by AppDate
 
GO
/****** Object:  StoredProcedure [dbo].[CheckDate]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE PROCEDURE [dbo].[CheckDate] 
	-- Add the parameters for the stored procedure here
	@Col Varchar(50), @ID Int
AS
BEGIN
	-- SET NOCOUNT ON added to prevent extra result sets from
	-- interfering with SELECT statements.
	SET NOCOUNT ON;
	Declare @Sql Nvarchar(4000) 
	set @sql = 'if exists (Select PersonID from dbo.tblwork where PersonID = ' + cast(@Id as varchar(100)) +
	'and ' + @Col + ' is null and Finished = 0)' +
    'Begin
	select 0 As result
	End
	else 
	Begin
	select 1 as result
	end'
	execute sp_executesql @sql
    -- Insert statements for procedure here
	

END
GO
/****** Object:  StoredProcedure [dbo].[CheckDolphin]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE PROCEDURE [dbo].[CheckDolphin] @id varchar(50)
--@id varchar(50) 
	-- Add the parameters for the stored procedure here

AS
BEGIN
	-- SET NOCOUNT ON added to prevent extra result sets from
	-- interfering with SELECT statements.
	SET NOCOUNT ON;

    -- Insert statements for procedure here
	SELECT top 1 patOtherID from DolphinPlatform.dbo.Patients 
	where patOtherID = @id
END
GO
/****** Object:  StoredProcedure [dbo].[ChkTimePoint]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE PROCEDURE [dbo].[ChkTimePoint]
@ID VarChar(50), @TPName Varchar(50), @TPDate DateTime
AS
BEGIN
SET NOCOUNT ON;

Declare @PatID UniqueIdentifier

Set @PatID = (Select P.PatID from DolphinPlatform.dbo.Patients P Where P.patOtherID = @ID)

    
	--if exists(select [tpDateTime] from DolphinPlatform.dbo.TimePoints T where
	--[tpDateTime] = @TPDate and [patID] = @PatID)
	--Select 0 as Result
	--else
	--Select 1 as Result
	Select
	isnull ((Select cast(tpcode as int) from DolphinPlatform.dbo.TimePoints as T Where T.PatID = @PatID
	and T.tpDescription = @TPName and [tpDateTime] = @TPDate),-1)
	as Result
END
GO
/****** Object:  StoredProcedure [dbo].[Daily]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE Procedure [dbo].[Daily] @Month int, @Year int as
SELECT        Day(dbo.tblInvoice.Dateofpayment) As Day, Sum(dbo.tblInvoice.Amountpaid) As Sum, Currency
FROM            dbo.tblInvoice INNER JOIN
                         dbo.tblwork ON dbo.tblInvoice.workid = dbo.tblwork.workid
Where Month(dbo.tblInvoice.Dateofpayment) = @Month and Year(dbo.tblInvoice.Dateofpayment) = @Year
Group By Day(dbo.tblInvoice.Dateofpayment), Currency
Order By Day
GO
/****** Object:  StoredProcedure [dbo].[DailyUSD]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
Create Procedure [dbo].[DailyUSD] @Month int, @Year int as
SELECT        Sum(dbo.tblInvoice.Amountpaid) As Sum, Day(dbo.tblInvoice.Dateofpayment) As Day
FROM            dbo.tblInvoice INNER JOIN
                         dbo.tblwork ON dbo.tblInvoice.workid = dbo.tblwork.workid
Where Currency = 'USD' and Month(dbo.tblInvoice.Dateofpayment) = @Month and Year(dbo.tblInvoice.Dateofpayment) = @Year
Group By Day(dbo.tblInvoice.Dateofpayment)
Order By Day
GO
/****** Object:  StoredProcedure [dbo].[DelDolph]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE PROCEDURE  [dbo].[DelDolph] @ID Varchar(50)
	-- Add the parameters for the stored procedure here
	
AS
BEGIN
	-- SET NOCOUNT ON added to prevent extra result sets from
	-- interfering with SELECT statements.
	SET NOCOUNT ON;

    -- Insert statements for procedure here
	--SELECT <@Param1, sysname, @p1>, <@Param2, sysname, @p2>
	Declare @PatId as uniqueidentifier
          set @PatId = (Select P.PatID from DolphinPlatform.dbo.Patients as P Where P.patOtherID = @ID)

		  DELETE FROM [DolphinPlatform].dbo.[TimePoints]   Where patid = @PatId
		   DELETE FROM [DolphinPlatform].dbo.[Patients]  Where patid = @PatId


Select @@ROWCOUNT As Deleted
END
GO
/****** Object:  StoredProcedure [dbo].[FillCalender]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================


CREATE PROCEDURE [dbo].[FillCalender] 
AS  
BEGIN  
    -- SET NOCOUNT ON added to prevent extra result sets from  
    -- interfering with SELECT statements.  
    SET NOCOUNT ON;  
  
    -- Insert statements for procedure here  
  delete dbo.tblcalender where AppDate < CONVERT(date, getdate());

	Insert into dbo.tblCalender (AppDate)
Select Vf.MyDates
From dbo.VfillCal Vf
where not exists( select * from tblCalender where tblCalender.AppDate = Vf.MyDates)

select @@ROWCOUNT As DaysAdded
END
GO
/****** Object:  StoredProcedure [dbo].[FindName]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE procedure [dbo].[FindName] @PID as int
AS
select dbo.tblpatients.patientName 
from dbo.tblpatients
where PersonID = @PID
GO
/****** Object:  StoredProcedure [dbo].[GetLast]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE Procedure [dbo].[GetLast] @PID as Int
As
select AppointmentID, PersonID, Appdate
from VLastApp
where PersonID = @PID
GO
/****** Object:  StoredProcedure [dbo].[GetMessageStatusAnalytics]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE PROCEDURE [dbo].[GetMessageStatusAnalytics]
    @StartDate date,
    @EndDate date
AS
BEGIN
    SET NOCOUNT ON;
    
    -- Overall statistics
    SELECT
        COUNT(*) AS TotalMessages,
        SUM(CASE WHEN SentWa = 1 THEN 1 ELSE 0 END) AS SentCount,
        SUM(CASE WHEN DeliveredWA = 'READ' THEN 1 ELSE 0 END) AS ReadCount,
        SUM(CASE WHEN DeliveredWA = 'DEVICE' THEN 1 ELSE 0 END) AS DeliveredCount,
        SUM(CASE WHEN DeliveredWA = 'SERVER' THEN 1 ELSE 0 END) AS ServerCount,
        SUM(CASE WHEN DeliveredWA = 'ERROR' THEN 1 ELSE 0 END) AS ErrorCount,
        CAST(SUM(CASE WHEN DeliveredWA = 'READ' THEN 1 ELSE 0 END) * 100.0 / 
             NULLIF(SUM(CASE WHEN SentWa = 1 THEN 1 ELSE 0 END), 0) AS DECIMAL(5,2)) AS ReadPercentage
    FROM dbo.tblappointments
    WHERE AppDay BETWEEN @StartDate AND @EndDate
      AND WantWa = 1;
    
    -- Daily breakdown
    SELECT
        AppDay,
        COUNT(*) AS TotalMessages,
        SUM(CASE WHEN SentWa = 1 THEN 1 ELSE 0 END) AS SentCount,
        SUM(CASE WHEN DeliveredWA = 'READ' THEN 1 ELSE 0 END) AS ReadCount,
        CAST(SUM(CASE WHEN DeliveredWA = 'READ' THEN 1 ELSE 0 END) * 100.0 / 
             NULLIF(SUM(CASE WHEN SentWa = 1 THEN 1 ELSE 0 END), 0) AS DECIMAL(5,2)) AS ReadPercentage
    FROM dbo.tblappointments
    WHERE AppDay BETWEEN @StartDate AND @EndDate
      AND WantWa = 1
    GROUP BY AppDay
    ORDER BY AppDay;
END
GO
/****** Object:  StoredProcedure [dbo].[GetMessageStatusByDate]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE PROCEDURE [dbo].[GetMessageStatusByDate]
    @Date date
AS
BEGIN
    SET NOCOUNT ON;
    
    SELECT 
        a.appointmentID,
        p.PatientName,
        p.Phone,
        a.SentWa,
        a.DeliveredWA,
        a.WaMessageID,
        a.SentTimestamp,
        a.LastUpdated
    FROM dbo.tblappointments a
    JOIN dbo.tblpatients p ON a.PersonID = p.PersonID
    WHERE CONVERT(date, a.AppDay) = @Date
    ORDER BY a.AppTime;
END
GO
/****** Object:  StoredProcedure [dbo].[GetWhatsAppMessagesToSend]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

  CREATE PROCEDURE [dbo].[GetWhatsAppMessagesToSend]
      @ADate as date
  AS
  BEGIN
      SET NOCOUNT ON;

      -- Generate messages as in original ProcWhatsApp but with better performance
      DECLARE @DD as SMALLINT;
      DECLARE @A_Mes as NVARCHAR(max);
      DECLARE @E_Mes as NVARCHAR(max);
      DECLARE @Message1 as NVARCHAR(max) =  'غدا' + ' ' + dbo.ArabicDay(@ADate) +  ' ' + 'موعدك مع
  عيادة د.شوان لتقويم الاسنان الساعة';
      DECLARE @Message2 as NVARCHAR(max) = 'بعد غد' + ' ' + dbo.ArabicDay(@ADate) + ' ' + 'موعدك مع
  عيادة د.شوان لتقويم الاسنان الساعة';
      DECLARE @Message3 as NVARCHAR(max) ='Tommorow "' + DATENAME(dw,@ADate) +'" is your appointment        
  with Dr. Shwan orthodontic clinic at ';
      DECLARE @Message4 as NVARCHAR(max) ='The day after tommorow "' + DATENAME(dw,@ADate) +'" is your      
  appointment with Dr. Shwan orthodontic clinic at ';

      SET @DD = DATEDIFF(day,CAST(getdate() AS date) ,@ADate);

      IF @DD < 0 OR @DD > 3
          RETURN -1;

      SET @A_Mes = CASE
          WHEN @DD = 1 THEN @Message1
          WHEN @DD = 2 THEN @Message2
      END;

      SET @E_Mes = CASE
          WHEN @DD = 1 THEN @Message3
          WHEN @DD = 2 THEN @Message4
          ELSE @Message3
      END;

      -- Get appointments with phone number validation
      SELECT
          dbo.tblappointments.appointmentID,
          '964' + dbo.tblpatients.Phone AS Phone,
          dbo.tblpatients.PatientName,
          CASE
              WHEN dbo.tblpatients.Language = 0 THEN
                  'السلام عليك' + ' ' + dbo.tblpatients.PatientName + '. ' + @A_Mes + ' ' +
  format(dbo.tblappointments.AppTime, 'h:mm')
              WHEN dbo.tblpatients.Language = 1 THEN
                  'Hello ' + dbo.tblpatients.FirstName + '. ' + @E_Mes + ' ' +
  format(dbo.tblappointments.AppTime, 'h:mm')
          END AS message,
          dbo.tblappointments.AppTime
      FROM dbo.tblpatients
      INNER JOIN dbo.tblappointments ON dbo.tblpatients.PersonID = dbo.tblappointments.PersonID
      WHERE (dbo.tblappointments.AppDay = @ADate)
          AND (dbo.tblappointments.WantWa = 1)
          AND (dbo.tblappointments.Notified = 0 OR dbo.tblappointments.Notified IS NULL)
          AND (dbo.tblappointments.SentWa = 0 OR dbo.tblappointments.SentWa IS NULL)
          -- ADDED: Filter out patients without valid phone numbers
          AND (dbo.tblpatients.Phone IS NOT NULL)
          AND (LEN(TRIM(dbo.tblpatients.Phone)) > 0)
          AND (dbo.tblpatients.Phone NOT LIKE '%[^0-9+]%')
          AND (dbo.tblpatients.Phone LIKE '%[0-9]%')
      ORDER BY dbo.tblappointments.AppTime;

      -- Mark SMS as sent as in original procedure
      UPDATE dbo.tblsms SET [smssent] = 1 WHERE [date] = @ADate;
  END
GO
/****** Object:  StoredProcedure [dbo].[IncomeDrDetails]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE PROCEDURE [dbo].[IncomeDrDetails]
	-- Add the parameters for the stored procedure here
	@Start  date,
@End date,
@DrID int,
@cur nvarchar(255)
AS
BEGIN
	-- SET NOCOUNT ON added to prevent extra result sets from
	-- interfering with SELECT statements.
	SET NOCOUNT ON;

   SELECT @start as startd,  @end as endd,@DrId as DrID, @cur as cur, i.Amountpaid , i.Dateofpayment,w.Typeofwork, p.PatientName
FROM  dbo.tblInvoice i INNER JOIN
         dbo.tblwork w ON i.workid = w.workid inner join dbo.tblpatients p on w.PersonID = p.PersonID
WHERE (w.Currency = @cur) and (i.Dateofpayment  > = @Start) and (i.Dateofpayment <= @End)
and (DrID = @DrID)
END
GO
/****** Object:  StoredProcedure [dbo].[ListDolphTimePoints]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE PROCEDURE [dbo].[ListDolphTimePoints]
@ID VarChar(50)
AS
BEGIN
SET NOCOUNT ON;

Declare @PatID UniqueIdentifier

Set @PatID = (Select P.PatID from DolphinPlatform.dbo.Patients P Where P.patOtherID = @ID)
Select T.tpCode,T.tpDateTime,T.tpDescription from DolphinPlatform.dbo.TimePoints as T Where T.PatID = @PatID
order by cast(T.tpCode as int)
END

GO
/****** Object:  StoredProcedure [dbo].[ListTimePointImgs]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
Create PROCEDURE [dbo].[ListTimePointImgs]
@ID VarChar(50),
@tpCode VarChar(12)
AS
BEGIN
SET NOCOUNT ON;
Declare @tpID UniqueIdentifier
Declare @PatID UniqueIdentifier

Set @PatID = (Select P.PatID from DolphinPlatform.dbo.Patients P Where P.patOtherID = @ID);
Set @tpID = (Select t.tpID from DolphinPlatform.dbo.TimePoints t Where t.patID = @PatID and t.tpCode = @tpCode);
Select I.tpiImageType from DolphinPlatform.dbo.TimePointImages  I Where I.tpID = @tpID;
END

GO
/****** Object:  StoredProcedure [dbo].[NulPresent]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE procedure [dbo].[NulPresent] 
@Aid as int,
@state as varchar(100)
As
Begin
declare @Sql Nvarchar(4000) 
 SET @SQL = 'UPDATE tblappointments SET ' + @state + ' = null where
 AppointmentID = ' + cast(@Aid as varchar(10)) 
 execute sp_executesql @sql
 End
GO
/****** Object:  StoredProcedure [dbo].[PresentTodayApps]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE procedure [dbo].[PresentTodayApps] @AppsDate date as
SELECT        dbo.tblappointments.appointmentID, dbo.tblappointments.PersonID, dbo.tblappointments.AppDetail, format(dbo.tblappointments.Present,N'hh\:mm') as Present, 
Format(dbo.tblappointments.Seated,N'hh\:mm') as Seated, Format(dbo.tblappointments.Dismissed,N'hh\:mm') As Dismissed,
dbo.tblappointments.AppDate,dbo.tblappointments.AppCost, Case when cast(dbo.tblappointments.AppDate as time) = '00:00:00' then null else
Format(dbo.tblappointments.AppDate,N'hh\:mm') End as apptime 
                        ,dbo.tblPatientType.PatientType  ,dbo.tblpatients.PatientName, dbo.tblpatients.Alerts, dbo.HasVisit(dbo.tblappointments.PersonID, dbo.tblappointments.AppDate) AS HasVisit
FROM            dbo.tblappointments INNER JOIN
                         dbo.tblpatients ON dbo.tblappointments.PersonID = dbo.tblpatients.PersonID left outer join
						 dbo.tblPatientType on dbo.tblpatients.PatientTypeID = dbo.tblPatientType.ID
where cast( dbo.tblappointments.AppDate as date) = @appsdate and dbo.tblappointments.Present is not null
order by dbo.tblappointments.Present
GO
/****** Object:  StoredProcedure [dbo].[proAddVisit]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROCEDURE [dbo].[proAddVisit]
    @WID INT,
    @visitDate DATETIME2,
    @upperWireID INT,
    @lowerWireID INT,
	@others NVARCHAR(255),
	@next NVARCHAR(255)
AS
BEGIN
    INSERT INTO [dbo].[tblvisits]
    (
        [WorkID],
        [VisitDate],
        [UpperWireID],
        [LowerWireID],
		[Others],
		[NextVisit]
    )
    VALUES
    (
        @WID,
        @visitDate,
        @upperWireID,
        @lowerWireID,
		@others,
		@next
    )
END
GO
/****** Object:  StoredProcedure [dbo].[ProAppsPhones]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO


CREATE procedure [dbo].[ProAppsPhones] @AppsDate date as
SELECT        dbo.tblappointments.appointmentID, dbo.tblappointments.PersonID, dbo.tblappointments.AppDetail, 
AppDay,
                        dbo.tblPatientType.PatientType  ,dbo.tblpatients.PatientName,dbo.tblpatients.Phone ,
						Format(dbo.tblappointments.AppDate,N'hh\:mm') as apptime , dbo.tblEmployees.employeeName
FROM            dbo.tblappointments INNER JOIN
                         dbo.tblpatients ON dbo.tblappointments.PersonID = dbo.tblpatients.PersonID left outer join
						 dbo.tblPatientType on dbo.tblpatients.PatientTypeID = dbo.tblPatientType.ID left outer join tblEmployees
						 on dbo.tblappointments.DrID = tblEmployees.ID
--where cast( dbo.tblappointments.AppDate as date) = @appsdate and dbo.tblappointments.Present is null
where AppDay = @appsdate and dbo.tblappointments.Present is null
order by dbo.tblappointments.AppDate
GO
/****** Object:  StoredProcedure [dbo].[ProcAddHoliday]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE PROCEDURE [dbo].[ProcAddHoliday]
	-- Add the parameters for the stored procedure here
	@HD as Date
AS
BEGIN
	-- SET NOCOUNT ON added to prevent extra result sets from
	-- interfering with SELECT statements.
	SET NOCOUNT ON;

Delete  dbo.tblCalender  WHERE cast(appdate as date) = @HD;

INSERT INTO tblholidays(holidaydate) VALUES(@HD); 


END
GO
/****** Object:  StoredProcedure [dbo].[ProcAddSpecificTime]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE PROCEDURE [dbo].[ProcAddSpecificTime]
	-- Add the parameters for the stored procedure here
@Tm as time
AS
BEGIN
	-- SET NOCOUNT ON added to prevent extra result sets from
	-- interfering with SELECT statements.
	SET NOCOUNT ON;
	insert into dbo.tbltimes(MyTime) values(@tm);
INSERT INTO [dbo].[tblCalender]
           ([AppDate])
    (select distinct cast(cast(appdate as date) as datetime)   + cast(@tm as datetime) from [dbo].[tblCalender])
END
GO
/****** Object:  StoredProcedure [dbo].[ProcCarriedWires]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE PROCEDURE [dbo].[ProcCarriedWires] 
	-- Add the parameters for the stored procedure here

AS
BEGIN
	-- SET NOCOUNT ON added to prevent extra result sets from
	-- interfering with SELECT statements.
	SET NOCOUNT ON;

    -- Insert statements for procedure here
	Declare @NextSlot int
Declare @NextBag varchar(1)
declare @counter int
set @counter = 1

while @counter <= 26
Begin
set @NextBag = (select mychar from tblcharcters c
 where c.Myrank = @counter)

set @NextSlot = (
 SELECT TOP 1 * FROM (
  SELECT t1.wireslot+1 AS wireslot
    FROM dbo.tblcarriedwires t1
    WHERE NOT EXISTS(SELECT * FROM dbo.tblcarriedwires t2 
	WHERE t2.wireslot = t1.wireslot + 1 and t2.WireBag = @NextBag )
	and t1.WireBag = @NextBag
    UNION 
    SELECT 1 AS wireslot
    WHERE NOT EXISTS (SELECT * FROM tblcarriedwires t3 WHERE t3.wireslot = 1
	and t3.WireBag = @NextBag)) ot
ORDER BY 1
)

if @nextslot < 129
Begin
select @nextbag as NextBag,@nextSlot as NextSlot
Break
End

set @counter = @counter + 1

End
END
GO
/****** Object:  StoredProcedure [dbo].[ProcCheck_Wires]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE PROCEDURE [dbo].[ProcCheck_Wires]
	-- Add the parameters for the stored procedure here
@PID int
AS
BEGIN
	-- SET NOCOUNT ON added to prevent extra result sets from
	-- interfering with SELECT statements.
	SET NOCOUNT ON;

    -- Insert statements for procedure here
Select top 1 WireBag, WireSlot From dbo.tblCarriedWires
Where PersonID = @PID

END
GO
/****** Object:  StoredProcedure [dbo].[ProcCheckHoliday]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE PROCEDURE [dbo].[ProcCheckHoliday]
-- This procedure to check whether a certain date is holiday
	-- Add the parameters for the stored procedure here
@HD as date
AS
BEGIN
	-- SET NOCOUNT ON added to prevent extra result sets from
	-- interfering with SELECT statements.
	SET NOCOUNT ON;

    -- Insert statements for procedure here
	Select H.HolidayDate from dbo.tblHolidays H where
	HolidayDate = @HD 
	
	
END
GO
/****** Object:  StoredProcedure [dbo].[ProcDay]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE Procedure [dbo].[ProcDay] @AppDate Date
As
SELECT        dbo.tblappointments.appointmentID,  dbo.tblappointments.AppDetail,dbo.tblappointments.DrID, dbo.tblpatients.PatientName, dbo.tblCalender.AppDate, Format(dbo.tblCalender.AppDate, 'hh\:mm') AS AppTime
FROM            dbo.tblappointments INNER JOIN
                         dbo.tblpatients ON dbo.tblappointments.PersonID = dbo.tblpatients.PersonID RIGHT OUTER JOIN
                         dbo.tblCalender ON dbo.tblappointments.AppDate = dbo.tblCalender.AppDate
where dbo.tblCalender.AppDate >= @AppDate AND dbo.tblCalender.AppDate < dateadd(day,1,@Appdate)
order by dbo.tblCalender.AppDate
GO
/****** Object:  StoredProcedure [dbo].[ProcDeleteSpecificTime]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE PROCEDURE [dbo].[ProcDeleteSpecificTime]
	-- Add the parameters for the stored procedure here
@tm as time
AS
BEGIN
	-- SET NOCOUNT ON added to prevent extra result sets from
	-- interfering with SELECT statements.
	SET NOCOUNT ON;
	delete from dbo.tbltimes where MyTime = @tm;
DELETE FROM [dbo].[tblCalender]
      WHERE cast(AppDate as time) = @tm
END
GO
/****** Object:  StoredProcedure [dbo].[ProcDelHoliday]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE PROCEDURE [dbo].[ProcDelHoliday]
	-- Add the parameters for the stored procedure here
	@HD as Date
AS
BEGIN
	
	SET NOCOUNT ON;
	
	-- Add the parameters for the stored procedure here
	


Delete  dbo.tblholidays  WHERE Holidaydate = @HD;

INSERT INTO tblCalender ( AppDate ) 
Select Vf.MyDates
From dbo.VfillCal Vf
where cast(MyDates as date) = @HD;

END
GO
/****** Object:  StoredProcedure [dbo].[ProcDeliveredWa]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO






-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE PROCEDURE [dbo].[ProcDeliveredWa]
	-- Add the parameters for the stored procedure here
	--@AppID as integer, @Result as bit
	@AIDS as WhatsTableType ReadOnly
	
AS
BEGIN
	-- SET NOCOUNT ON added to prevent extra result sets from
	-- interfering with SELECT statements.
	SET NOCOUNT ON;

    -- Insert statements for procedure here
	update A Set A.DeliveredWA  = W.DeliveredWA, A.WantNotify = CASE 
           -- need to check R for the _new_ value:
           WHEN W.DeliveredWA IN ('Read', 'DEVICE' , 'SERVER') THEN 0 
           ELSE A.WantNotify END
	from dbo.tblappointments as A inner join @AIDS as W on A.appointmentID = W.appointmentID;
	
END
GO
/****** Object:  StoredProcedure [dbo].[ProcEditedInvoices]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE PROCEDURE [dbo].[ProcEditedInvoices]
	-- Add the parameters for the stored procedure here

AS
BEGIN
	-- SET NOCOUNT ON added to prevent extra result sets from
	-- interfering with SELECT statements.
	SET NOCOUNT ON;

    SELECT h.* , w.currency , p.PatientName , i.Amountpaid as oldAmount from [History].[tblInvoice] h inner join tblwork w on w.workid = h.workid 
inner join tblpatients p on w.PersonID = p.PersonID inner join tblInvoice i on h.invoiceID = i.invoiceID
END
GO
/****** Object:  StoredProcedure [dbo].[ProcExpenses]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE Procedure [dbo].[ProcExpenses] 

    @startDate date,
    @endDate date,
	@categoryID int = NULL,
    @SubCategoryID int = NULL
AS
BEGIN
    SELECT
        ROW_NUMBER() OVER (ORDER BY e.expenseDate) AS Number,
        e.*
    FROM
        dbo.tblExpenses e
    WHERE
        e.expenseDate >= @startDate
        AND e.expenseDate <= @endDate
		AND (
            @categoryID IS NULL
            OR e.categoryID = @categoryID
        )
        AND (
            @SubCategoryID IS NULL
            OR e.SubCategoryID = @SubCategoryID
        )
    ORDER BY
        e.expenseDate;
END;

				
GO
/****** Object:  StoredProcedure [dbo].[ProcFetch]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO


-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE PROCEDURE [dbo].[ProcFetch]
	-- Add the parameters for the stored procedure here
	--@AppID as integer, @Result as bit
	@ADate as date
AS
BEGIN
	-- SET NOCOUNT ON added to prevent extra result sets from
	-- interfering with SELECT statements.
	SET NOCOUNT ON;

    -- Insert statements for procedure here
	Select A.appointmentID, '964' + P.Phone + '@c.us' ,A.WaMessageID
	From dbo.tblpatients P INNER JOIN
         dbo.tblappointments A ON P.PersonID = A.PersonID
		 Where  (A.AppDay = @ADate) and (A.SentWa = 1)
	

END
GO
/****** Object:  StoredProcedure [dbo].[Procgetsids]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO


-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE PROCEDURE [dbo].[Procgetsids]
	-- Add the parameters for the stored procedure here
	@ADate as date
AS
BEGIN
	-- SET NOCOUNT ON added to prevent extra result sets from
	-- interfering with SELECT statements.
	SET NOCOUNT ON;

   
 SELECT  dbo.tblappointments.appointmentID , dbo.tblappointments.sms_sid
FROM  
         dbo.tblappointments
		 Where  dbo.tblappointments.AppDay = @ADate and dbo.tblappointments.sms_sid is not null;;
END
GO
/****** Object:  StoredProcedure [dbo].[ProcGrandTotal]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE Procedure [dbo].[ProcGrandTotal] @month int , @year int , @Ex int As
Declare @Start as datetime
declare @End as datetime
Declare @Startd as date
declare @Endd as date
select @start = datefromparts(@year,@month,1)

if @month = 12 
select @End = datefromparts(@year+1,1,1) ;
ELSE
select @End = datefromparts(@year,@month+1,1) ;


select @Startd = @start
select @Endd = @End;


SELECT isnull(dbo.VWIQD.Day,dbo.VWUSD.Day) AS 'Day', dbo.VWIQD.SumIQD, 
dbo.VWIQD.SumExQ AS 'ExpensesIQD', dbo.VWIQD.FinalIQDSum, dbo.VWUSD.SumUSD, 
 dbo.VWUSD.SumEx$ AS 'ExpensesUSD', dbo.VWUSD.FinalUSDSum,
(cast((isnull(dbo.VWIQD.FinalIQDSum,0)/cast(isnull(s.ExchangeRate,@ex) as float)) + ISNULL(dbo.VWUSD.FinalUSDSum,0) as decimal(9,2)))as GrandTotal,
( isnull(dbo.VWIQD.FinalIQDSum,0) +ISNULL((dbo.VWUSD.FinalUSDSum * isnull(s.ExchangeRate,@Ex)),0))as GrandTotalIQD,
(isnull(dbo.VWIQD.FinalIQDSum,0) + isnull(aUS.ActualIQD,0) - isnull(aUS.SUMChangeUSD,0) - isnull(aIQ.SUMChangeIQD,0) 
- isnull(aIQ.SumIQDNotGained,0))as QasaIQD,

(isnull(dbo.VWUSD.FinalUSDSum,0) + isnull(aIQ.ActualUSD,0)- isnull(aUS.SumUSDNotGained,0)) as QasaUSD

FROM     (dbo.VWIQD FULL OUTER JOIN
                  dbo.VWUSD ON dbo.VWIQD.Day = dbo.VWUSD.Day
				 ) 
				    left join dbo.tblsms s on VWIQD.Day = s.[date] or VWUSD.Day = s.[date]
					left join dbo.V_ActualIQD aIQ on aIQ.DateofPayment =VWIQD.Day or  aIQ.DateofPayment =VWIQD.Day
					left join dbo.V_ActualUSD aUS on aUS.DateofPayment =VWIQD.Day or  aUS.DateofPayment =VWIQD.Day
					 where isnull(dbo.VWIQD.Day,dbo.VWUSD.Day) >= @Startd and isnull(dbo.VWIQD.Day,dbo.VWUSD.Day) < @Endd
				   order by Day
				
				
				
GO
/****** Object:  StoredProcedure [dbo].[ProcGrandTotal_original]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE Procedure [dbo].[ProcGrandTotal_original] @month int , @year int , @Ex int As
Declare @Start as datetime
declare @End as datetime
Declare @Startd as date
declare @Endd as date
select @start = datefromparts(@year,@month,1)

if @month = 12 
select @End = datefromparts(@year+1,1,1) ;
ELSE
select @End = datefromparts(@year,@month+1,1) ;


select @Startd = @start
select @Endd = @End;


SELECT isnull(dbo.VWIQD.Day,dbo.VWUSD.Day) AS 'Day', dbo.VWIQD.SumIQD, 
dbo.VWIQD.SumExQ AS 'ExpensesIQD', dbo.VWIQD.FinalIQDSum, dbo.VWUSD.SumUSD, 
 dbo.VWUSD.SumEx$ AS 'ExpensesUSD', dbo.VWUSD.FinalUSDSum,
(cast((isnull(dbo.VWIQD.FinalIQDSum,0)/cast(@Ex as float)) + ISNULL(dbo.VWUSD.FinalUSDSum,0) as decimal(9,2)))as GrandTotal,
( isnull(dbo.VWIQD.FinalIQDSum,0) +ISNULL((dbo.VWUSD.FinalUSDSum * @Ex),0))as GrandTotalIQD

FROM     dbo.VWIQD FULL OUTER JOIN
                  dbo.VWUSD ON dbo.VWIQD.Day = dbo.VWUSD.Day
				  where isnull(dbo.VWIQD.Day,dbo.VWUSD.Day) >= @Startd and isnull(dbo.VWIQD.Day,dbo.VWUSD.Day) < @Endd
				  order by Day
				
				
				
GO
/****** Object:  StoredProcedure [dbo].[ProcIncomeByDr]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE PROCEDURE [dbo].[ProcIncomeByDr] 
	-- Add the parameters for the stored procedure here
@Start date,@End date
AS
BEGIN
	-- SET NOCOUNT ON added to prevent extra result sets from
	-- interfering with SELECT statements.
	SET NOCOUNT ON;

Select a.drid ,a.IQD_SUM, b.USD_SUM from
(SELECT dbo.tblwork.DrID, SUM(dbo.tblInvoice.Amountpaid) AS IQD_SUM
FROM     dbo.tblwork INNER JOIN
                  dbo.tblInvoice ON dbo.tblwork.workid = dbo.tblInvoice.workid
WHERE  (dbo.tblwork.Currency = N'IQD' and dbo.tblInvoice.Dateofpayment >= @Start and dbo.tblInvoice.Dateofpayment 
<= @End)
GROUP BY dbo.tblwork.DrID) a full outer join
(SELECT dbo.tblwork.DrID, SUM(dbo.tblInvoice.Amountpaid) AS USD_SUM
FROM     dbo.tblwork INNER JOIN
                  dbo.tblInvoice ON dbo.tblwork.workid = dbo.tblInvoice.workid
WHERE  (dbo.tblwork.Currency = N'USD' and dbo.tblInvoice.Dateofpayment >= @Start and dbo.tblInvoice.Dateofpayment 
<= @End )
GROUP BY dbo.tblwork.DrID) b
on a.DrID = b.DrID
END
GO
/****** Object:  StoredProcedure [dbo].[ProcIncomeDr]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE PROCEDURE [dbo].[ProcIncomeDr]
	-- Add the parameters for the stored procedure here
@Start  date,
@End date

AS
BEGIN
	-- SET NOCOUNT ON added to prevent extra result sets from
	-- interfering with SELECT statements.
	SET NOCOUNT ON;

    -- Insert statements for procedure here
	Select iq.drid, iq.SumIQD, us.SumUSD from
(SELECT SUM(dbo.tblInvoice.Amountpaid) AS SumIQD, DrID
FROM  dbo.tblInvoice INNER JOIN
         dbo.tblwork ON dbo.tblInvoice.workid = dbo.tblwork.workid
WHERE (dbo.tblwork.Currency = 'IQD') and (tblInvoice.Dateofpayment  > = @Start) and (tblInvoice.Dateofpayment <= @End)
GROUP BY dbo.tblwork.DrID) iq full outer join 
(SELECT SUM(dbo.tblInvoice.Amountpaid) AS SumUSD, DrID
FROM  dbo.tblInvoice INNER JOIN
         dbo.tblwork ON dbo.tblInvoice.workid = dbo.tblwork.workid
WHERE (dbo.tblwork.Currency = 'USD') and (tblInvoice.Dateofpayment  > = @Start) and (tblInvoice.Dateofpayment <= @End)
GROUP BY dbo.tblwork.DrID) us on iq.DrID = us.DrID

END
GO
/****** Object:  StoredProcedure [dbo].[ProcListWorks]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
-- Create Procedure ProcListWorks
-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE PROCEDURE [dbo].[ProcListWorks]
	-- Add the parameters for the stored procedure here
@Pd int
AS
BEGIN
	-- SET NOCOUNT ON added to prevent extra result sets from
	-- interfering with SELECT statements.
	SET NOCOUNT ON;

    -- Insert statements for procedure here
	SELECT ROW_NUMBER() over(order by v.workid asc) as 'No', v.workid, wt.WorkType as 'Type', Case when v.Finished
	 = 1 Then 'Yes' Else 'No' End As Finished,Case when   v.TotalRequired - t.TotalPaid = 0 or t.TotalRequired = 0 Then 1 Else 0 End As Paid, 
	 cast(AdditionDate as date) as 'Addition Date' ,StartDate As 'Start Date'
FROM dbo.V_Works v left outer join dbo.tblWorkType wt on v.Typeofwork = wt.ID  left outer join dbo.VTotPaid t on v.workid = t.workid
WHERE v.PersonID =@Pd

END
GO
/****** Object:  StoredProcedure [dbo].[ProcOPGWork]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE PROCEDURE [dbo].[ProcOPGWork] 
	-- Add the parameters for the stored procedure here
	@PersonID int,
	@DrID int,
	@TotalRequired int,
	@Currency nvarchar(255),
	@Finished bit
AS
BEGIN
	-- SET NOCOUNT ON added to prevent extra result sets from
	-- interfering with SELECT statements.
	SET NOCOUNT ON;
	 INSERT dbo.tblwork(PersonID, TotalRequired,Currency,DrID,Finished) SELECT @PersonID,@TotalRequired,
	 @Currency, @DrID, @Finished ;
    -- Insert statements for procedure here
	SELECT SCOPE_IDENTITY() as WorkID;
END
GO
/****** Object:  StoredProcedure [dbo].[ProcSMS]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO


-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE PROCEDURE [dbo].[ProcSMS]
	-- Add the parameters for the stored procedure here
	@ADate as date
AS
BEGIN
	-- SET NOCOUNT ON added to prevent extra result sets from
	-- interfering with SELECT statements.
	SET NOCOUNT ON;
	SET NOCOUNT ON;
	declare @DD as SMALLINT;
	declare @A_Mes as NVARCHAR(max);
	declare @E_Mes as NVARCHAR(max);
	declare @Message1 as NVARCHAR(max) =  'غدا' + ' ' + dbo.ArabicDay(@ADate) +  ' ' + 'موعدك مع عيادة د.شوان الساعة';
	declare @Message2 as NVARCHAR(max) = 'بعد غد' + ' ' + dbo.ArabicDay(@ADate) + ' ' + 'موعدك مع عيادة د.شوان الساعة';
	declare @Message3 as NVARCHAR(max) ='Tommorow "' + DATENAME(dw,@ADate) +'" is your appointment with Dr. Shwan orthodontic clinic at '
	declare @Message4 as NVARCHAR(max) ='The day after tommorow "' + DATENAME(dw,@ADate) +'" is your appointment with Dr. Shwan orthodontic clinic at '
	set @DD = DATEDIFF(day,CAST(getdate() AS date) ,@ADate);

	if @DD < 0  or @DD > 3
	return -1;
	
	set @A_Mes = case 
	when @DD = 1 then @Message1
	when @DD = 2 then @Message2
	End

	set @E_Mes = case 
	when @DD = 1 then @Message3
	when @DD = 2 then @Message4
	else @Message3
	End

   
 SELECT  dbo.tblappointments.appointmentID , '+964' + dbo.tblpatients.Phone AS Phone, case
 when dbo.tblpatients.Language = 0 then
        'مرحبا' + ' '  + dbo.tblpatients.PatientName + '. ' + @A_Mes + ' ' + format(dbo.tblappointments.AppDate, 'h:mm') 
		when dbo.tblpatients.Language = 1 then
	   'Hello ' + dbo.tblpatients.FirstName + '. ' + @E_Mes + ' ' + format(dbo.tblappointments.AppDate, 'h:mm') end
		AS message
FROM  
         dbo.tblappointments inner join dbo.tblpatients on tblappointments.PersonID = tblpatients.PersonID
		 Where  (dbo.tblappointments.AppDay = @ADate)  and (dbo.tblappointments.WantNotify = 1) and (dbo.tblappointments.Notified = 0 or
		 dbo.tblappointments.Notified is null );
END
GO
/****** Object:  StoredProcedure [dbo].[ProcUpdatesms1]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO




-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE PROCEDURE [dbo].[ProcUpdatesms1]
	-- Add the parameters for the stored procedure here
	--@AppID as integer, @Result as bit
	@status as SMSStatusType ReadOnly
	
AS
BEGIN
	-- SET NOCOUNT ON added to prevent extra result sets from
	-- interfering with SELECT statements.
	SET NOCOUNT ON;

    -- Insert statements for procedure here
	update A Set A.sms_sid  = W.sms_sid, A.Notified = 1,A.WantWa = 0
	from dbo.tblappointments as A inner join @status as W on A.appointmentID = W.appointmentID;
	
END
GO
/****** Object:  StoredProcedure [dbo].[ProcUpdatesms2]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO




-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE PROCEDURE [dbo].[ProcUpdatesms2]
	-- Add the parameters for the stored procedure here
	--@AppID as integer, @Result as bit
	@status as SMSStatusType ReadOnly
	
AS
BEGIN
	-- SET NOCOUNT ON added to prevent extra result sets from
	-- interfering with SELECT statements.
	SET NOCOUNT ON;

    -- Insert statements for procedure here
	update A Set A.SMSStatus  = W.SMSStatus
	from dbo.tblappointments as A inner join @status as W on A.appointmentID = W.appointmentID;
	
END
GO
/****** Object:  StoredProcedure [dbo].[ProcWAResult]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO





-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE PROCEDURE [dbo].[ProcWAResult]
	-- Add the parameters for the stored procedure here
	--@AppID as integer, @Result as bit
	@AIDS as WhatsTableType ReadOnly
AS
BEGIN
	-- SET NOCOUNT ON added to prevent extra result sets from
	-- interfering with SELECT statements.
	SET NOCOUNT ON;

    -- Insert statements for procedure here
	update dbo.tblappointments Set dbo.tblappointments.SentWA = W.SentWA,dbo.tblappointments.WaMessageID = W.WaMessageID,dbo.tblappointments.WantWa = 0
	from dbo.tblappointments as A inner join @AIDS as W on A.appointmentID = W.appointmentID
	

END
GO
/****** Object:  StoredProcedure [dbo].[ProcWhatsApp]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE PROCEDURE [dbo].[ProcWhatsApp]
	-- Add the parameters for the stored procedure here
	@ADate as date
AS
BEGIN
	-- SET NOCOUNT ON added to prevent extra result sets from
	-- interfering with SELECT statements.
	SET NOCOUNT ON;
	declare @DD as SMALLINT;
	declare @A_Mes as NVARCHAR(max);
	declare @E_Mes as NVARCHAR(max);
	declare @Message1 as NVARCHAR(max) =  'غدا' + ' ' + dbo.ArabicDay(@ADate) +  ' ' + 'موعدك مع عيادة د.شوان لتقويم الاسنان الساعة';
	declare @Message2 as NVARCHAR(max) = 'بعد غد' + ' ' + dbo.ArabicDay(@ADate) + ' ' + 'موعدك مع عيادة د.شوان لتقويم الاسنان الساعة';
	declare @Message3 as NVARCHAR(max) ='Tommorow "' + DATENAME(dw,@ADate) +'" is your appointment with Dr. Shwan orthodontic clinic at '
	declare @Message4 as NVARCHAR(max) ='The day after tommorow "' + DATENAME(dw,@ADate) +'" is your appointment with Dr. Shwan orthodontic clinic at '
	set @DD = DATEDIFF(day,CAST(getdate() AS date) ,@ADate)

	if @DD < 0 or @DD > 3
	Return -1 ;


	set @A_Mes = case 
	when @DD = 1 then @Message1
	when @DD = 2 then @Message2
	End

	set @E_Mes = case 
	when @DD = 1 then @Message3
	when @DD = 2 then @Message4
	else @Message3
	End

   
 SELECT dbo.tblappointments.appointmentID,  '964' + dbo.tblpatients.Phone AS Phone, dbo.tblpatients.PatientName, case
 when dbo.tblpatients.Language = 0 then
       'السلام عليك' + ' ' + dbo.tblpatients.PatientName + '. ' + @A_Mes + ' ' + format(dbo.tblappointments.AppDate, 'h:mm')  
	   when dbo.tblpatients.Language = 1 then
	   'Hello ' + dbo.tblpatients.FirstName + '. ' + @E_Mes + ' ' + format(dbo.tblappointments.AppDate, 'h:mm') end
	   AS message
FROM  dbo.tblpatients INNER JOIN
         dbo.tblappointments ON dbo.tblpatients.PersonID = dbo.tblappointments.PersonID
		 Where  (dbo.tblappointments.AppDay = @ADate) and (dbo.tblappointments.WantWa = 1) 
		 and (dbo.tblappointments.Notified = 0 or dbo.tblappointments.Notified is null) 
		 and (dbo.tblappointments.SentWa = 0 or dbo.tblappointments.SentWa is null);

		  update dbo.tblsms set [smssent]  = 1 where [date] = @ADate;

		
END
GO
/****** Object:  StoredProcedure [dbo].[ProDailyInvoices]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE PROCEDURE [dbo].[ProDailyInvoices]
@iDate as date
AS
BEGIN
	-- SET NOCOUNT ON added to prevent extra result sets from
	-- interfering with SELECT statements.
	SET NOCOUNT ON;

    SELECT i.* , w.currency , p.PatientName, w.DrID FROM [tblInvoice] i inner join tblwork w on w.workid = i.workid 
inner join tblpatients p on w.PersonID = p.PersonID where i.Dateofpayment = @iDate
END
GO
/****** Object:  StoredProcedure [dbo].[ProDelete]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE procedure [dbo].[ProDelete] 
@Id as int = 0,
@Field as varchar(100), 
@Tbl as varchar(100)
As
Begin
declare @Sql Nvarchar(4000) 
 SET @Sql = 'Delete ' +  @Tbl + ' Where ' + @Field + ' = ' + cast(@Id as varchar(100))
 execute sp_executesql @sql
 End
GO
/****** Object:  StoredProcedure [dbo].[ProDeletedInvoices]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE PROCEDURE [dbo].[ProDeletedInvoices]

AS
BEGIN
	-- SET NOCOUNT ON added to prevent extra result sets from
	-- interfering with SELECT statements.
	SET NOCOUNT ON;

    SELECT h.* , w.currency , p.PatientName FROM [History].[tblInvoice] h inner join tblwork w on w.workid = h.workid 
inner join tblpatients p on w.PersonID = p.PersonID where h.invoiceID not in (select i.invoiceID from tblInvoice i) 
order by h.SysEndTime
END
GO
/****** Object:  StoredProcedure [dbo].[ProFindDupPhone]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE procedure [dbo].[ProFindDupPhone] @ADate Date as
SELECT Tabo.[Phone] 
FROM (SELECT tblpatients.Phone FROM tblpatients INNER JOIN 
tblappointments ON tblpatients.PersonID = tblappointments.PersonID 
WHERE tblappointments.appdate between @ADate and dateadd(Day,1,@ADate) And
tblappointments.WantNotify = 1)  AS Tabo 
GROUP BY Tabo.[Phone] 
HAVING Count(Tabo.[Phone])>1 
GO
/****** Object:  StoredProcedure [dbo].[ProFindDupPhone2]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE procedure [dbo].[ProFindDupPhone2] @ADate Date as
SET NOCOUNT ON;  

WITH DUPS as
(SELECT tblpatients.Phone,tblpatients.PatientName,
ROW_NUMBER() OVER (PARTITION BY Phone ORDER BY tblappointments.AppDate ASC) as RNum
FROM tblpatients INNER JOIN  tblappointments ON tblpatients.PersonID = tblappointments.PersonID 
WHERE tblappointments.appdate between @ADate and dateadd(Day,1,@ADate) And tblpatients.Phone IS not null and
tblappointments.WantNotify = 1 ),
DUPS2 AS
(SELECT distinct Phone 
FROM DUPS WHERE RNUM > 1)

SELECT tblpatients.PatientName, tblpatients.Phone FROM tblpatients INNER JOIN tblappointments ON tblpatients.PersonID = tblappointments.PersonID 
INNER JOIN DUPS2 ON tblpatients.Phone = DUPS2.Phone
WHERE tblappointments.appdate between @ADate and dateadd(Day,1,@ADate) And
tblappointments.WantNotify = 1 and  tblpatients.Phone in (select DUPS2.Phone from dups2)
ORDER BY Phone
;

WITH DUPS as
(SELECT  tblpatients.Phone, tblappointments.WantNotify,
ROW_NUMBER() OVER (PARTITION BY Phone ORDER BY tblappointments.AppDate ASC) as RNum 
FROM tblpatients INNER JOIN  tblappointments ON tblpatients.PersonID = tblappointments.PersonID 
WHERE tblappointments.appdate between @ADate and dateadd(Day,1,@ADate) And
tblappointments.WantNotify = 1 )

UPDATE DUPS
SET WantNotify = 0
WHERE RNum > 1;
GO
/****** Object:  StoredProcedure [dbo].[ProFlip]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
create procedure [dbo].[ProFlip] @AID int as
update dbo.tblappointments 
set dbo.tblappointments.WantNotify = ~dbo.tblappointments.WantNotify
where appointmentID = @AID
GO
/****** Object:  StoredProcedure [dbo].[ProFlipAllSMS]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE procedure [dbo].[ProFlipAllSMS] @ADate date as
update dbo.tblappointments 
set dbo.tblappointments.WantNotify = ~dbo.tblappointments.WantNotify
where (AppDay = @ADate);

GO
/****** Object:  StoredProcedure [dbo].[ProFlipSMS]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE procedure [dbo].[ProFlipSMS] @ADate date as
update dbo.tblappointments 
set dbo.tblappointments.WantNotify = 0
where (AppDay = @ADate);
update dbo.tblappointments 
set dbo.tblappointments.WantNotify = 1
where (AppDay = @ADate) and (SentWa = 0  or SentWa is null or DeliveredWa = 'ERROR' or DeliveredWa = 'PENDING'
or DeliveredWa = 'SERVER');

GO
/****** Object:  StoredProcedure [dbo].[proGetLatestWire]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE PROCEDURE [dbo].[proGetLatestWire]
@WID int

AS
BEGIN
	-- SET NOCOUNT ON added to prevent extra result sets from
	-- interfering with SELECT statements.
	SET NOCOUNT ON;

    -- Insert statements for procedure here
	SELECT v.UpperWireID, v.LowerWireID FROM dbo.tblvisits v INNER JOIN 
	( SELECT WorkID, MAX(VisitDate) AS LatestVisitDate 
	FROM dbo.tblvisits WHERE WorkID = @WID  
	GROUP BY WorkID) vl ON v.WorkID = vl.WorkID AND v.VisitDate = vl.LatestVisitDate
END
GO
/****** Object:  StoredProcedure [dbo].[proGetVisitSum]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE PROCEDURE [dbo].[proGetVisitSum] 
    @VID INT
AS
BEGIN
    SET NOCOUNT ON;
    
    SELECT
        dbo.tblvisits.VisitDate,
		dbo.tblvisits.UpperWireID,
        dbo.tblvisits.LowerWireID,
        dbo.tblvisits.Others,
        dbo.tblvisits.NextVisit
    FROM
        dbo.tblvisits
    WHERE
        dbo.tblvisits.ID = @VID;
END

GO
/****** Object:  StoredProcedure [dbo].[ProKeyWord]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE PROCEDURE [dbo].[ProKeyWord]
	-- Add the parameters for the stored procedure here
 @Keyword Varchar(100)
AS
BEGIN
	-- SET NOCOUNT ON added to prevent extra result sets from
	-- interfering with SELECT statements.
	SET NOCOUNT ON;

    -- Insert statements for procedure here
	SELECT        dbo.tblpatients.PersonID, dbo.tblpatients.patientID, dbo.tblpatients.PatientName, dbo.tblpatients.Phone
FROM            dbo.tblwork INNER JOIN
                         dbo.tblpatients ON dbo.tblwork.PersonID = dbo.tblpatients.PersonID 
						 Where dbo.tblwork.KeyWordID1 = @Keyword or
						 dbo.tblwork.KeyWordID2 = @Keyword or dbo.tblwork.KeyWordID3 = @Keyword or dbo.tblwork.KeyWordID4 = @Keyword
						 or dbo.tblwork.KeyWordID5 = @Keyword
END
GO
/****** Object:  StoredProcedure [dbo].[ProlatestVisitSum]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE PROCEDURE [dbo].[ProlatestVisitSum] @WID int 
AS
BEGIN
	-- SET NOCOUNT ON added to prevent extra result sets from
	-- interfering with SELECT statements.
	SET NOCOUNT ON;

    -- Insert statements for procedure here
	SELECT         dbo.tblvisits.VisitDate,
ISNULL('Upper Wire: ' +(SELECT        Wire
                                FROM            dbo.tblWires
                                WHERE        (Wire_ID = dbo.tblvisits.UpperWireID)) + '<br> ', '') + 
								ISNULL('Lower Wire: ' +
                             (SELECT        Wire
                                FROM            dbo.tblWires AS tblWires_1
                                WHERE        (Wire_ID = dbo.tblvisits.LowerWireID)) + '<br> ', '') + 
								ISNULL('Bracket change for: ' + dbo.tblvisits.BracketChange + '<br> ', '') 
                         + ISNULL('Wire Bending for: ' + dbo.tblvisits.WireBending + '<br> ', '') + 
						 ISNULL(dbo.tblvisits.Elastics + '<br> ', '') + 
						 ISNULL(replace(dbo.tblvisits.Others,CHAR(13)+CHAR(10),'<BR> ') + '<br> ', '') 
                         + ISNULL('<font color=blue>Next: ' + REPLACE(dbo.tblvisits.NextVisit,CHAR(13)+CHAR(10),'<BR> ')+'</font>', '') AS Summary
FROM            dbo.tblwork  INNER JOIN
                         dbo.tblvisits ON dbo.tblwork.workid = dbo.tblvisits.WorkID
						 where dbo.tblvisits.WorkID = @WID and dbo.tblvisits.VisitDate = (SELECT MAX(VisitDate) FROM dbo.tblvisits WHERE WorkID = @WID)
    ORDER BY VisitDate
						
END
GO
/****** Object:  StoredProcedure [dbo].[ProSMS]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
-- This is the stored procedure that frmSMS is based on
CREATE procedure [dbo].[ProSMS] @ADate as date
as
SELECT       dbo.tblappointments.appointmentID, dbo.tblappointments.AppDate, dbo.tblappointments.PersonID, dbo.tblpatients.PatientName, dbo.tblpatients.patientID, dbo.tblpatients.Phone, 
                         dbo.tblappointments.WantNotify, dbo.tblappointments.Notified, dbo.tblappointments.AppDetail, dbo.tblappointments.SMSStatus, format(dbo.tblappointments.AppDate ,'h:mm tt') as Apptime,
						 dbo.tblappointments.Sentwa,dbo.tblappointments.DeliveredWa,dbo.tblappointments.WantWa, tblEmployees.employeeName
FROM            dbo.tblpatients INNER JOIN
                         dbo.tblappointments ON dbo.tblpatients.PersonID = dbo.tblappointments.PersonID left outer join dbo.tblEmployees
						 on dbo.tblappointments.DrID = dbo.tblEmployees.ID
WHERE        (dbo.tblappointments.AppDay = @ADate)
ORDER BY dbo.tblappointments.AppDate
GO
/****** Object:  StoredProcedure [dbo].[ProSMSS]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
Create procedure [dbo].[ProSMSS] @ADate as date
as
Update dbo.tblappointments
set Notified = 1, WantNotify = 0
Where (dbo.tblappointments.AppDate BETWEEN @ADate AND dateadd(day,1,@ADate)) And WantNotify = 1
GO
/****** Object:  StoredProcedure [dbo].[ProTblPatients]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE procedure  [dbo].[ProTblPatients] 
@Na Nvarchar(400) = null, 
@Nam Nvarchar(400) = null, 
@PID varchar(100) = null, 
@Ph varchar(100) = null,
@Tp int = null, 
@Wr int = null
As
DECLARE @sql        nvarchar(4000),                                
        @paramlist  nvarchar(4000),                                
        @nl         char(2) = char(13) + char(10)

Select @sql = 
'SELECT DISTINCT o.PersonID, o.PatientName, o.phone
     FROM dbo.tblpatients o
     LEFT JOIN dbo.tblwork w ON o.PersonID = w.PersonID
 Where 1 = 1' + @nl
 If @Na is not null  
 SELECT @sql += ' AND o.PatientName Like @Na + ''%''' + @nl
  If @Nam is not null  
 SELECT @sql +=N' AND o.PatientName Like ''%'' + @Nam + ''%''' + @nl
 If @PID is not null  
 SELECT @sql += ' AND o.PersonID = @PID' + @nl
  If @Ph is not null  
 SELECT @sql += ' AND o.phone Like ''%'' + @Ph + ''%''' + @nl
 If @Tp is not null  
 SELECT @sql += ' AND o.PatientTypeID = @Tp' + @nl
 IF @Wr IS NOT NULL  
 SELECT @sql += ' AND w.Typeofwork = @Wr'

 SELECT @paramlist = '@Na  nvarchar(400), 
                     @Nam  nvarchar(400),        
                     @PID  varchar(100),                        
                     @Ph   varchar(100),
				   @Tp INT,
				   @Wr INT'
PRINT @sql
				                     
   EXEC sp_executesql @sql, @paramlist, @Na,@Nam, @PID, @Ph  , @Tp, @Wr    
				                     
            
GO
/****** Object:  StoredProcedure [dbo].[ProVisitSum]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE procedure [dbo].[ProVisitSum] @WID int
 
AS
SELECT        dbo.tblpatients.PatientName, dbo.tblvisits.WorkID, dbo.tblvisits.ID, dbo.tblvisits.VisitDate, dbo.tblvisits.OPG,
 dbo.tblvisits.IPhoto,dbo.tblvisits.FPhoto,dbo.tblvisits.PPhoto,dbo.tblvisits.ApplianceRemoved,
ISNULL('Upper Wire: ' +(SELECT        Wire
                                FROM            dbo.tblWires
                                WHERE        (Wire_ID = dbo.tblvisits.UpperWireID)) + '<br> ', '') + 
								ISNULL('Lower Wire: ' +
                             (SELECT        Wire
                                FROM            dbo.tblWires AS tblWires_1
                                WHERE        (Wire_ID = dbo.tblvisits.LowerWireID)) + '<br> ', '') + 
								ISNULL('Bracket change for: ' + dbo.tblvisits.BracketChange + '<br> ', '') 
                         + ISNULL('Wire Bending for: ' + dbo.tblvisits.WireBending + '<br> ', '') + 
						 ISNULL(dbo.tblvisits.Elastics + '<br> ', '') + 
						 ISNULL(replace(dbo.tblvisits.Others,CHAR(13)+CHAR(10),'<BR> ') + '<br> ', '') 
                         + ISNULL('<font color=blue>Next: ' + REPLACE(dbo.tblvisits.NextVisit,CHAR(13)+CHAR(10),'<BR> ')+'</font>', '') AS Summary
FROM            dbo.tblpatients INNER JOIN
                         dbo.tblwork ON dbo.tblpatients.PersonID = dbo.tblwork.PersonID INNER JOIN
                         dbo.tblvisits ON dbo.tblwork.workid = dbo.tblvisits.WorkID
						 where dbo.tblvisits.WorkID = @WID
						 order by VisitDate
GO
/****** Object:  StoredProcedure [dbo].[ProVisitSumSearched]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE procedure [dbo].[ProVisitSumSearched] @WID int, @SString as nvarchar(100) AS
With CTE_SUM(PatientName,WorkID,ID,VisitDate,OPG,IPhoto,FPhoto,PPhoto,ApplianceRemoved,Summary) As
(SELECT        dbo.tblpatients.PatientName, dbo.tblvisits.WorkID, dbo.tblvisits.ID, dbo.tblvisits.VisitDate, dbo.tblvisits.OPG,
 dbo.tblvisits.IPhoto,dbo.tblvisits.FPhoto,dbo.tblvisits.PPhoto,dbo.tblvisits.ApplianceRemoved,
ISNULL('Upper Wire: ' +(SELECT        Wire
                                FROM            dbo.tblWires
                                WHERE        (Wire_ID = dbo.tblvisits.UpperWireID)) + '<br> ', '') + 
								ISNULL('Lower Wire: ' +
                             (SELECT        Wire
                                FROM            dbo.tblWires AS tblWires_1
                                WHERE        (Wire_ID = dbo.tblvisits.LowerWireID)) + '<br> ', '') + 
								ISNULL('Bracket change for: ' + dbo.tblvisits.BracketChange + '<br> ', '') 
                         + ISNULL('Wire Bending for: ' + dbo.tblvisits.WireBending + '<br> ', '') + 
						 ISNULL(dbo.tblvisits.Elastics + '<br> ', '') + 
						 ISNULL(replace(dbo.tblvisits.Others,CHAR(13)+CHAR(10),'<BR> ') + '<br> ', '') 
                         + ISNULL('<font color=blue>Next: ' + REPLACE(dbo.tblvisits.NextVisit,CHAR(13)+CHAR(10),'<BR> ')+'</font>', '') AS Summary
FROM            dbo.tblpatients INNER JOIN
                         dbo.tblwork ON dbo.tblpatients.PersonID = dbo.tblwork.PersonID INNER JOIN
                         dbo.tblvisits ON dbo.tblwork.workid = dbo.tblvisits.WorkID
						 where dbo.tblvisits.WorkID = @WID
						 )

						 select c.PatientName,c.WorkID,c.ID,c.VisitDate,c.OPG,c.IPhoto,c.FPhoto,c.PPhoto,c.ApplianceRemoved,
						 replace(c.Summary,@SString,'<b><font color=red>' + @SString + '</font></b>') as Summary
						 from CTE_SUM c
						 where c.Summary like '%' + @SString + '%'
						 order by c.VisitDate
GO
/****** Object:  StoredProcedure [dbo].[PTodayAppsWeb]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE procedure [dbo].[PTodayAppsWeb] @AppsDate date  , @waiting int output , @all int output , @completed int output, @present int output as
begin
	SET NOCOUNT ON;
SELECT ROW_NUMBER() OVER(ORDER BY Present ASC) AS Num,
case when cast(dbo.tblappointments.AppDate as time) = '00:00:00' then null else
Format(dbo.tblappointments.AppDate,N'hh\:mm') End as apptime 
,dbo.tblPatientType.PatientType ,dbo.tblpatients.PatientName, dbo.tblappointments.AppDetail,
format(cast(dbo.tblappointments.Present as datetime2),N'hh:mm') as Present, 
Format(cast(dbo.tblappointments.Seated as datetime2),N'hh\:mm') as Seated,
Format(cast(dbo.tblappointments.Dismissed as datetime2),N'hh\:mm') As Dismissed,
dbo.HasVisit(dbo.tblappointments.PersonID, dbo.tblappointments.AppDate) AS HasVisit,
dbo.tblappointments.PersonID as pid
FROM dbo.tblappointments INNER JOIN
dbo.tblpatients ON dbo.tblappointments.PersonID = dbo.tblpatients.PersonID left outer join
dbo.tblPatientType on dbo.tblpatients.PatientTypeID = dbo.tblPatientType.ID
where cast( dbo.tblappointments.AppDate as date) = @appsdate and dbo.tblappointments.Present is not null and dbo.tblappointments.Dismissed is null;

select 
 @all = count(dbo.tblappointments.appointmentID)
FROM dbo.tblappointments 
where cast( dbo.tblappointments.AppDate as date) = @appsdate 
select @present = count(dbo.tblappointments.appointmentID)
FROM dbo.tblappointments 
where cast( dbo.tblappointments.AppDate as date) = @appsdate and dbo.tblappointments.Present is not null;
select 
 @waiting = count(dbo.tblappointments.appointmentID)
FROM dbo.tblappointments 
where cast( dbo.tblappointments.AppDate as date) = @appsdate and dbo.tblappointments.Present is not null and
dbo.tblappointments.Seated is null;
select 
 @completed = count(dbo.tblappointments.appointmentID)
FROM dbo.tblappointments 
where cast( dbo.tblappointments.AppDate as date) = @appsdate and dbo.tblappointments.Dismissed is not null;

end
GO
/****** Object:  StoredProcedure [dbo].[TodaysApps]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE procedure [dbo].[TodaysApps] @AppsDate date as
SELECT        dbo.tblappointments.appointmentID, dbo.tblappointments.PersonID, dbo.tblappointments.AppDetail, format(dbo.tblappointments.Present,N'hh\:mm') as Present, 
Format(dbo.tblappointments.Seated,N'hh\:mm') as Seated, Format(dbo.tblappointments.Dismissed,N'hh\:mm') As Dismissed,
dbo.tblappointments.AppDate, Case when cast(dbo.tblappointments.AppDate as time) = '00:00:00' then null else
Format(dbo.tblappointments.AppDate,N'hh\:mm') End as apptime 
                        ,dbo.tblPatientType.PatientType  ,dbo.tblpatients.PatientName, dbo.HasVisit(dbo.tblappointments.PersonID, dbo.tblappointments.AppDate) AS HasVisit
FROM            dbo.tblappointments INNER JOIN
                         dbo.tblpatients ON dbo.tblappointments.PersonID = dbo.tblpatients.PersonID left outer join
						 dbo.tblPatientType on dbo.tblpatients.PatientTypeID = dbo.tblPatientType.ID
where cast( dbo.tblappointments.AppDate as date) = @appsdate
order by (case when dbo.tblappointments.Present is null then 1 else 0 End) ,
 dbo.tblappointments.AppDate
GO
/****** Object:  StoredProcedure [dbo].[UpdateDolph]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE PROCEDURE  [dbo].[UpdateDolph] @FN varchar(50),@LN varchar(50),@BD datetime, @ID Varchar(50), @Ge as char(1)
	-- Add the parameters for the stored procedure here
	
AS
BEGIN
	
	SET NOCOUNT ON;

  
	Update [DolphinPlatform].dbo.[Patients]
           set [patFirstName] = @FN,
			   [patLastName] = @LN,
               [patBirthdate] = @BD,
			   [patGender] = @Ge,
			   [patName] = @FN + ' ' + @LN,
		   [patIndexName] = @LN + ', ' + @FN
           Where [patOtherID] = @ID
      
          
Select @@ROWCOUNT As Added
END
GO
/****** Object:  StoredProcedure [dbo].[UpdatePresent]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE procedure [dbo].[UpdatePresent] 
@Aid as int,
@state as varchar(100), 
@Tim as time(0)
As
Begin
declare @Sql Nvarchar(4000) 
 SET @SQL = 'UPDATE tblappointments SET ' + @state + ' = ''' + cast(@tim as varchar(100)) + ''' where
 AppointmentID = ' + cast(@Aid as varchar(10)) 
 execute sp_executesql @sql
 End
GO
/****** Object:  StoredProcedure [dbo].[UpdateSingleMessageStatus]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE PROCEDURE [dbo].[UpdateSingleMessageStatus]
    @MessageId nvarchar(100),
    @Status nvarchar(50),
    @LastUpdated datetime,
    @Result int OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    
    DECLARE @AppointmentID int;
    
    -- First find the appointment by message ID
    SELECT @AppointmentID = appointmentID 
    FROM dbo.tblappointments
    WHERE WaMessageID = @MessageId;
    
    -- If found, update the status
    IF @AppointmentID IS NOT NULL
    BEGIN
        UPDATE dbo.tblappointments
        SET 
            DeliveredWA = @Status,
            WantNotify = CASE 
                WHEN @Status IN ('READ', 'DEVICE', 'SERVER') THEN 0 
                ELSE WantNotify 
            END,
            LastUpdated = @LastUpdated,
            -- Set appropriate timestamp based on status
            DeliveredTimestamp = CASE 
                WHEN @Status IN ('DEVICE', 'SERVER') AND DeliveredTimestamp IS NULL THEN @LastUpdated
                ELSE DeliveredTimestamp
            END,
            ReadTimestamp = CASE 
                WHEN @Status = 'READ' AND ReadTimestamp IS NULL THEN @LastUpdated
                ELSE ReadTimestamp
            END
        WHERE appointmentID = @AppointmentID;
        
        -- Return the updated appointment info
        SELECT 
            a.appointmentID,
            p.PatientName,
            p.Phone,
            a.DeliveredWA,
            a.LastUpdated
        FROM dbo.tblappointments a
        JOIN dbo.tblpatients p ON a.PersonID = p.PersonID
        WHERE a.appointmentID = @AppointmentID;
        
        SET @Result = 1; -- Success
    END
    ELSE
    BEGIN
        SET @Result = 0; -- Not found
    END
END
GO
/****** Object:  StoredProcedure [dbo].[UpdateWhatsAppDeliveryStatus]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROCEDURE [dbo].[UpdateWhatsAppDeliveryStatus]
    @AIDS as WhatsTableType READONLY
AS
BEGIN
    SET NOCOUNT ON;
    
    -- Update delivery status with timestamps based on status
    UPDATE A SET 
        A.DeliveredWA = W.DeliveredWA, 
		 A.WaMessageID = W.WaMessageID,
        A.WantNotify = CASE 
            WHEN W.DeliveredWA IN ('READ', 'DEVICE', 'SERVER') THEN 0 
            ELSE A.WantNotify 
        END,
        A.LastUpdated = W.LastUpdated,
        -- Set appropriate timestamp based on status
        A.DeliveredTimestamp = CASE 
            WHEN W.DeliveredWA IN ('DEVICE', 'SERVER') AND A.DeliveredTimestamp IS NULL THEN W.LastUpdated
            ELSE A.DeliveredTimestamp
        END,
        A.ReadTimestamp = CASE 
            WHEN W.DeliveredWA = 'READ' AND A.ReadTimestamp IS NULL THEN W.LastUpdated
            ELSE A.ReadTimestamp
        END
    FROM dbo.tblappointments AS A 
    INNER JOIN @AIDS AS W ON A.appointmentID = W.appointmentID;
    
    -- Return status counts for logging
    SELECT 
        COUNT(*) AS TotalUpdated,
        SUM(CASE WHEN DeliveredWA = 'READ' THEN 1 ELSE 0 END) AS ReadCount,
        SUM(CASE WHEN DeliveredWA = 'DEVICE' THEN 1 ELSE 0 END) AS DeliveredCount,
        SUM(CASE WHEN DeliveredWA = 'SERVER' THEN 1 ELSE 0 END) AS ServerCount
    FROM dbo.tblappointments
    WHERE appointmentID IN (SELECT appointmentID FROM @AIDS);
END
GO
/****** Object:  StoredProcedure [dbo].[UpdateWhatsAppStatus]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE PROCEDURE [dbo].[UpdateWhatsAppStatus]
    @AIDS as WhatsTableType READONLY
AS
BEGIN
    SET NOCOUNT ON;
    
    -- Update status and set WantWa to 0 as in the original ProcWAResult,
    -- but also set the SentTimestamp
    UPDATE dbo.tblappointments 
    SET 
        dbo.tblappointments.SentWA = W.SentWA,
        dbo.tblappointments.WaMessageID = W.WaMessageID,
        dbo.tblappointments.WantWa = 0,
        dbo.tblappointments.SentTimestamp = W.SentTimestamp
    FROM dbo.tblappointments AS A 
    INNER JOIN @AIDS AS W ON A.appointmentID = W.appointmentID;
    
    -- Return the count of updated records
    SELECT @@ROWCOUNT AS UpdatedCount;
END
GO
/****** Object:  StoredProcedure [dbo].[VisitsPhotoforOne]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE PROCEDURE [dbo].[VisitsPhotoforOne]
@ID int
AS
BEGIN
	-- SET NOCOUNT ON added to prevent extra result sets from
	-- interfering with SELECT statements.
	SET NOCOUNT ON;
select case 
when V.IPhoto = 1 and v.PPhoto = 0 Then 'Initial Photos'
when v.PPhoto = 1 and V.IPhoto = 0 Then 'Progress Photos'
when V.FPhoto = 1 Then 'Final Photos' 
when V.IPhoto = 1 and v.PPhoto = 1 Then 'Initial and Progress'
End as Type,
v.VisitDate
from ShwanNew.dbo.tblvisits v
where (v.IPhoto = 1 or v.FPhoto = 1 or v.PPhoto = 1) and v.WorkID = 
(select workid from tblwork w where w.PersonID = @ID and Finished = 0)
END
GO
/****** Object:  StoredProcedure [dbo].[WorkPhotoDates]    Script Date: 23/05/2025 7:28:10 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE PROCEDURE [dbo].[WorkPhotoDates]
	-- Add the parameters for the stored procedure here
@ID int
AS
BEGIN
	-- SET NOCOUNT ON added to prevent extra result sets from
	-- interfering with SELECT statements.
	SET NOCOUNT ON;

   Select 'Initial Photos' As Photos, w.IPhotoDate,'Initial'
from tblwork w where PersonID = @ID and Finished = 0
union all
select 'Final Photos',w.FPhotoDate, 'Final'
from tblwork w where PersonID = @ID and finished = 0
END
GO
