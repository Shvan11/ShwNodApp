USE [master]
GO
/****** Object:  Database [ShwanNew]    Script Date: 15/05/2026 12:26:58 pm ******/
CREATE DATABASE [ShwanNew]
 CONTAINMENT = NONE
 ON  PRIMARY 
( NAME = N'ShwanNew', FILENAME = N'C:\Program Files\Microsoft SQL Server\MSSQL16.DOLPHIN\MSSQL\DATA\ShwanNew.mdf' , SIZE = 109120KB , MAXSIZE = UNLIMITED, FILEGROWTH = 65536KB )
 LOG ON 
( NAME = N'ShwanNew_log', FILENAME = N'C:\Program Files\Microsoft SQL Server\MSSQL16.DOLPHIN\MSSQL\DATA\ShwanNew.ldf' , SIZE = 8192KB , MAXSIZE = 2048GB , FILEGROWTH = 65536KB )
 WITH CATALOG_COLLATION = DATABASE_DEFAULT, LEDGER = OFF
GO
ALTER DATABASE [ShwanNew] SET COMPATIBILITY_LEVEL = 140
GO
IF (1 = FULLTEXTSERVICEPROPERTY('IsFullTextInstalled'))
begin
EXEC [ShwanNew].[dbo].[sp_fulltext_database] @action = 'enable'
end
GO
ALTER DATABASE [ShwanNew] SET ANSI_NULL_DEFAULT OFF 
GO
ALTER DATABASE [ShwanNew] SET ANSI_NULLS OFF 
GO
ALTER DATABASE [ShwanNew] SET ANSI_PADDING OFF 
GO
ALTER DATABASE [ShwanNew] SET ANSI_WARNINGS OFF 
GO
ALTER DATABASE [ShwanNew] SET ARITHABORT OFF 
GO
ALTER DATABASE [ShwanNew] SET AUTO_CLOSE OFF 
GO
ALTER DATABASE [ShwanNew] SET AUTO_SHRINK OFF 
GO
ALTER DATABASE [ShwanNew] SET AUTO_UPDATE_STATISTICS ON 
GO
ALTER DATABASE [ShwanNew] SET CURSOR_CLOSE_ON_COMMIT OFF 
GO
ALTER DATABASE [ShwanNew] SET CURSOR_DEFAULT  GLOBAL 
GO
ALTER DATABASE [ShwanNew] SET CONCAT_NULL_YIELDS_NULL OFF 
GO
ALTER DATABASE [ShwanNew] SET NUMERIC_ROUNDABORT OFF 
GO
ALTER DATABASE [ShwanNew] SET QUOTED_IDENTIFIER OFF 
GO
ALTER DATABASE [ShwanNew] SET RECURSIVE_TRIGGERS OFF 
GO
ALTER DATABASE [ShwanNew] SET  DISABLE_BROKER 
GO
ALTER DATABASE [ShwanNew] SET AUTO_UPDATE_STATISTICS_ASYNC OFF 
GO
ALTER DATABASE [ShwanNew] SET DATE_CORRELATION_OPTIMIZATION OFF 
GO
ALTER DATABASE [ShwanNew] SET TRUSTWORTHY OFF 
GO
ALTER DATABASE [ShwanNew] SET ALLOW_SNAPSHOT_ISOLATION OFF 
GO
ALTER DATABASE [ShwanNew] SET PARAMETERIZATION SIMPLE 
GO
ALTER DATABASE [ShwanNew] SET READ_COMMITTED_SNAPSHOT OFF 
GO
ALTER DATABASE [ShwanNew] SET HONOR_BROKER_PRIORITY OFF 
GO
ALTER DATABASE [ShwanNew] SET RECOVERY SIMPLE 
GO
ALTER DATABASE [ShwanNew] SET  MULTI_USER 
GO
ALTER DATABASE [ShwanNew] SET PAGE_VERIFY CHECKSUM  
GO
ALTER DATABASE [ShwanNew] SET DB_CHAINING OFF 
GO
ALTER DATABASE [ShwanNew] SET FILESTREAM( NON_TRANSACTED_ACCESS = OFF ) 
GO
ALTER DATABASE [ShwanNew] SET TARGET_RECOVERY_TIME = 60 SECONDS 
GO
ALTER DATABASE [ShwanNew] SET DELAYED_DURABILITY = DISABLED 
GO
ALTER DATABASE [ShwanNew] SET ACCELERATED_DATABASE_RECOVERY = OFF  
GO
ALTER DATABASE [ShwanNew] SET QUERY_STORE = OFF
GO
USE [ShwanNew]
GO
ALTER DATABASE SCOPED CONFIGURATION SET IDENTITY_CACHE = OFF;
GO
USE [ShwanNew]
GO
/****** Object:  Schema [History]    Script Date: 15/05/2026 12:26:58 pm ******/
CREATE SCHEMA [History]
GO
/****** Object:  UserDefinedTableType [dbo].[SMSStatusType]    Script Date: 15/05/2026 12:26:58 pm ******/
CREATE TYPE [dbo].[SMSStatusType] AS TABLE(
	[AppointmentID] [int] NULL,
	[SMSStatus] [nvarchar](255) NULL,
	[sms_sid] [nvarchar](255) NULL
)
GO
/****** Object:  UserDefinedTableType [dbo].[WhatsTableType]    Script Date: 15/05/2026 12:26:58 pm ******/
CREATE TYPE [dbo].[WhatsTableType] AS TABLE(
	[AppointmentID] [int] NULL,
	[SentWa] [bit] NULL,
	[DeliveredWa] [nvarchar](50) NULL,
	[WaMessageID] [nvarchar](255) NULL
)
GO
/****** Object:  UserDefinedFunction [dbo].[ArabicDay]    Script Date: 15/05/2026 12:26:58 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date, ,>
-- Description:	<Description, ,>
-- =============================================
CREATE FUNCTION [dbo].[ArabicDay]
(
	-- Add the parameters for the function here
	@date date)
RETURNS NVarchar(10)
AS
BEGIN
	-- Declare the return variable here
	DECLARE @dayname Nvarchar(10);
	Declare @daynum tinyint;
	set @daynum = datepart(weekday,@date);

	-- Add the T-SQL statements to compute the return value here
	SELECT @dayname = case
	when @daynum =  7 then 'ألسبت'
	when @daynum =  1 then 'ألاحد'
	when @daynum =  2 then 'ألاثنين'
	when @daynum =  3 then 'ألثلاثاء'
	when @daynum =  4 then 'ألاربعاء'
	when @daynum =  5 then 'ألخميس'
	end
	return @dayname
END
GO
/****** Object:  UserDefinedFunction [dbo].[CheckAppo]    Script Date: 15/05/2026 12:26:58 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE FUNCTION [dbo].[CheckAppo] (
    @PersonID Int,
	@Date Datetime2(0)
)
RETURNS Varchar(100)
AS
BEGIN
Declare @ReturnV VARCHAR(5)
Declare @date2 date
set @date2 = @Date
    IF EXISTS (SELECT * FROM tblappointments WHERE PersonID = @personID and cast(AppDate as date) = @Date2)
        set @ReturnV = 'True';
		else set @ReturnV = 'False';
		
    return @ReturnV

END
GO
/****** Object:  UserDefinedFunction [dbo].[FuncTotalPaid]    Script Date: 15/05/2026 12:26:58 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date, ,>
-- Description:	<Description, ,>
-- =============================================
CREATE FUNCTION [dbo].[FuncTotalPaid]
(
	@wd int
)
RETURNS bit
AS
BEGIN
Declare @Result bit
Declare @Sum int
Declare @Tot int
Set @sum = (SELECT sum(Amountpaid) FROM [dbo].[tblInvoice] where workid = @wd)
Set @Tot = (select w.TotalRequired from dbo.tblwork w where workid = @wd) 	
	if @sum > @tot
	set @Result = 0;
	else
		set @Result = 1;
 Return @result

END

GO
/****** Object:  UserDefinedFunction [dbo].[FuncTotalPaidW]    Script Date: 15/05/2026 12:26:58 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO


-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date, ,>
-- Description:	<Description, ,>
-- =============================================
CREATE FUNCTION [dbo].[FuncTotalPaidW]
(
	@wd int,
	@TotReq int
)
RETURNS bit
AS
BEGIN
Declare @Result bit
Declare @Sum int
Declare @Tot int
Set @sum = (SELECT sum(Amountpaid) FROM [dbo].[tblInvoice] where workid = @wd)
Set @Tot = (select w.TotalRequired from dbo.tblwork w where workid = @wd) 	
	if @sum > @Tot
	set @Result = 0;
	else
		set @Result = 1;
 Return @result

END

GO
/****** Object:  UserDefinedFunction [dbo].[HasVisit]    Script Date: 15/05/2026 12:26:58 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date, ,>
-- Description:	<Description, ,>
-- =============================================
CREATE FUNCTION [dbo].[HasVisit]
(
	@PID int , @VisDate Date
)
RETURNS bit
 
AS
BEGIN
	-- Declare the return variable here
	DECLARE @Valu bit 

	-- Add the T-SQL statements to compute the return value here
	if (exists (SELECT        dbo.tblvisits.ID, dbo.tblwork.PersonID, tblvisits.VisitDate
FROM            dbo.tblwork INNER JOIN
                         dbo.tblvisits ON dbo.tblwork.workid = dbo.tblvisits.WorkID
WHERE        (dbo.tblwork.PersonID = @PID) AND (dbo.tblvisits.VisitDate = @VisDate)))

 set @Valu = 1;
else 
set @Valu = 0

	-- Return the result of the function
	RETURN @Valu
END
GO
/****** Object:  UserDefinedFunction [dbo].[IsFirstAppo]    Script Date: 15/05/2026 12:26:58 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date, ,>
-- Description:	<Description, ,>
-- =============================================
CREATE FUNCTION [dbo].[IsFirstAppo] 
(
	@PID int
)
RETURNS Bit
AS
BEGIN
	Declare @ReturnV Bit
	 IF EXISTS (SELECT * FROM tblappointments WHERE PersonID = @PID )
        set @ReturnV = 0;
		else set @ReturnV = 1;
		
    Return @ReturnV


END
GO
/****** Object:  Table [dbo].[tblwork]    Script Date: 15/05/2026 12:26:58 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblwork](
	[workid] [int] IDENTITY(1,1) NOT NULL,
	[PersonID] [int] NOT NULL,
	[TotalRequired] [int] NOT NULL,
	[Currency] [nvarchar](255) NULL,
	[Typeofwork] [int] NULL,
	[Notes] [nvarchar](255) NULL,
	[Finished] [bit] NOT NULL,
	[AdditionDate] [datetime2](0) NULL,
	[KeyWordID1] [int] NULL,
	[KeyWordID2] [int] NULL,
	[KeywordID3] [int] NULL,
	[StartDate] [date] NULL,
	[DebondDate] [date] NULL,
	[FPhotoDate] [date] NULL,
	[IPhotoDate] [date] NULL,
	[EstimatedDuration] [tinyint] NULL,
	[DrID] [int] NOT NULL,
	[KeywordID4] [int] NULL,
	[NotesDate] [date] NULL,
	[KeywordID5] [int] NULL,
	[ActiveAlignerSetID] [int] NULL,
 CONSTRAINT [tblwork$PrimaryKey] PRIMARY KEY CLUSTERED 
(
	[workid] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[tblpatients]    Script Date: 15/05/2026 12:26:58 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblpatients](
	[PersonID] [int] IDENTITY(1,1) NOT NULL,
	[patientID] [nvarchar](6) NULL,
	[PatientName] [nvarchar](255) NOT NULL,
	[Phone] [nvarchar](255) NULL,
	[FirstName] [nvarchar](255) NULL,
	[LastName] [nvarchar](255) NULL,
	[DateofBirth] [date] NULL,
	[Gender] [int] NULL,
	[Phone2] [nvarchar](255) NULL,
	[AddressID] [int] NULL,
	[DateAdded] [datetime2](0) NULL,
	[ReferralSourceID] [int] NULL,
	[EstimatedCost] [int] NULL,
	[Currency] [nvarchar](255) NULL,
	[PatientTypeID] [int] NULL,
	[Notes] [nvarchar](100) NULL,
	[Email] [nchar](255) NULL,
	[Alerts] [nvarchar](255) NULL,
	[Language] [tinyint] NULL,
	[Age]  AS (CONVERT([decimal](3,1),datediff(month,[DateofBirth],getdate())/CONVERT([decimal](3,1),(12)))),
 CONSTRAINT [tblpatients$PrimaryKey] PRIMARY KEY CLUSTERED 
(
	[PersonID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
/****** Object:  View [dbo].[V_Works]    Script Date: 15/05/2026 12:26:58 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
/* Alter View V_Works*/
CREATE VIEW [dbo].[V_Works]
AS
SELECT dbo.tblpatients.PatientName, dbo.tblwork.workid, dbo.tblwork.PersonID, dbo.tblwork.TotalRequired, dbo.tblwork.Currency, dbo.tblwork.Typeofwork, dbo.tblwork.Notes, dbo.tblwork.Finished, dbo.tblwork.AdditionDate, dbo.tblwork.KeyWordID1, dbo.tblwork.KeyWordID2, dbo.tblwork.KeywordID3, dbo.tblwork.StartDate, dbo.tblwork.DebondDate, dbo.tblwork.FPhotoDate, dbo.tblwork.IPhotoDate, dbo.tblwork.EstimatedDuration, dbo.tblwork.DrID, 
         dbo.tblpatients.PatientTypeID
FROM  dbo.tblpatients INNER JOIN
         dbo.tblwork ON dbo.tblpatients.PersonID = dbo.tblwork.PersonID
GO
/****** Object:  Table [History].[tblInvoice]    Script Date: 15/05/2026 12:26:58 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [History].[tblInvoice](
	[invoiceID] [int] NOT NULL,
	[Amountpaid] [int] NOT NULL,
	[Dateofpayment] [date] NOT NULL,
	[workid] [int] NOT NULL,
	[SysStartTime] [datetime2](7) NOT NULL,
	[SysEndTime] [datetime2](7) NOT NULL,
	[ActualAmount] [int] NULL,
	[ActualCur] [nvarchar](255) NULL,
	[Change] [int] NULL
) ON [PRIMARY]
WITH
(
DATA_COMPRESSION = PAGE
)
GO
/****** Object:  Index [ix_tblInvoice]    Script Date: 15/05/2026 12:26:58 pm ******/
CREATE CLUSTERED INDEX [ix_tblInvoice] ON [History].[tblInvoice]
(
	[SysEndTime] ASC,
	[SysStartTime] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF, DATA_COMPRESSION = PAGE) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[tblInvoice]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblInvoice](
	[invoiceID] [int] IDENTITY(1,1) NOT NULL,
	[Amountpaid] [int] NOT NULL,
	[Dateofpayment] [date] NOT NULL,
	[workid] [int] NOT NULL,
	[SysStartTime] [datetime2](7) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
	[SysEndTime] [datetime2](7) GENERATED ALWAYS AS ROW END HIDDEN NOT NULL,
	[ActualAmount] [int] NULL,
	[ActualCur] [nvarchar](255) NULL,
	[Change] [int] NULL,
 CONSTRAINT [tblInvoice$PrimaryKey] PRIMARY KEY CLUSTERED 
(
	[invoiceID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY],
	PERIOD FOR SYSTEM_TIME ([SysStartTime], [SysEndTime])
) ON [PRIMARY]
WITH
(
SYSTEM_VERSIONING = ON (HISTORY_TABLE = [History].[tblInvoice])
)
GO
/****** Object:  View [dbo].[VTotPaid]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE VIEW [dbo].[VTotPaid]
AS
SELECT dbo.tblwork.workid, SUM(dbo.tblInvoice.Amountpaid) AS TotalPaid, MAX(dbo.tblInvoice.Dateofpayment) AS LastPaymrntDate, dbo.tblwork.TotalRequired
FROM   dbo.tblwork LEFT OUTER JOIN
             dbo.tblInvoice ON dbo.tblwork.workid = dbo.tblInvoice.workid
GROUP BY dbo.tblwork.workid, dbo.tblwork.TotalRequired
GO
/****** Object:  Table [dbo].[tblappointments]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblappointments](
	[appointmentID] [int] IDENTITY(1,1) NOT NULL,
	[PersonID] [int] NOT NULL,
	[AppDetail] [nvarchar](255) NULL,
	[WantNotify] [bit] NULL,
	[Notified] [bit] NULL,
	[SMSStatus] [nvarchar](255) NULL,
	[Present] [time](0) NULL,
	[Seated] [time](0) NULL,
	[Dismissed] [time](0) NULL,
	[SSMA_TimeStamp] [timestamp] NOT NULL,
	[AppDate] [datetime2](0) NOT NULL,
	[AppDay]  AS (CONVERT([date],[Appdate])) PERSISTED,
	[AppCost] [nvarchar](50) NULL,
	[SentWa] [bit] NULL,
	[DeliveredWa] [nvarchar](50) NULL,
	[WantWa] [bit] NULL,
	[WaMessageID] [nvarchar](255) NULL,
	[sms_sid] [nvarchar](255) NULL,
	[AppTime]  AS (CONVERT([time],[AppDate])) PERSISTED,
	[DrID] [int] NULL,
 CONSTRAINT [PK_tblappointments] PRIMARY KEY NONCLUSTERED 
(
	[appointmentID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY],
 CONSTRAINT [IX_SingleApp] UNIQUE NONCLUSTERED 
(
	[PersonID] ASC,
	[AppDay] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
/****** Object:  Index [IX_ID]    Script Date: 15/05/2026 12:26:59 pm ******/
CREATE UNIQUE CLUSTERED INDEX [IX_ID] ON [dbo].[tblappointments]
(
	[appointmentID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, IGNORE_DUP_KEY = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  View [dbo].[VLastApp]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE VIEW [dbo].[VLastApp]
WITH SCHEMABINDING 
AS
SELECT dbo.tblappointments.PersonID, dbo.tblappointments.AppDate, dbo.tblappointments.appointmentID, dbo.tblappointments.AppTime
FROM  dbo.tblappointments INNER JOIN
             (SELECT PersonID, MAX(AppDate) AS MaxDate
           FROM   dbo.tblappointments AS tblappointments_1
           GROUP BY PersonID) AS T ON T.PersonID = dbo.tblappointments.PersonID AND T.MaxDate = dbo.tblappointments.AppDate
WHERE (dbo.tblappointments.AppDate > GETDATE())
GO
/****** Object:  View [dbo].[V_ActiveWork]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE VIEW [dbo].[V_ActiveWork]
AS
SELECT PersonID, workid, TotalRequired, Currency, Notes, Finished, Typeofwork
FROM   dbo.tblwork AS w
WHERE (Finished = 0)
GO
/****** Object:  View [dbo].[V_WorkCounts]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE VIEW [dbo].[V_WorkCounts]
AS
SELECT PersonID, COUNT(workid) AS Work_Counts
FROM  dbo.tblwork
GROUP BY PersonID
GO
/****** Object:  View [dbo].[V_Spatient]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE VIEW [dbo].[V_Spatient]
AS
SELECT dbo.tblpatients.PersonID, dbo.tblpatients.patientID, dbo.tblpatients.PatientName, dbo.tblpatients.Phone, '\\CLINIC\Working\' + CAST(dbo.tblpatients.PersonID AS VarChar(10)) + '00.I13' AS Picture, dbo.VTotPaid.TotalPaid, dbo.VLastApp.AppDate, dbo.VTotPaid.LastPaymrntDate, dbo.V_ActiveWork.workid, 
           dbo.V_ActiveWork.TotalRequired, dbo.V_ActiveWork.Currency, dbo.V_ActiveWork.Notes, dbo.tblpatients.PatientTypeID, dbo.tblpatients.FirstName, dbo.tblpatients.LastName, dbo.tblpatients.EstimatedCost, dbo.tblpatients.Currency AS Ecur, dbo.tblpatients.Alerts, dbo.VLastApp.AppTime, dbo.tblpatients.Notes AS PNotes, 
           dbo.V_WorkCounts.Work_Counts, CASE WHEN tblpatients.PersonID IN
               (SELECT PersonID
              FROM   tblwork w INNER JOIN
                         VTotPaid t ON w.workid = t .workid
              WHERE ((t .TotalPaid IS NULL AND t .TotalRequired <> 0) OR
                         t .TotalRequired - t .TotalPaid <> 0) AND w.Finished = 1) THEN 1 ELSE 0 END AS unpaid, dbo.V_ActiveWork.Typeofwork
FROM   dbo.V_WorkCounts RIGHT OUTER JOIN
           dbo.tblpatients ON dbo.V_WorkCounts.PersonID = dbo.tblpatients.PersonID LEFT OUTER JOIN
           dbo.VTotPaid RIGHT OUTER JOIN
           dbo.V_ActiveWork ON dbo.VTotPaid.workid = dbo.V_ActiveWork.workid ON dbo.tblpatients.PersonID = dbo.V_ActiveWork.PersonID LEFT OUTER JOIN
           dbo.VLastApp ON dbo.tblpatients.PersonID = dbo.VLastApp.PersonID
GO
/****** Object:  Table [dbo].[tblvisits]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblvisits](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[WorkID] [int] NOT NULL,
	[VisitDate] [datetime2](0) NOT NULL,
	[BracketChange] [nvarchar](255) NULL,
	[WireBending] [nvarchar](255) NULL,
	[OPG] [bit] NULL,
	[Others] [nvarchar](255) NULL,
	[NextVisit] [nvarchar](255) NULL,
	[Elastics] [nvarchar](255) NULL,
	[UpperWireID] [int] NULL,
	[LowerWireID] [int] NULL,
	[PPhoto] [bit] NULL,
	[IPhoto] [bit] NULL,
	[FPhoto] [bit] NULL,
	[ApplianceRemoved] [bit] NULL,
	[OperatorID] [int] NULL,
	[BatchDeliveredID] [int] NULL,
	[IPR] [nvarchar](500) NULL,
	[Attachments] [nvarchar](500) NULL,
 CONSTRAINT [tblvisits$PrimaryKey] PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
/****** Object:  View [dbo].[V_lastvisit]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
-- Alter View V_lastvisit
CREATE VIEW [dbo].[V_lastvisit]
AS 
   /*Generated by SQL Server Migration Assistant for Access version 7.11.0.*/
   SELECT [tblvisits].[WorkID], Max([tblvisits].[VisitDate]) AS LastVisit
   FROM [tblvisits]
   GROUP BY [tblvisits].[WorkID]
GO
/****** Object:  View [dbo].[V_TodayPayment]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE VIEW [dbo].[V_TodayPayment]
AS
SELECT i.workid, i.Amountpaid, i.Dateofpayment
FROM   dbo.tblInvoice AS i INNER JOIN
                 (SELECT workid, MAX(Dateofpayment) AS LastPayment
                 FROM    dbo.tblInvoice
                 GROUP BY workid) AS w ON w.workid = i.workid AND w.LastPayment = i.Dateofpayment
WHERE (w.LastPayment = CAST(GETDATE() AS date))
GO
/****** Object:  Table [dbo].[tblvideos]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblvideos](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[Description] [nvarchar](255) NOT NULL,
	[Category] [int] NULL,
	[URL] [nvarchar](255) NULL,
	[Details] [nvarchar](255) NULL,
	[FileName] [nvarchar](255) NULL,
	[VideoExtension] [nvarchar](255) NULL,
 CONSTRAINT [tblvideos$PrimaryKey] PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[tbloptions]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tbloptions](
	[OptionName] [nvarchar](255) NOT NULL,
	[OptionValue] [nvarchar](255) NULL,
 CONSTRAINT [tbloptions$PrimaryKey] PRIMARY KEY CLUSTERED 
(
	[OptionName] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
/****** Object:  View [dbo].[V_Videos]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE VIEW [dbo].[V_Videos]
AS
WITH CTE(Path) AS (SELECT OptionValue
                                        FROM      dbo.tbloptions
                                        WHERE   (OptionName = 'VideosPath'))
    SELECT dbo.tblvideos.ID, dbo.tblvideos.Description, CTE_1.Path + dbo.tblvideos.FileName + '.' + dbo.tblvideos.VideoExtension AS Video, CTE_1.Path + dbo.tblvideos.FileName + '.jpg' AS Image, dbo.tblvideos.Category, dbo.tblvideos.Details
    FROM     dbo.tblvideos CROSS JOIN
                      CTE AS CTE_1
GO
/****** Object:  View [dbo].[V_Dol_TP]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
/*WHERE        (tp.tpDescription = 'Final')*/
CREATE VIEW [dbo].[V_Dol_TP]
AS
SELECT        dbo.tblpatients.PersonID, dolp.patID, tp.tpDateTime, tp.tpDescription, dbo.tblwork.IPhotoDate, dbo.tblwork.FPhotoDate, dbo.tblpatients.PatientName, dbo.tblwork.workid, dbo.tblwork.KeyWordID1, dbo.tblwork.KeyWordID2, 
                         dbo.tblwork.KeywordID3, dbo.tblwork.Finished
FROM            dbo.tblpatients INNER JOIN
                         DolphinPlatform.dbo.Patients AS dolp ON CAST(dbo.tblpatients.PersonID AS varchar) = dolp.patOtherID INNER JOIN
                         DolphinPlatform.dbo.TimePoints AS tp ON dolp.patID = tp.patID INNER JOIN
                         dbo.tblwork ON dbo.tblpatients.PersonID = dbo.tblwork.PersonID
WHERE        (tp.tpDescription = 'final')
GO
/****** Object:  Table [dbo].[tblPatientType]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblPatientType](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[PatientType] [varchar](50) NULL,
 CONSTRAINT [PK_tblPatientType] PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
/****** Object:  View [dbo].[V_PresentTodayApps]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE VIEW [dbo].[V_PresentTodayApps]
AS
SELECT dbo.tblappointments.appointmentID, dbo.tblappointments.PersonID, dbo.tblappointments.AppDetail, format(dbo.tblappointments.Present, N'hh\:mm') AS Present, Format(dbo.tblappointments.Seated, N'hh\:mm') AS Seated, Format(dbo.tblappointments.Dismissed, N'hh\:mm') AS Dismissed, dbo.tblappointments.AppDate, dbo.tblappointments.AppCost, CASE WHEN CAST(dbo.tblappointments.AppDate AS time) = '00:00:00' THEN NULL ELSE Format(dbo.tblappointments.AppDate, 
         N'hh\:mm') END AS apptime, CAST(dbo.tblappointments.AppDate AS date) AS AppoDate, dbo.tblPatientType.PatientType, dbo.tblpatients.PatientName, dbo.tblpatients.Alerts, dbo.HasVisit(dbo.tblappointments.PersonID, dbo.tblappointments.AppDate) AS HasVisit
FROM  dbo.tblappointments INNER JOIN
         dbo.tblpatients ON dbo.tblappointments.PersonID = dbo.tblpatients.PersonID LEFT OUTER JOIN
         dbo.tblPatientType ON dbo.tblpatients.PatientTypeID = dbo.tblPatientType.ID
WHERE (dbo.tblappointments.Present IS NOT NULL)
GO
/****** Object:  View [dbo].[V_WrkFrmSrc]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE VIEW [dbo].[V_WrkFrmSrc]
AS
SELECT   dbo.tblpatients.PatientName, dbo.VTotPaid.TotalPaid, dbo.tblwork.workid, dbo.tblwork.PersonID, dbo.tblwork.TotalRequired, dbo.tblwork.Currency, dbo.tblwork.Typeofwork, dbo.tblwork.Notes, dbo.tblwork.Finished, dbo.tblwork.AdditionDate, dbo.tblwork.KeyWordID1, dbo.tblwork.KeyWordID2, dbo.tblwork.KeywordID3, dbo.tblwork.StartDate, 
             dbo.tblwork.DebondDate, dbo.tblwork.FPhotoDate, dbo.tblwork.IPhotoDate, dbo.tblwork.EstimatedDuration, dbo.tblwork.DrID, dbo.VTotPaid.LastPaymrntDate, dbo.tblpatients.PatientTypeID, dbo.tblwork.KeywordID4, dbo.tblwork.KeywordID5
FROM     dbo.tblpatients INNER JOIN
             dbo.tblwork ON dbo.tblpatients.PersonID = dbo.tblwork.PersonID LEFT OUTER JOIN
             dbo.VTotPaid ON dbo.tblwork.workid = dbo.VTotPaid.workid
GO
/****** Object:  View [dbo].[V_WorkKW]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
/* Alter View V_WorkKW*/
CREATE VIEW [dbo].[V_WorkKW]
AS
SELECT TOP (9999999) dbo.tblwork.PersonID, dbo.tblpatients.PatientName, dbo.tblwork.workid, dbo.tblwork.Finished, dbo.tblwork.KeyWordID1, dbo.tblwork.KeyWordID2, dbo.tblwork.KeywordID3, dbo.tblwork.FPhotoDate, dbo.tblwork.KeywordID4
FROM  dbo.tblwork INNER JOIN
         dbo.tblpatients ON dbo.tblwork.PersonID = dbo.tblpatients.PersonID
WHERE (dbo.tblwork.FPhotoDate IS NOT NULL)
ORDER BY dbo.tblwork.FPhotoDate
GO
/****** Object:  View [dbo].[V_Work_Visits]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
/* Alter View V_Work_Visits*/
CREATE VIEW [dbo].[V_Work_Visits]
AS
SELECT dbo.tblwork.PersonID, dbo.tblpatients.PatientName, dbo.tblwork.StartDate, dbo.tblwork.EstimatedDuration, dbo.tblvisits.ID, dbo.tblvisits.WorkID, dbo.tblvisits.VisitDate, dbo.tblvisits.BracketChange, dbo.tblvisits.WireBending, dbo.tblvisits.OPG, dbo.tblvisits.Others, dbo.tblvisits.NextVisit, dbo.tblvisits.Elastics, dbo.tblvisits.UpperWireID, dbo.tblvisits.LowerWireID, dbo.tblvisits.PPhoto, dbo.tblvisits.IPhoto, dbo.tblvisits.FPhoto, dbo.tblvisits.ApplianceRemoved, 
         dbo.tblwork.Finished
FROM  dbo.tblwork INNER JOIN
         dbo.tblvisits ON dbo.tblwork.workid = dbo.tblvisits.WorkID INNER JOIN
         dbo.tblpatients ON dbo.tblwork.PersonID = dbo.tblpatients.PersonID
GO
/****** Object:  Table [dbo].[tblExpenses]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblExpenses](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[expenseDate] [date] NOT NULL,
	[Amount] [int] NOT NULL,
	[Currency] [nchar](10) NULL,
	[Note] [nvarchar](100) NULL,
	[CategoryID] [int] NULL,
	[SubcategoryID] [int] NULL,
 CONSTRAINT [PK_tblExpenses] PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
/****** Object:  View [dbo].[V_EIQ]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE VIEW [dbo].[V_EIQ]
AS
SELECT expenseDate AS EIDateQ, - SUM(Amount) AS SumExQ
FROM     dbo.tblExpenses
WHERE  (Currency = 'IQD')
GROUP BY expenseDate
GO
/****** Object:  View [dbo].[VIQD]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE VIEW [dbo].[VIQD]
AS
SELECT        dbo.tblInvoice.Dateofpayment, SUM(dbo.tblInvoice.Amountpaid) AS SumIQD, MONTH(dbo.tblInvoice.Dateofpayment) AS month, YEAR(dbo.tblInvoice.Dateofpayment) AS Year
FROM            dbo.tblInvoice INNER JOIN
                         dbo.tblwork ON dbo.tblInvoice.workid = dbo.tblwork.workid
WHERE        (dbo.tblwork.Currency = 'IQD')
GROUP BY dbo.tblInvoice.Dateofpayment
GO
/****** Object:  View [dbo].[VWIQD]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE VIEW [dbo].[VWIQD]
AS
SELECT V.Dateofpayment AS Day, V.SumIQD, E.SumExQ, ISNULL(V.SumIQD, 0) + ISNULL(E.SumExQ, 0) AS FinalIQDSum
FROM     dbo.VIQD AS V FULL OUTER JOIN
                  dbo.V_EIQ AS E ON V.Dateofpayment = E.EIDateQ
GO
/****** Object:  View [dbo].[V_MissDays]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE VIEW [dbo].[V_MissDays]
AS
WITH Last_Cte AS (SELECT        PersonID, MAX(AppDate) AS maxdate
                                          FROM            dbo.tblappointments AS ap
                                          GROUP BY PersonID), cte2 AS
    (SELECT        pa.PersonID, pa.PatientName, DATEDIFF(day, LC.maxdate, GETDATE()) AS MissDays
       FROM            dbo.tblpatients AS pa INNER JOIN
                                Last_Cte AS LC ON pa.PersonID = LC.PersonID)
    SELECT        PersonID, PatientName, MissDays
     FROM            cte2 AS cte2_1
     WHERE        (MissDays > 30)
GO
/****** Object:  View [dbo].[V_EI$]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE VIEW [dbo].[V_EI$]
AS
SELECT expenseDate AS EIDate, - SUM(Amount) AS SumEx$
FROM     dbo.tblExpenses
WHERE  (Currency = 'USD')
GROUP BY expenseDate
GO
/****** Object:  View [dbo].[VUSD]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE VIEW [dbo].[VUSD]
AS
SELECT        dbo.tblInvoice.Dateofpayment, SUM(dbo.tblInvoice.Amountpaid) AS SumUSD, MONTH(dbo.tblInvoice.Dateofpayment) AS month, YEAR(dbo.tblInvoice.Dateofpayment) AS Year
FROM            dbo.tblInvoice INNER JOIN
                         dbo.tblwork ON dbo.tblInvoice.workid = dbo.tblwork.workid
WHERE        (dbo.tblwork.Currency = 'USD')
GROUP BY dbo.tblInvoice.Dateofpayment
GO
/****** Object:  View [dbo].[VWUSD]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE VIEW [dbo].[VWUSD]
AS
SELECT V.Dateofpayment AS Day, V.SumUSD, E.SumEx$, ISNULL(V.SumUSD, 0) + ISNULL(E.SumEx$, 0) AS FinalUSDSum
FROM     dbo.VUSD AS V FULL OUTER JOIN
                  dbo.V_EI$ AS E ON V.Dateofpayment = E.EIDate
GO
/****** Object:  Table [dbo].[tblCarriedWires]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblCarriedWires](
	[Id] [int] IDENTITY(1,1) NOT NULL,
	[PersonID] [int] NOT NULL,
	[WireBag] [varchar](50) NOT NULL,
	[WireSlot] [int] NOT NULL,
	[Wire_ID] [int] NOT NULL,
	[UpperLower] [varchar](10) NOT NULL,
	[AdditionDate] [date] NOT NULL,
 CONSTRAINT [PK_tblCarriedWires] PRIMARY KEY CLUSTERED 
(
	[Id] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[tblWires]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblWires](
	[Wire_ID] [int] IDENTITY(1,1) NOT NULL,
	[Wire] [nvarchar](255) NOT NULL,
 CONSTRAINT [tblWires$PrimaryKey] PRIMARY KEY CLUSTERED 
(
	[Wire_ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
/****** Object:  View [dbo].[V_CarriedWires]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE VIEW [dbo].[V_CarriedWires]
AS
SELECT dbo.tblCarriedWires.Id, dbo.tblCarriedWires.PersonID, dbo.tblpatients.PatientName, dbo.tblCarriedWires.WireSlot, dbo.tblCarriedWires.UpperLower, dbo.tblCarriedWires.Wire_ID, dbo.tblWires.Wire, dbo.tblCarriedWires.AdditionDate, 
                  dbo.tblCarriedWires.WireBag
FROM     dbo.tblCarriedWires INNER JOIN
                  dbo.tblpatients ON dbo.tblCarriedWires.PersonID = dbo.tblpatients.PersonID INNER JOIN
                  dbo.tblWires ON dbo.tblCarriedWires.Wire_ID = dbo.tblWires.Wire_ID
GO
/****** Object:  Table [dbo].[tblnumbers]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblnumbers](
	[Mynumber] [int] NOT NULL,
 CONSTRAINT [tblnumbers$PrimaryKey] PRIMARY KEY CLUSTERED 
(
	[Mynumber] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
/****** Object:  View [dbo].[CalStep1]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE VIEW [dbo].[CalStep1]
AS
SELECT        DATEADD(day, Mynumber, CONVERT(date, GETDATE())) AS PreCal
FROM            dbo.tblnumbers
GO
/****** Object:  Table [dbo].[tblholidays]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblholidays](
	[Holidaydate] [date] NOT NULL,
 CONSTRAINT [tblholidays$PrimaryKey] PRIMARY KEY CLUSTERED 
(
	[Holidaydate] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
/****** Object:  View [dbo].[CalStep2]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE VIEW [dbo].[CalStep2]
AS
SELECT        dbo.CalStep1.PreCal
FROM            dbo.CalStep1 LEFT OUTER JOIN
                         dbo.tblholidays ON dbo.CalStep1.PreCal = dbo.tblholidays.Holidaydate
WHERE        (dbo.tblholidays.Holidaydate IS NULL) AND (DATEPART(dw, dbo.CalStep1.PreCal) <> 6)
GO
/****** Object:  Table [dbo].[tbltimes]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tbltimes](
	[TimeID] [int] IDENTITY(1,1) NOT NULL,
	[MyTime] [time](0) NULL,
 CONSTRAINT [tbltimes$PrimaryKey] PRIMARY KEY CLUSTERED 
(
	[TimeID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
/****** Object:  View [dbo].[VFillCal]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE VIEW [dbo].[VFillCal]
AS
SELECT        CAST(CAST(dbo.CalStep2.PreCal AS datetime) + CAST(dbo.tbltimes.MyTime AS datetime) AS datetime2(0)) AS MyDates
FROM            dbo.CalStep2 CROSS JOIN
                         dbo.tbltimes
GO
/****** Object:  View [dbo].[qryVisitSummary]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE VIEW [dbo].[qryVisitSummary]
AS
SELECT        dbo.tblpatients.PatientName, dbo.tblvisits.WorkID, dbo.tblvisits.ID, dbo.tblvisits.VisitDate, dbo.tblvisits.OPG, ISNULL('Upper Wire: ' +
                             (SELECT        Wire
                                FROM            dbo.tblWires
                                WHERE        (Wire_ID = dbo.tblvisits.UpperWireID)) + CHAR(13) + CHAR(10), '') + ISNULL('Lower Wire: ' +
                             (SELECT        Wire
                                FROM            dbo.tblWires AS tblWires_1
                                WHERE        (Wire_ID = dbo.tblvisits.LowerWireID)) + CHAR(13) + CHAR(10), '') + ISNULL('Bracket change for: ' + dbo.tblvisits.BracketChange + CHAR(13) + CHAR(10), '') 
                         + ISNULL('Wire Bending for: ' + dbo.tblvisits.WireBending + CHAR(13) + CHAR(10), '') + ISNULL(dbo.tblvisits.Elastics + CHAR(13) + CHAR(10), '') + ISNULL(dbo.tblvisits.Others + CHAR(13) + CHAR(10), '') 
                         + ISNULL('Next: ' + dbo.tblvisits.NextVisit, '') AS Summary, dbo.tblvisits.PPhoto, dbo.tblvisits.IPhoto, dbo.tblvisits.FPhoto, dbo.tblvisits.ApplianceRemoved
FROM            dbo.tblpatients INNER JOIN
                         dbo.tblwork ON dbo.tblpatients.PersonID = dbo.tblwork.PersonID INNER JOIN
                         dbo.tblvisits ON dbo.tblwork.workid = dbo.tblvisits.WorkID
GO
/****** Object:  View [dbo].[V_Work_Names]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
-- Alter View V_Work_Names
-- Alter View V_Visits
CREATE VIEW [dbo].[V_Work_Names]
AS
SELECT        dbo.tblpatients.PersonID, dbo.tblpatients.PatientName, dbo.tblwork.workid, dbo.tblwork.StartDate, dbo.tblwork.DebondDate, dbo.tblwork.EstimatedDuration, dbo.tblwork.FPhotoDate, dbo.tblwork.IPhotoDate, 
                         dbo.tblwork.Finished
FROM            dbo.tblwork INNER JOIN
                         dbo.tblpatients ON dbo.tblwork.PersonID = dbo.tblpatients.PersonID
WHERE        (dbo.tblwork.Finished = 0)
GO
/****** Object:  Table [dbo].[tblWaiting]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblWaiting](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[PersonID] [int] NOT NULL,
	[Creation_Date] [date] NOT NULL,
	[TypeID] [int] NULL
) ON [PRIMARY]
GO
/****** Object:  View [dbo].[V_Waiting]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
-- Alter View V_Waiting
CREATE VIEW [dbo].[V_Waiting]
AS
SELECT        dbo.tblWaiting.ID, dbo.tblWaiting.PersonID, dbo.tblpatients.PatientName, dbo.tblpatients.Phone, dbo.tblWaiting.Creation_Date, dbo.tblWaiting.TypeID
FROM            dbo.tblWaiting INNER JOIN
                         dbo.tblpatients ON dbo.tblWaiting.PersonID = dbo.tblpatients.PersonID
GO
/****** Object:  View [dbo].[V_Missing_Patients]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE VIEW [dbo].[V_Missing_Patients]
AS
SELECT  p.PersonID, p.PatientName, CAST(a.LatestAppointmentDate AS DATE) AS LatestAppointmentDate, p.PatientTypeID, p.Phone
FROM    dbo.tblpatients AS p INNER JOIN
               (SELECT  PersonID, MAX(AppDate) AS LatestAppointmentDate
              FROM     dbo.tblappointments
              GROUP BY PersonID) AS a ON p.PersonID = a.PersonID
WHERE  (p.PatientTypeID = 1) AND (a.LatestAppointmentDate < DATEADD(MONTH, - 3, GETDATE()))
GO
/****** Object:  View [dbo].[V_Report]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
-- Alter View V_Report
CREATE VIEW [dbo].[V_Report]
AS
SELECT        dbo.tblpatients.PersonID, dbo.tblpatients.PatientName, dbo.tblpatients.Phone, dbo.VTotPaid.TotalPaid, dbo.VLastApp.AppDate, dbo.V_TodayPayment.Dateofpayment, dbo.V_TodayPayment.Amountpaid, dbo.V_ActiveWork.workid, 
                         dbo.V_ActiveWork.TotalRequired, dbo.V_ActiveWork.Currency
FROM            dbo.VLastApp RIGHT OUTER JOIN
                         dbo.V_ActiveWork LEFT OUTER JOIN
                         dbo.V_TodayPayment ON dbo.V_ActiveWork.workid = dbo.V_TodayPayment.workid LEFT OUTER JOIN
                         dbo.VTotPaid ON dbo.V_ActiveWork.workid = dbo.VTotPaid.workid RIGHT OUTER JOIN
                         dbo.tblpatients ON dbo.V_ActiveWork.PersonID = dbo.tblpatients.PersonID ON dbo.VLastApp.PersonID = dbo.tblpatients.PersonID
GO
/****** Object:  View [dbo].[qrylastUwire]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE VIEW [dbo].[qrylastUwire]
AS
SELECT        dbo.tblWires.Wire_ID, dbo.tblWires.Wire, dbo.V_lastvisit.WorkID
FROM            dbo.V_lastvisit INNER JOIN
                         dbo.tblvisits ON dbo.V_lastvisit.LastVisit = dbo.tblvisits.VisitDate AND dbo.V_lastvisit.WorkID = dbo.tblvisits.WorkID LEFT OUTER JOIN
                         dbo.tblWires ON dbo.tblvisits.UpperWireID = dbo.tblWires.Wire_ID
GO
/****** Object:  View [dbo].[qrylastLwire]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE VIEW [dbo].[qrylastLwire]
AS
SELECT        dbo.tblWires.Wire_ID, dbo.tblWires.Wire, dbo.V_lastvisit.WorkID
FROM            dbo.V_lastvisit INNER JOIN
                         dbo.tblvisits ON dbo.V_lastvisit.LastVisit = dbo.tblvisits.VisitDate AND dbo.V_lastvisit.WorkID = dbo.tblvisits.WorkID LEFT OUTER JOIN
                         dbo.tblWires ON dbo.tblvisits.LowerWireID = dbo.tblWires.Wire_ID
GO
/****** Object:  View [dbo].[V_ActualIQD]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE VIEW [dbo].[V_ActualIQD]
AS
SELECT dbo.tblInvoice.Dateofpayment, SUM(dbo.tblInvoice.ActualAmount) AS ActualUSD, SUM(dbo.tblInvoice.Amountpaid) AS SumIQDNotGained, SUM(dbo.tblInvoice.Change) AS SUMChangeIQD, MONTH(dbo.tblInvoice.Dateofpayment) AS month, YEAR(dbo.tblInvoice.Dateofpayment) AS Year
FROM  dbo.tblInvoice INNER JOIN
         dbo.tblwork ON dbo.tblInvoice.workid = dbo.tblwork.workid
WHERE (dbo.tblwork.Currency = 'IQD') AND (dbo.tblInvoice.ActualAmount IS NOT NULL)
GROUP BY dbo.tblInvoice.Dateofpayment
GO
/****** Object:  View [dbo].[V_ActualUSD]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE VIEW [dbo].[V_ActualUSD]
AS
SELECT dbo.tblInvoice.Dateofpayment, SUM(dbo.tblInvoice.ActualAmount) AS ActualIQD, SUM(dbo.tblInvoice.Amountpaid) AS SumUSDNotGained, SUM(dbo.tblInvoice.Change) AS SUMChangeUSD, MONTH(dbo.tblInvoice.Dateofpayment) AS month, YEAR(dbo.tblInvoice.Dateofpayment) AS Year
FROM  dbo.tblInvoice INNER JOIN
         dbo.tblwork ON dbo.tblInvoice.workid = dbo.tblwork.workid
WHERE (dbo.tblwork.Currency = 'USD') AND (dbo.tblInvoice.ActualAmount IS NOT NULL)
GROUP BY dbo.tblInvoice.Dateofpayment
GO
/****** Object:  View [dbo].[V_rptNoWork]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE VIEW [dbo].[V_rptNoWork]
AS
SELECT dbo.tblpatients.PersonID, dbo.tblpatients.PatientName, dbo.tblpatients.Phone, dbo.VLastApp.AppDate
FROM  dbo.tblpatients LEFT OUTER JOIN
         dbo.VLastApp ON dbo.tblpatients.PersonID = dbo.VLastApp.PersonID
GO
/****** Object:  View [dbo].[V_InvoicesCurreny]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE VIEW [dbo].[V_InvoicesCurreny]
AS
SELECT dbo.tblwork.Currency, dbo.tblInvoice.invoiceID, dbo.tblInvoice.Amountpaid, dbo.tblInvoice.Dateofpayment, dbo.tblInvoice.workid, dbo.tblInvoice.ActualAmount, dbo.tblInvoice.ActualCur, dbo.tblInvoice.Change
FROM   dbo.tblInvoice INNER JOIN
             dbo.tblwork ON dbo.tblInvoice.workid = dbo.tblwork.workid
GO
/****** Object:  View [dbo].[VIncome]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE VIEW [dbo].[VIncome]
AS
SELECT        TOP (100) PERCENT DAY(dbo.tblInvoice.Dateofpayment) AS Day, MONTH(dbo.tblInvoice.Dateofpayment) AS Month, YEAR(dbo.tblInvoice.Dateofpayment) AS Year, SUM(dbo.tblInvoice.Amountpaid) AS Sum, 
                         dbo.tblwork.Currency
FROM            dbo.tblInvoice INNER JOIN
                         dbo.tblwork ON dbo.tblInvoice.workid = dbo.tblwork.workid
GROUP BY DAY(dbo.tblInvoice.Dateofpayment), MONTH(dbo.tblInvoice.Dateofpayment), YEAR(dbo.tblInvoice.Dateofpayment), dbo.tblwork.Currency
ORDER BY Year, Month, Day
GO
/****** Object:  Table [dbo].[AlignerDoctors]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[AlignerDoctors](
	[DrID] [int] NOT NULL,
	[DoctorName] [nvarchar](100) NOT NULL,
PRIMARY KEY CLUSTERED 
(
	[DrID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[tbCities]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tbCities](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[City] [nvarchar](255) NULL,
 CONSTRAINT [tbCities$PrimaryKey] PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[tblAddress]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblAddress](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[Zone] [nvarchar](255) NULL,
	[CityID] [int] NULL,
 CONSTRAINT [tblAddress$PrimaryKey] PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[tblAlignerBatches]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblAlignerBatches](
	[AlignerBatchID] [int] IDENTITY(1,1) NOT NULL,
	[AlignerSetID] [int] NOT NULL,
	[UpperAlignerCount] [int] NOT NULL,
	[LowerAlignerCount] [int] NOT NULL,
	[ManufactureDate] [date] NULL,
	[DeliveredToPatientDate] [date] NULL,
	[Notes] [nvarchar](255) NULL,
	[IsActive] [bit] NULL,
	[ValidityPeriod] [int] NULL,
	[NextBatchReadyDate]  AS (dateadd(day,[ValidityPeriod],[DeliveredToPatientDate])) PERSISTED,
	[BatchSequence] [int] NULL,
	[UpperAlignerStartSequence] [int] NULL,
	[LowerAlignerStartSequence] [int] NULL,
	[UpperAlignerEndSequence]  AS (case when [UpperAlignerStartSequence] IS NULL then NULL else ([UpperAlignerStartSequence]+[UpperAlignerCount])-(1) end) PERSISTED,
	[LowerAlignerEndSequence]  AS (case when [LowerAlignerStartSequence] IS NULL then NULL else ([LowerAlignerStartSequence]+[LowerAlignerCount])-(1) end) PERSISTED,
PRIMARY KEY CLUSTERED 
(
	[AlignerBatchID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY],
 CONSTRAINT [UQ_BatchSequence_AlignerSetID] UNIQUE NONCLUSTERED 
(
	[AlignerSetID] ASC,
	[BatchSequence] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[tblAlignerSets]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblAlignerSets](
	[AlignerSetID] [int] IDENTITY(1,1) NOT NULL,
	[WorkID] [int] NOT NULL,
	[UpperAlignersCount] [int] NULL,
	[LowerAlignersCount] [int] NULL,
	[ActiveBatchID] [int] NULL,
	[NextBatchID] [int] NULL,
	[NextBatchDate] [date] NULL,
	[CreationDate] [date] NULL,
	[Notes] [nvarchar](255) NULL,
	[IsActive] [bit] NULL,
	[Days] [int] NULL,
	[FolderPath] [nvarchar](255) NULL,
	[DrID] [int] NULL,
PRIMARY KEY CLUSTERED 
(
	[AlignerSetID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[tblbends]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblbends](
	[Bend_ID] [int] IDENTITY(1,1) NOT NULL,
	[Bend] [nvarchar](255) NOT NULL,
 CONSTRAINT [tblbends$Bends_ID] PRIMARY KEY CLUSTERED 
(
	[Bend_ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[tblCalender]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblCalender](
	[AppDate] [datetime2](0) NOT NULL
) ON [PRIMARY]
GO
/****** Object:  Index [IX_Calender]    Script Date: 15/05/2026 12:26:59 pm ******/
CREATE UNIQUE CLUSTERED INDEX [IX_Calender] ON [dbo].[tblCalender]
(
	[AppDate] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, IGNORE_DUP_KEY = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[tblCharcters]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblCharcters](
	[MyRank] [tinyint] NOT NULL,
	[MyChar] [char](1) NOT NULL,
 CONSTRAINT [PK_tblCharcters] PRIMARY KEY CLUSTERED 
(
	[MyRank] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[tblDentalOffices]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblDentalOffices](
	[id] [int] IDENTITY(1,1) NOT NULL,
	[OfficeName] [nvarchar](255) NOT NULL,
PRIMARY KEY CLUSTERED 
(
	[id] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[tblDetail]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblDetail](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[Detail] [nvarchar](255) NULL,
 CONSTRAINT [tblDetail$PrimaryKey] PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[tblDiagnosis]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblDiagnosis](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[DxDate] [datetime2](0) NULL,
	[WorkID] [int] NOT NULL,
	[Diagnosis] [nvarchar](255) NOT NULL,
	[TreatmentPlan] [nvarchar](255) NOT NULL,
	[ChiefComplain] [nvarchar](255) NULL,
	[fAnteroPosterior] [nvarchar](255) NULL,
	[fVertical] [nvarchar](255) NULL,
	[fTransverse] [nvarchar](255) NULL,
	[fLipCompetence] [nvarchar](255) NULL,
	[fNasoLabialAngle] [nvarchar](255) NULL,
	[fUpperIncisorShowRest] [nvarchar](255) NULL,
	[fUpperIncisorShowSmile] [nvarchar](255) NULL,
	[ITeethPresent] [nvarchar](255) NULL,
	[IDentalHealth] [nvarchar](255) NULL,
	[ILowerCrowding] [nvarchar](255) NULL,
	[ILowerIncisorInclination] [nvarchar](255) NULL,
	[ICurveofSpee] [nvarchar](255) NULL,
	[IUpperCrowding] [nvarchar](255) NULL,
	[IUpperIncisorInclination] [nvarchar](255) NULL,
	[OIncisorRelation] [nvarchar](255) NULL,
	[OOverjet] [nvarchar](255) NULL,
	[OOverbite] [nvarchar](255) NULL,
	[OCenterlines] [nvarchar](255) NULL,
	[OMolarRelation] [nvarchar](255) NULL,
	[OCanineRelation] [nvarchar](255) NULL,
	[OFunctionalOcclusion] [nvarchar](255) NULL,
	[C_SNA] [nvarchar](255) NULL,
	[C_SNB] [nvarchar](255) NULL,
	[C_ANB] [nvarchar](255) NULL,
	[C_SNMx] [nvarchar](255) NULL,
	[C_Wits] [nvarchar](255) NULL,
	[C_FMA] [nvarchar](255) NULL,
	[C_MMA] [nvarchar](255) NULL,
	[C_UIMX] [nvarchar](255) NULL,
	[C_LIMd] [nvarchar](255) NULL,
	[C_UI_LI] [nvarchar](255) NULL,
	[C_LI_APo] [nvarchar](255) NULL,
	[C_Ulip_E] [nvarchar](255) NULL,
	[C_Llip_E] [nvarchar](255) NULL,
	[C_Naso_lip] [nvarchar](255) NULL,
	[C_TAFH] [nvarchar](255) NULL,
	[C_UAFH] [nvarchar](255) NULL,
	[C_LAFH] [nvarchar](255) NULL,
	[C_PercentLAFH] [nvarchar](255) NULL,
	[Appliance] [nvarchar](255) NULL,
 CONSTRAINT [tblDiagnosis$PrimaryKey] PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[tblElastics]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblElastics](
	[Elastic_ID] [int] IDENTITY(1,1) NOT NULL,
	[Elastic] [nvarchar](255) NOT NULL,
 CONSTRAINT [tblElastics$PrimaryKey] PRIMARY KEY CLUSTERED 
(
	[Elastic_ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[tblEmployees]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblEmployees](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[employeeName] [nvarchar](50) NOT NULL,
	[Position] [int] NULL,
	[Email] [nvarchar](50) NULL,
	[Phone] [nvarchar](50) NULL,
	[Percentage] [bit] NOT NULL,
	[receiveEmail] [bit] NOT NULL,
	[getAppointments] [bit] NOT NULL,
 CONSTRAINT [PK__tblEmplo__3214EC2785CA47DB] PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[tblEndo]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblEndo](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[DetailID] [int] NULL,
	[Canal] [nchar](10) NULL,
	[RefrencePoint] [nchar](10) NULL,
	[WorkingLength] [decimal](3, 1) NULL,
	[Curvature] [nvarchar](50) NULL,
	[Note] [nvarchar](max) NULL,
 CONSTRAINT [PK_tblEndo] PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO
/****** Object:  Table [dbo].[tblExpenseCategories]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblExpenseCategories](
	[CategoryID] [int] IDENTITY(1,1) NOT NULL,
	[CategoryName] [nvarchar](50) NOT NULL,
PRIMARY KEY CLUSTERED 
(
	[CategoryID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[tblExpenseSubcategories]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblExpenseSubcategories](
	[SubcategoryID] [int] IDENTITY(1,1) NOT NULL,
	[SubcategoryName] [nvarchar](100) NOT NULL,
	[CategoryID] [int] NOT NULL,
 CONSTRAINT [PK__tblExpen__9C4E707D6C548634] PRIMARY KEY CLUSTERED 
(
	[SubcategoryID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY],
 CONSTRAINT [UQ_Category_Subcategory] UNIQUE NONCLUSTERED 
(
	[SubcategoryID] ASC,
	[CategoryID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[tblGender]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblGender](
	[Gender_ID] [int] NOT NULL,
	[Gender] [nvarchar](255) NOT NULL,
 CONSTRAINT [tblGender$PrimaryKey1] PRIMARY KEY CLUSTERED 
(
	[Gender_ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[tblImplant]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblImplant](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[WorkID] [int] NOT NULL,
	[Tooth] [nchar](10) NULL,
	[ImplantLength] [decimal](3, 1) NULL,
	[ImplantDiameter] [decimal](3, 1) NULL,
	[ImplantCompany] [nvarchar](50) NULL,
	[Note] [nvarchar](100) NULL,
 CONSTRAINT [PK_tblImplant] PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[tblKeyWord]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblKeyWord](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[KeyWord] [nvarchar](255) NULL,
 CONSTRAINT [tblKeyWord$PrimaryKey] PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[tblLabs]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblLabs](
	[id] [int] IDENTITY(1,1) NOT NULL,
	[LabName] [nvarchar](255) NOT NULL,
PRIMARY KEY CLUSTERED 
(
	[id] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[tblOldOPG]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblOldOPG](
	[ID] [int] NOT NULL,
	[last_name] [nvarchar](50) NOT NULL,
	[first_name] [nvarchar](50) NOT NULL,
	[sex] [nvarchar](50) NOT NULL,
	[birth_date] [datetime2](7) NULL,
	[directory] [nvarchar](50) NOT NULL,
 CONSTRAINT [PK_tblFiles] PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[tblPositions]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblPositions](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[PositionName] [varchar](20) NULL,
PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[tblReferrals]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblReferrals](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[Referral] [nvarchar](255) NULL,
 CONSTRAINT [tblReferrals$PrimaryKey] PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[tblscrews]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblscrews](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[WorkID] [int] NULL,
	[PersonID] [int] NOT NULL,
	[PlacementDate] [datetime2](0) NULL,
	[Position] [nvarchar](255) NULL,
	[State] [nvarchar](255) NULL,
 CONSTRAINT [tblscrews$PrimaryKey] PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[tblsms]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblsms](
	[id] [int] IDENTITY(1,1) NOT NULL,
	[date] [date] NOT NULL,
	[smssent] [bit] NOT NULL,
	[SMSID] [nvarchar](255) NULL,
	[emailsent] [bit] NOT NULL,
	[ExchangeRate] [int] NULL,
 CONSTRAINT [tblsms$PrimaryKey] PRIMARY KEY CLUSTERED 
(
	[id] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[tbltime]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tbltime](
	[TimeID] [int] IDENTITY(1,1) NOT NULL,
	[Time] [datetime2](0) NULL,
 CONSTRAINT [tbltime$PrimaryKey] PRIMARY KEY CLUSTERED 
(
	[TimeID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[tblVidCat]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblVidCat](
	[VidCatID] [int] IDENTITY(1,1) NOT NULL,
	[Category] [nvarchar](255) NULL,
 CONSTRAINT [PK_tblVidCat] PRIMARY KEY CLUSTERED 
(
	[VidCatID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[tblWaitReason]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblWaitReason](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[WaitType] [nvarchar](max) NULL
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO
/****** Object:  Table [dbo].[tblWorkDetails]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblWorkDetails](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[WorkID] [int] NOT NULL,
	[Tooth] [nvarchar](50) NULL,
	[FillingType] [nvarchar](50) NULL,
	[FillingDepth] [nvarchar](50) NULL,
	[CanalsNo] [int] NULL,
	[Note] [nvarchar](max) NULL,
 CONSTRAINT [PK_tblWorkDetails] PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO
/****** Object:  Table [dbo].[tblWorkType]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblWorkType](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[WorkType] [varchar](50) NOT NULL,
 CONSTRAINT [PK_tblWorkType] PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
/****** Object:  Index [tblAddress$CityID]    Script Date: 15/05/2026 12:26:59 pm ******/
CREATE NONCLUSTERED INDEX [tblAddress$CityID] ON [dbo].[tblAddress]
(
	[CityID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [tblAddress$ID]    Script Date: 15/05/2026 12:26:59 pm ******/
CREATE NONCLUSTERED INDEX [tblAddress$ID] ON [dbo].[tblAddress]
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [tblAddress$tbCitiestblAddress]    Script Date: 15/05/2026 12:26:59 pm ******/
CREATE NONCLUSTERED INDEX [tblAddress$tbCitiestblAddress] ON [dbo].[tblAddress]
(
	[CityID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [UX_OneActiveAlignerBatchPerSet]    Script Date: 15/05/2026 12:26:59 pm ******/
CREATE UNIQUE NONCLUSTERED INDEX [UX_OneActiveAlignerBatchPerSet] ON [dbo].[tblAlignerBatches]
(
	[AlignerSetID] ASC
)
WHERE ([IsActive]=(1))
WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, IGNORE_DUP_KEY = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [UX_OneActiveAlignerSetPerWork]    Script Date: 15/05/2026 12:26:59 pm ******/
CREATE UNIQUE NONCLUSTERED INDEX [UX_OneActiveAlignerSetPerWork] ON [dbo].[tblAlignerSets]
(
	[WorkID] ASC
)
WHERE ([IsActive]=(1))
WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, IGNORE_DUP_KEY = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [IX_Appdate_PID]    Script Date: 15/05/2026 12:26:59 pm ******/
CREATE NONCLUSTERED INDEX [IX_Appdate_PID] ON [dbo].[tblappointments]
(
	[AppDate] ASC
)
INCLUDE([PersonID],[appointmentID],[AppDetail],[AppCost]) WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
SET ARITHABORT ON
SET CONCAT_NULL_YIELDS_NULL ON
SET QUOTED_IDENTIFIER ON
SET ANSI_NULLS ON
SET ANSI_PADDING ON
SET ANSI_WARNINGS ON
SET NUMERIC_ROUNDABORT OFF
GO
/****** Object:  Index [IX_AppDay]    Script Date: 15/05/2026 12:26:59 pm ******/
CREATE NONCLUSTERED INDEX [IX_AppDay] ON [dbo].[tblappointments]
(
	[AppDay] ASC
)
INCLUDE([appointmentID],[Present],[PersonID],[AppDetail],[Seated],[Dismissed],[AppCost],[AppDate],[SSMA_TimeStamp],[WantNotify],[Notified],[SMSStatus]) WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [IX_PID_All]    Script Date: 15/05/2026 12:26:59 pm ******/
CREATE UNIQUE NONCLUSTERED INDEX [IX_PID_All] ON [dbo].[tblappointments]
(
	[PersonID] ASC,
	[AppDate] ASC
)
INCLUDE([appointmentID],[AppDetail]) WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, IGNORE_DUP_KEY = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
SET ANSI_PADDING ON
GO
/****** Object:  Index [tblbends$PrimaryKey]    Script Date: 15/05/2026 12:26:59 pm ******/
CREATE UNIQUE NONCLUSTERED INDEX [tblbends$PrimaryKey] ON [dbo].[tblbends]
(
	[Bend] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, IGNORE_DUP_KEY = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [tblDiagnosis$CompIndex]    Script Date: 15/05/2026 12:26:59 pm ******/
CREATE UNIQUE NONCLUSTERED INDEX [tblDiagnosis$CompIndex] ON [dbo].[tblDiagnosis]
(
	[ID] ASC,
	[WorkID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, IGNORE_DUP_KEY = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [tblDiagnosis$tblworktblDiagnosis]    Script Date: 15/05/2026 12:26:59 pm ******/
CREATE NONCLUSTERED INDEX [tblDiagnosis$tblworktblDiagnosis] ON [dbo].[tblDiagnosis]
(
	[WorkID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [tblElastics$Elastic_ID]    Script Date: 15/05/2026 12:26:59 pm ******/
CREATE NONCLUSTERED INDEX [tblElastics$Elastic_ID] ON [dbo].[tblElastics]
(
	[Elastic_ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [tblGender$PrimaryKey]    Script Date: 15/05/2026 12:26:59 pm ******/
CREATE UNIQUE NONCLUSTERED INDEX [tblGender$PrimaryKey] ON [dbo].[tblGender]
(
	[Gender_ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, IGNORE_DUP_KEY = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
SET ANSI_PADDING ON
GO
/****** Object:  Index [tblGender$tblGenderGender]    Script Date: 15/05/2026 12:26:59 pm ******/
CREATE NONCLUSTERED INDEX [tblGender$tblGenderGender] ON [dbo].[tblGender]
(
	[Gender] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [Ind_UniqueDate]    Script Date: 15/05/2026 12:26:59 pm ******/
CREATE UNIQUE NONCLUSTERED INDEX [Ind_UniqueDate] ON [dbo].[tblInvoice]
(
	[Dateofpayment] ASC,
	[workid] ASC
)
INCLUDE([Amountpaid]) WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, IGNORE_DUP_KEY = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [IX_Statistics]    Script Date: 15/05/2026 12:26:59 pm ******/
CREATE UNIQUE NONCLUSTERED INDEX [IX_Statistics] ON [dbo].[tblInvoice]
(
	[workid] ASC,
	[Dateofpayment] ASC
)
INCLUDE([Amountpaid]) WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, IGNORE_DUP_KEY = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [IX_WID_Date_Sum]    Script Date: 15/05/2026 12:26:59 pm ******/
CREATE NONCLUSTERED INDEX [IX_WID_Date_Sum] ON [dbo].[tblInvoice]
(
	[workid] ASC
)
INCLUDE([Amountpaid],[Dateofpayment]) WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
SET ANSI_PADDING ON
GO
/****** Object:  Index [tblKeyWord$KeyWord]    Script Date: 15/05/2026 12:26:59 pm ******/
CREATE NONCLUSTERED INDEX [tblKeyWord$KeyWord] ON [dbo].[tblKeyWord]
(
	[KeyWord] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
SET ANSI_PADDING ON
GO
/****** Object:  Index [IX_Name_ID]    Script Date: 15/05/2026 12:26:59 pm ******/
CREATE UNIQUE NONCLUSTERED INDEX [IX_Name_ID] ON [dbo].[tblpatients]
(
	[PatientName] ASC
)
INCLUDE([PersonID]) WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, IGNORE_DUP_KEY = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [IX_Patients_Phone]    Script Date: 15/05/2026 12:26:59 pm ******/
CREATE NONCLUSTERED INDEX [IX_Patients_Phone] ON [dbo].[tblpatients]
(
	[PersonID] ASC
)
INCLUDE([PatientName],[Phone],[patientID],[PatientTypeID],[EstimatedCost],[Currency]) WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [tblpatients$tblAddresstblpatients]    Script Date: 15/05/2026 12:26:59 pm ******/
CREATE NONCLUSTERED INDEX [tblpatients$tblAddresstblpatients] ON [dbo].[tblpatients]
(
	[AddressID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [tblpatients$tblGendertblpatients]    Script Date: 15/05/2026 12:26:59 pm ******/
CREATE NONCLUSTERED INDEX [tblpatients$tblGendertblpatients] ON [dbo].[tblpatients]
(
	[Gender] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [tblscrews$PersonID]    Script Date: 15/05/2026 12:26:59 pm ******/
CREATE NONCLUSTERED INDEX [tblscrews$PersonID] ON [dbo].[tblscrews]
(
	[PersonID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [tblscrews$tblpatientstblscrews]    Script Date: 15/05/2026 12:26:59 pm ******/
CREATE NONCLUSTERED INDEX [tblscrews$tblpatientstblscrews] ON [dbo].[tblscrews]
(
	[PersonID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [tblscrews$tblworktblscrews]    Script Date: 15/05/2026 12:26:59 pm ******/
CREATE NONCLUSTERED INDEX [tblscrews$tblworktblscrews] ON [dbo].[tblscrews]
(
	[WorkID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [tblscrews$WorkID]    Script Date: 15/05/2026 12:26:59 pm ******/
CREATE NONCLUSTERED INDEX [tblscrews$WorkID] ON [dbo].[tblscrews]
(
	[WorkID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
SET ANSI_PADDING ON
GO
/****** Object:  Index [tblsms$SMSID]    Script Date: 15/05/2026 12:26:59 pm ******/
CREATE NONCLUSTERED INDEX [tblsms$SMSID] ON [dbo].[tblsms]
(
	[SMSID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [Photo_index]    Script Date: 15/05/2026 12:26:59 pm ******/
CREATE UNIQUE NONCLUSTERED INDEX [Photo_index] ON [dbo].[tblvisits]
(
	[WorkID] ASC,
	[IPhoto] ASC
)
WHERE ([Iphoto]=(1))
WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, IGNORE_DUP_KEY = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [PhotoF_index]    Script Date: 15/05/2026 12:26:59 pm ******/
CREATE UNIQUE NONCLUSTERED INDEX [PhotoF_index] ON [dbo].[tblvisits]
(
	[WorkID] ASC,
	[FPhoto] ASC
)
WHERE ([Fphoto]=(1))
WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, IGNORE_DUP_KEY = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [tblvisits$LowerWireID]    Script Date: 15/05/2026 12:26:59 pm ******/
CREATE NONCLUSTERED INDEX [tblvisits$LowerWireID] ON [dbo].[tblvisits]
(
	[LowerWireID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [tblvisits$UniqueVisit]    Script Date: 15/05/2026 12:26:59 pm ******/
CREATE UNIQUE NONCLUSTERED INDEX [tblvisits$UniqueVisit] ON [dbo].[tblvisits]
(
	[WorkID] ASC,
	[VisitDate] ASC
)
INCLUDE([ID],[BracketChange],[WireBending],[OPG],[Others],[NextVisit],[Elastics],[UpperWireID],[LowerWireID],[PPhoto],[IPhoto],[FPhoto],[ApplianceRemoved],[OperatorID]) WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, IGNORE_DUP_KEY = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [tblvisits$UpperWireID]    Script Date: 15/05/2026 12:26:59 pm ******/
CREATE NONCLUSTERED INDEX [tblvisits$UpperWireID] ON [dbo].[tblvisits]
(
	[UpperWireID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [tblvisits$WorkID]    Script Date: 15/05/2026 12:26:59 pm ******/
CREATE NONCLUSTERED INDEX [tblvisits$WorkID] ON [dbo].[tblvisits]
(
	[WorkID] ASC
)
INCLUDE([VisitDate]) WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [IX_tblWaiting]    Script Date: 15/05/2026 12:26:59 pm ******/
CREATE UNIQUE NONCLUSTERED INDEX [IX_tblWaiting] ON [dbo].[tblWaiting]
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, IGNORE_DUP_KEY = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [IX_tblWaitReason]    Script Date: 15/05/2026 12:26:59 pm ******/
CREATE UNIQUE NONCLUSTERED INDEX [IX_tblWaitReason] ON [dbo].[tblWaitReason]
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, IGNORE_DUP_KEY = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [tblWires$Wire_ID]    Script Date: 15/05/2026 12:26:59 pm ******/
CREATE NONCLUSTERED INDEX [tblWires$Wire_ID] ON [dbo].[tblWires]
(
	[Wire_ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
SET ANSI_PADDING ON
GO
/****** Object:  Index [IX_Currency]    Script Date: 15/05/2026 12:26:59 pm ******/
CREATE UNIQUE NONCLUSTERED INDEX [IX_Currency] ON [dbo].[tblwork]
(
	[Currency] ASC,
	[workid] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, IGNORE_DUP_KEY = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [IX_Finished]    Script Date: 15/05/2026 12:26:59 pm ******/
CREATE NONCLUSTERED INDEX [IX_Finished] ON [dbo].[tblwork]
(
	[Finished] ASC
)
INCLUDE([PersonID],[TotalRequired],[Currency],[Notes]) WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [tblwork$KeyWordID1]    Script Date: 15/05/2026 12:26:59 pm ******/
CREATE NONCLUSTERED INDEX [tblwork$KeyWordID1] ON [dbo].[tblwork]
(
	[KeyWordID1] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [tblwork$KeyWordID2]    Script Date: 15/05/2026 12:26:59 pm ******/
CREATE NONCLUSTERED INDEX [tblwork$KeyWordID2] ON [dbo].[tblwork]
(
	[KeyWordID2] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [tblwork$KeywordID3]    Script Date: 15/05/2026 12:26:59 pm ******/
CREATE NONCLUSTERED INDEX [tblwork$KeywordID3] ON [dbo].[tblwork]
(
	[KeywordID3] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [tblwork$PersonID]    Script Date: 15/05/2026 12:26:59 pm ******/
CREATE NONCLUSTERED INDEX [tblwork$PersonID] ON [dbo].[tblwork]
(
	[PersonID] ASC
)
INCLUDE([TotalRequired],[Currency],[Notes],[Finished]) WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [UNQ_tblWork_Active]    Script Date: 15/05/2026 12:26:59 pm ******/
CREATE UNIQUE NONCLUSTERED INDEX [UNQ_tblWork_Active] ON [dbo].[tblwork]
(
	[PersonID] ASC
)
WHERE ([Finished]=(0))
WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, IGNORE_DUP_KEY = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
ALTER TABLE [dbo].[tblAlignerBatches] ADD  CONSTRAINT [DF_tblAlignerBatches_IsActive]  DEFAULT ((0)) FOR [IsActive]
GO
ALTER TABLE [dbo].[tblAlignerSets] ADD  CONSTRAINT [DF_tblAlignerSets_IsActive]  DEFAULT ((1)) FOR [IsActive]
GO
ALTER TABLE [dbo].[tblappointments] ADD  CONSTRAINT [DF__tblappoin__WantN__07C12930]  DEFAULT ((1)) FOR [WantNotify]
GO
ALTER TABLE [dbo].[tblappointments] ADD  CONSTRAINT [DF__tblappoin__Notif__08B54D69]  DEFAULT ((0)) FOR [Notified]
GO
ALTER TABLE [dbo].[tblappointments] ADD  CONSTRAINT [DF_tblappointments_WantWa]  DEFAULT ((1)) FOR [WantWa]
GO
ALTER TABLE [dbo].[tblEmployees] ADD  CONSTRAINT [DF_tblEmployees_Percentage]  DEFAULT ((0)) FOR [Percentage]
GO
ALTER TABLE [dbo].[tblEmployees] ADD  CONSTRAINT [DF_tblEmployees_recieveEmail]  DEFAULT ((0)) FOR [receiveEmail]
GO
ALTER TABLE [dbo].[tblEmployees] ADD  CONSTRAINT [DF_tblEmployees_getAppointments]  DEFAULT ((0)) FOR [getAppointments]
GO
ALTER TABLE [dbo].[tblInvoice] ADD  CONSTRAINT [DF_SysStart]  DEFAULT (sysutcdatetime()) FOR [SysStartTime]
GO
ALTER TABLE [dbo].[tblInvoice] ADD  CONSTRAINT [DF_SysEnd]  DEFAULT (CONVERT([datetime2],'9999-12-31 23:59:59.9999999')) FOR [SysEndTime]
GO
ALTER TABLE [dbo].[tblnumbers] ADD  DEFAULT ((0)) FOR [Mynumber]
GO
ALTER TABLE [dbo].[tblpatients] ADD  CONSTRAINT [DF__tblpatien__DateA__0A9D95DB]  DEFAULT (getdate()) FOR [DateAdded]
GO
ALTER TABLE [dbo].[tblpatients] ADD  CONSTRAINT [DF_tblpatients_Language]  DEFAULT ((0)) FOR [Language]
GO
ALTER TABLE [dbo].[tblscrews] ADD  DEFAULT ((0)) FOR [WorkID]
GO
ALTER TABLE [dbo].[tblscrews] ADD  DEFAULT ((0)) FOR [PersonID]
GO
ALTER TABLE [dbo].[tblsms] ADD  CONSTRAINT [DF_tblsms_smssent]  DEFAULT ((0)) FOR [smssent]
GO
ALTER TABLE [dbo].[tblsms] ADD  CONSTRAINT [DF_tblsms_emailsent]  DEFAULT ((0)) FOR [emailsent]
GO
ALTER TABLE [dbo].[tblvisits] ADD  CONSTRAINT [DF__tblvisits__OPG__0D7A0286]  DEFAULT ((0)) FOR [OPG]
GO
ALTER TABLE [dbo].[tblvisits] ADD  CONSTRAINT [DF__tblvisits__Photo__0E6E26BF]  DEFAULT ((0)) FOR [PPhoto]
GO
ALTER TABLE [dbo].[tblvisits] ADD  CONSTRAINT [DF_tblvisits_IPhoto]  DEFAULT ((0)) FOR [IPhoto]
GO
ALTER TABLE [dbo].[tblvisits] ADD  CONSTRAINT [DF_tblvisits_FPhoto]  DEFAULT ((0)) FOR [FPhoto]
GO
ALTER TABLE [dbo].[tblvisits] ADD  CONSTRAINT [DF_tblvisits_ApplianceRemoed]  DEFAULT ((0)) FOR [ApplianceRemoved]
GO
ALTER TABLE [dbo].[tblwork] ADD  CONSTRAINT [DF__tblwork__Finishe__0F624AF8]  DEFAULT ((0)) FOR [Finished]
GO
ALTER TABLE [dbo].[tblwork] ADD  CONSTRAINT [DF__tblwork__Additio__10566F31]  DEFAULT (getdate()) FOR [AdditionDate]
GO
ALTER TABLE [dbo].[tblAddress]  WITH NOCHECK ADD  CONSTRAINT [tblAddress$tbCitiestblAddress] FOREIGN KEY([CityID])
REFERENCES [dbo].[tbCities] ([ID])
ON UPDATE CASCADE
GO
ALTER TABLE [dbo].[tblAddress] CHECK CONSTRAINT [tblAddress$tbCitiestblAddress]
GO
ALTER TABLE [dbo].[tblAlignerBatches]  WITH CHECK ADD  CONSTRAINT [FK_tblAlignerBatches_AlignerSet] FOREIGN KEY([AlignerSetID])
REFERENCES [dbo].[tblAlignerSets] ([AlignerSetID])
GO
ALTER TABLE [dbo].[tblAlignerBatches] CHECK CONSTRAINT [FK_tblAlignerBatches_AlignerSet]
GO
ALTER TABLE [dbo].[tblAlignerSets]  WITH CHECK ADD  CONSTRAINT [FK_tblAlignerSets_ActiveBatch] FOREIGN KEY([ActiveBatchID])
REFERENCES [dbo].[tblAlignerBatches] ([AlignerBatchID])
GO
ALTER TABLE [dbo].[tblAlignerSets] CHECK CONSTRAINT [FK_tblAlignerSets_ActiveBatch]
GO
ALTER TABLE [dbo].[tblAlignerSets]  WITH CHECK ADD  CONSTRAINT [FK_tblAlignerSets_AlignerDoctors] FOREIGN KEY([DrID])
REFERENCES [dbo].[AlignerDoctors] ([DrID])
GO
ALTER TABLE [dbo].[tblAlignerSets] CHECK CONSTRAINT [FK_tblAlignerSets_AlignerDoctors]
GO
ALTER TABLE [dbo].[tblAlignerSets]  WITH CHECK ADD  CONSTRAINT [FK_tblAlignerSets_NextBatch] FOREIGN KEY([NextBatchID])
REFERENCES [dbo].[tblAlignerBatches] ([AlignerBatchID])
GO
ALTER TABLE [dbo].[tblAlignerSets] CHECK CONSTRAINT [FK_tblAlignerSets_NextBatch]
GO
ALTER TABLE [dbo].[tblAlignerSets]  WITH CHECK ADD  CONSTRAINT [FK_tblAlignerSets_Work] FOREIGN KEY([WorkID])
REFERENCES [dbo].[tblwork] ([workid])
GO
ALTER TABLE [dbo].[tblAlignerSets] CHECK CONSTRAINT [FK_tblAlignerSets_Work]
GO
ALTER TABLE [dbo].[tblappointments]  WITH CHECK ADD  CONSTRAINT [FK_tblappointments_tblDoctors] FOREIGN KEY([DrID])
REFERENCES [dbo].[tblEmployees] ([ID])
GO
ALTER TABLE [dbo].[tblappointments] CHECK CONSTRAINT [FK_tblappointments_tblDoctors]
GO
ALTER TABLE [dbo].[tblappointments]  WITH NOCHECK ADD  CONSTRAINT [tblappointments$tblpatientstblappointments] FOREIGN KEY([PersonID])
REFERENCES [dbo].[tblpatients] ([PersonID])
ON UPDATE CASCADE
ON DELETE CASCADE
GO
ALTER TABLE [dbo].[tblappointments] CHECK CONSTRAINT [tblappointments$tblpatientstblappointments]
GO
ALTER TABLE [dbo].[tblCarriedWires]  WITH CHECK ADD  CONSTRAINT [FK_tblCarriedWires_tblpatients] FOREIGN KEY([PersonID])
REFERENCES [dbo].[tblpatients] ([PersonID])
GO
ALTER TABLE [dbo].[tblCarriedWires] CHECK CONSTRAINT [FK_tblCarriedWires_tblpatients]
GO
ALTER TABLE [dbo].[tblCarriedWires]  WITH CHECK ADD  CONSTRAINT [FK_tblCarriedWires_tblWires] FOREIGN KEY([Wire_ID])
REFERENCES [dbo].[tblWires] ([Wire_ID])
GO
ALTER TABLE [dbo].[tblCarriedWires] CHECK CONSTRAINT [FK_tblCarriedWires_tblWires]
GO
ALTER TABLE [dbo].[tblDiagnosis]  WITH NOCHECK ADD  CONSTRAINT [tblDiagnosis$tblworktblDiagnosis] FOREIGN KEY([WorkID])
REFERENCES [dbo].[tblwork] ([workid])
ON UPDATE CASCADE
ON DELETE CASCADE
GO
ALTER TABLE [dbo].[tblDiagnosis] CHECK CONSTRAINT [tblDiagnosis$tblworktblDiagnosis]
GO
ALTER TABLE [dbo].[tblEmployees]  WITH CHECK ADD  CONSTRAINT [FK__tblEmploy__Posit__5B196B42] FOREIGN KEY([Position])
REFERENCES [dbo].[tblPositions] ([ID])
GO
ALTER TABLE [dbo].[tblEmployees] CHECK CONSTRAINT [FK__tblEmploy__Posit__5B196B42]
GO
ALTER TABLE [dbo].[tblEndo]  WITH CHECK ADD  CONSTRAINT [FK_tblEndo_tblWorkDetails] FOREIGN KEY([DetailID])
REFERENCES [dbo].[tblWorkDetails] ([ID])
ON UPDATE CASCADE
ON DELETE CASCADE
GO
ALTER TABLE [dbo].[tblEndo] CHECK CONSTRAINT [FK_tblEndo_tblWorkDetails]
GO
ALTER TABLE [dbo].[tblExpenseSubcategories]  WITH CHECK ADD  CONSTRAINT [FK__tblExpens__Categ__379B24DB] FOREIGN KEY([CategoryID])
REFERENCES [dbo].[tblExpenseCategories] ([CategoryID])
GO
ALTER TABLE [dbo].[tblExpenseSubcategories] CHECK CONSTRAINT [FK__tblExpens__Categ__379B24DB]
GO
ALTER TABLE [dbo].[tblImplant]  WITH CHECK ADD  CONSTRAINT [FK_tblImplant_tblwork] FOREIGN KEY([WorkID])
REFERENCES [dbo].[tblwork] ([workid])
ON UPDATE CASCADE
ON DELETE CASCADE
GO
ALTER TABLE [dbo].[tblImplant] CHECK CONSTRAINT [FK_tblImplant_tblwork]
GO
ALTER TABLE [dbo].[tblInvoice]  WITH NOCHECK ADD  CONSTRAINT [tblInvoice$tblworktblInvoice] FOREIGN KEY([workid])
REFERENCES [dbo].[tblwork] ([workid])
ON UPDATE CASCADE
ON DELETE CASCADE
GO
ALTER TABLE [dbo].[tblInvoice] CHECK CONSTRAINT [tblInvoice$tblworktblInvoice]
GO
ALTER TABLE [dbo].[tblpatients]  WITH CHECK ADD  CONSTRAINT [FK_tblpatients_tblpatienttype] FOREIGN KEY([PatientTypeID])
REFERENCES [dbo].[tblPatientType] ([ID])
GO
ALTER TABLE [dbo].[tblpatients] CHECK CONSTRAINT [FK_tblpatients_tblpatienttype]
GO
ALTER TABLE [dbo].[tblpatients]  WITH CHECK ADD  CONSTRAINT [FK_tblpatients_tblReferrals] FOREIGN KEY([ReferralSourceID])
REFERENCES [dbo].[tblReferrals] ([ID])
GO
ALTER TABLE [dbo].[tblpatients] CHECK CONSTRAINT [FK_tblpatients_tblReferrals]
GO
ALTER TABLE [dbo].[tblpatients]  WITH NOCHECK ADD  CONSTRAINT [tblpatients$tblAddresstblpatients] FOREIGN KEY([AddressID])
REFERENCES [dbo].[tblAddress] ([ID])
ON UPDATE CASCADE
GO
ALTER TABLE [dbo].[tblpatients] CHECK CONSTRAINT [tblpatients$tblAddresstblpatients]
GO
ALTER TABLE [dbo].[tblpatients]  WITH NOCHECK ADD  CONSTRAINT [tblpatients$tblGendertblpatients] FOREIGN KEY([Gender])
REFERENCES [dbo].[tblGender] ([Gender_ID])
GO
ALTER TABLE [dbo].[tblpatients] CHECK CONSTRAINT [tblpatients$tblGendertblpatients]
GO
ALTER TABLE [dbo].[tblscrews]  WITH NOCHECK ADD  CONSTRAINT [tblscrews$tblpatientstblscrews] FOREIGN KEY([PersonID])
REFERENCES [dbo].[tblpatients] ([PersonID])
ON UPDATE CASCADE
ON DELETE CASCADE
GO
ALTER TABLE [dbo].[tblscrews] CHECK CONSTRAINT [tblscrews$tblpatientstblscrews]
GO
ALTER TABLE [dbo].[tblscrews]  WITH NOCHECK ADD  CONSTRAINT [tblscrews$tblworktblscrews] FOREIGN KEY([WorkID])
REFERENCES [dbo].[tblwork] ([workid])
GO
ALTER TABLE [dbo].[tblscrews] CHECK CONSTRAINT [tblscrews$tblworktblscrews]
GO
ALTER TABLE [dbo].[tblvideos]  WITH CHECK ADD  CONSTRAINT [FK_tblvideos_tblVidCat] FOREIGN KEY([Category])
REFERENCES [dbo].[tblVidCat] ([VidCatID])
GO
ALTER TABLE [dbo].[tblvideos] CHECK CONSTRAINT [FK_tblvideos_tblVidCat]
GO
ALTER TABLE [dbo].[tblvisits]  WITH CHECK ADD  CONSTRAINT [FK_tblvisits_BatchDelivered] FOREIGN KEY([BatchDeliveredID])
REFERENCES [dbo].[tblAlignerBatches] ([AlignerBatchID])
GO
ALTER TABLE [dbo].[tblvisits] CHECK CONSTRAINT [FK_tblvisits_BatchDelivered]
GO
ALTER TABLE [dbo].[tblvisits]  WITH CHECK ADD  CONSTRAINT [FK_tblvisits_tblWires] FOREIGN KEY([LowerWireID])
REFERENCES [dbo].[tblWires] ([Wire_ID])
GO
ALTER TABLE [dbo].[tblvisits] CHECK CONSTRAINT [FK_tblvisits_tblWires]
GO
ALTER TABLE [dbo].[tblvisits]  WITH NOCHECK ADD  CONSTRAINT [tblvisits$tblWirestblvisits] FOREIGN KEY([UpperWireID])
REFERENCES [dbo].[tblWires] ([Wire_ID])
GO
ALTER TABLE [dbo].[tblvisits] CHECK CONSTRAINT [tblvisits$tblWirestblvisits]
GO
ALTER TABLE [dbo].[tblvisits]  WITH NOCHECK ADD  CONSTRAINT [tblvisits$tblworktblvisits] FOREIGN KEY([WorkID])
REFERENCES [dbo].[tblwork] ([workid])
ON UPDATE CASCADE
ON DELETE CASCADE
GO
ALTER TABLE [dbo].[tblvisits] CHECK CONSTRAINT [tblvisits$tblworktblvisits]
GO
ALTER TABLE [dbo].[tblWaiting]  WITH CHECK ADD  CONSTRAINT [FK_tblWaiting_tblpatients] FOREIGN KEY([PersonID])
REFERENCES [dbo].[tblpatients] ([PersonID])
GO
ALTER TABLE [dbo].[tblWaiting] CHECK CONSTRAINT [FK_tblWaiting_tblpatients]
GO
ALTER TABLE [dbo].[tblWaiting]  WITH CHECK ADD  CONSTRAINT [FK_tblWaiting_tblWaitReason] FOREIGN KEY([TypeID])
REFERENCES [dbo].[tblWaitReason] ([ID])
GO
ALTER TABLE [dbo].[tblWaiting] CHECK CONSTRAINT [FK_tblWaiting_tblWaitReason]
GO
ALTER TABLE [dbo].[tblwork]  WITH CHECK ADD  CONSTRAINT [FK_tblwork_tblAlignerSets] FOREIGN KEY([ActiveAlignerSetID])
REFERENCES [dbo].[tblAlignerSets] ([AlignerSetID])
GO
ALTER TABLE [dbo].[tblwork] CHECK CONSTRAINT [FK_tblwork_tblAlignerSets]
GO
ALTER TABLE [dbo].[tblwork]  WITH CHECK ADD  CONSTRAINT [FK_tblwork_tblEmployees] FOREIGN KEY([DrID])
REFERENCES [dbo].[tblEmployees] ([ID])
GO
ALTER TABLE [dbo].[tblwork] CHECK CONSTRAINT [FK_tblwork_tblEmployees]
GO
ALTER TABLE [dbo].[tblwork]  WITH CHECK ADD  CONSTRAINT [FK_tblwork_tblKeyWord] FOREIGN KEY([KeyWordID1])
REFERENCES [dbo].[tblKeyWord] ([ID])
GO
ALTER TABLE [dbo].[tblwork] CHECK CONSTRAINT [FK_tblwork_tblKeyWord]
GO
ALTER TABLE [dbo].[tblwork]  WITH CHECK ADD  CONSTRAINT [FK_tblwork_tblKeyWord2] FOREIGN KEY([KeyWordID2])
REFERENCES [dbo].[tblKeyWord] ([ID])
GO
ALTER TABLE [dbo].[tblwork] CHECK CONSTRAINT [FK_tblwork_tblKeyWord2]
GO
ALTER TABLE [dbo].[tblwork]  WITH CHECK ADD  CONSTRAINT [FK_tblwork_tblKeyWord3] FOREIGN KEY([KeywordID3])
REFERENCES [dbo].[tblKeyWord] ([ID])
GO
ALTER TABLE [dbo].[tblwork] CHECK CONSTRAINT [FK_tblwork_tblKeyWord3]
GO
ALTER TABLE [dbo].[tblwork]  WITH CHECK ADD  CONSTRAINT [FK_tblwork_tblKeyWord4] FOREIGN KEY([KeywordID4])
REFERENCES [dbo].[tblKeyWord] ([ID])
GO
ALTER TABLE [dbo].[tblwork] CHECK CONSTRAINT [FK_tblwork_tblKeyWord4]
GO
ALTER TABLE [dbo].[tblwork]  WITH CHECK ADD  CONSTRAINT [FK_tblwork_tblKeyWord5] FOREIGN KEY([KeywordID5])
REFERENCES [dbo].[tblKeyWord] ([ID])
GO
ALTER TABLE [dbo].[tblwork] CHECK CONSTRAINT [FK_tblwork_tblKeyWord5]
GO
ALTER TABLE [dbo].[tblwork]  WITH CHECK ADD  CONSTRAINT [FK_tblwork_tblpatients] FOREIGN KEY([PersonID])
REFERENCES [dbo].[tblpatients] ([PersonID])
GO
ALTER TABLE [dbo].[tblwork] CHECK CONSTRAINT [FK_tblwork_tblpatients]
GO
ALTER TABLE [dbo].[tblWorkDetails]  WITH CHECK ADD  CONSTRAINT [FK_tblWorkDetails_tblwork] FOREIGN KEY([WorkID])
REFERENCES [dbo].[tblwork] ([workid])
ON UPDATE CASCADE
ON DELETE CASCADE
GO
ALTER TABLE [dbo].[tblWorkDetails] CHECK CONSTRAINT [FK_tblWorkDetails_tblwork]
GO
ALTER TABLE [dbo].[tblInvoice]  WITH CHECK ADD  CONSTRAINT [CK_MoreThanTotal] CHECK  (([dbo].[functotalpaid]([workid])=(1)))
GO
ALTER TABLE [dbo].[tblInvoice] CHECK CONSTRAINT [CK_MoreThanTotal]
GO
ALTER TABLE [dbo].[tblpatients]  WITH NOCHECK ADD  CONSTRAINT [SSMA_CC$tblpatients$DateofBirth$validation_rule] CHECK  (([DateofBirth]<CONVERT([datetime],CONVERT([varchar],getdate(),(1)),(1))))
GO
ALTER TABLE [dbo].[tblpatients] CHECK CONSTRAINT [SSMA_CC$tblpatients$DateofBirth$validation_rule]
GO
ALTER TABLE [dbo].[tblpatients]  WITH NOCHECK ADD  CONSTRAINT [SSMA_CC$tblpatients$Gender$validation_rule] CHECK  (([Gender] IS NULL OR [Gender]=(0) OR [Gender]=(1)))
GO
ALTER TABLE [dbo].[tblpatients] CHECK CONSTRAINT [SSMA_CC$tblpatients$Gender$validation_rule]
GO
ALTER TABLE [dbo].[tblpatients]  WITH NOCHECK ADD  CONSTRAINT [SSMA_CC$tblpatients$patientID$disallow_zero_length] CHECK  ((len([patientID])>(0)))
GO
ALTER TABLE [dbo].[tblpatients] CHECK CONSTRAINT [SSMA_CC$tblpatients$patientID$disallow_zero_length]
GO
ALTER TABLE [dbo].[tblpatients]  WITH NOCHECK ADD  CONSTRAINT [SSMA_CC$tblpatients$PatientName$disallow_zero_length] CHECK  ((len([PatientName])>(0)))
GO
ALTER TABLE [dbo].[tblpatients] CHECK CONSTRAINT [SSMA_CC$tblpatients$PatientName$disallow_zero_length]
GO
ALTER TABLE [dbo].[tblPositions]  WITH CHECK ADD CHECK  (([PositionName]='Worker' OR [PositionName]='Receptionist' OR [PositionName]='Assistant' OR [PositionName]='Doctor'))
GO
ALTER TABLE [dbo].[tblwork]  WITH CHECK ADD  CONSTRAINT [CK_MoreThanTotalW] CHECK  (([dbo].[functotalpaidW]([workid],[TotalRequired])=(1)))
GO
ALTER TABLE [dbo].[tblwork] CHECK CONSTRAINT [CK_MoreThanTotalW]
GO
ALTER TABLE [dbo].[tblwork]  WITH CHECK ADD  CONSTRAINT [CK_tblwork] CHECK  (([Fphotodate]>[Iphotodate]))
GO
ALTER TABLE [dbo].[tblwork] CHECK CONSTRAINT [CK_tblwork]
GO
ALTER TABLE [dbo].[tblwork]  WITH CHECK ADD  CONSTRAINT [CK_tblwork_Cur] CHECK  (([Currency] IS NOT NULL OR [TotalRequired] IS NULL))
GO
ALTER TABLE [dbo].[tblwork] CHECK CONSTRAINT [CK_tblwork_Cur]
GO
ALTER TABLE [dbo].[tblwork]  WITH CHECK ADD  CONSTRAINT [CK_tblwork_Deb] CHECK  (([Fphotodate]>=[Debonddate]))
GO
ALTER TABLE [dbo].[tblwork] CHECK CONSTRAINT [CK_tblwork_Deb]
GO
ALTER TABLE [dbo].[tblwork]  WITH CHECK ADD  CONSTRAINT [CK_tblwork_DebIPh] CHECK  (([Debonddate]>[Iphotodate]))
GO
ALTER TABLE [dbo].[tblwork] CHECK CONSTRAINT [CK_tblwork_DebIPh]
GO
/****** Object:  StoredProcedure [dbo].[AddDolph]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[AddTimePoint]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[AllTodayApps]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[ApposforOne]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[CheckDate]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[CheckDolphin]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[ChkTimePoint]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[Daily]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[DailyUSD]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[DelDolph]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[FillCalender]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[FindName]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[GetLast]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[IncomeDrDetails]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[ListDolphTimePoints]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[ListTimePointImgs]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[NulPresent]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[PresentTodayApps]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[proAddVisit]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[ProAppsPhones]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[ProcAddHoliday]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[ProcAddSpecificTime]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[ProcCarriedWires]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[ProcCheck_Wires]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[ProcCheckHoliday]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[ProcDay]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[ProcDeleteSpecificTime]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[ProcDelHoliday]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[ProcDeliveredWa]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[ProcEditedInvoices]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[ProcExpenses]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[ProcFetch]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[Procgetsids]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[ProcGrandTotal]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[ProcGrandTotal_original]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[ProcIncomeByDr]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[ProcIncomeDr]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[ProcListWorks]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[ProcOPGWork]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[ProcSMS]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[ProcUpdatesms1]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[ProcUpdatesms2]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[ProcWAResult]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[ProcWhatsApp]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[ProcWhatsApp2]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO


-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE PROCEDURE [dbo].[ProcWhatsApp2]
	-- Add the parameters for the stored procedure here
	@ADate as date
AS
BEGIN
	-- SET NOCOUNT ON added to prevent extra result sets from
	-- interfering with SELECT statements.
	SET NOCOUNT ON;

   
 SELECT dbo.tblappointments.appointmentID, '964' + dbo.tblpatients.Phone AS Phone,  dbo.tblpatients.PatientName,
        'السلام عليك' + ' ' + dbo.tblpatients.PatientName + ' ' + 'بعد غد "السبت" موعدك مع عيادة د.شوان لتقويم الاسنان الساعة' + ' ' + format(dbo.tblappointments.AppDate, 'h:mm ') AS message
FROM  dbo.tblpatients INNER JOIN
         dbo.tblappointments ON dbo.tblpatients.PersonID = dbo.tblappointments.PersonID
		 Where  (dbo.tblappointments.AppDay = @ADate) and (dbo.tblappointments.WantWa = 1) and (dbo.tblappointments.SentWa = 0 or dbo.tblappointments.SentWa is null)
END
GO
/****** Object:  StoredProcedure [dbo].[ProDailyInvoices]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[ProDelete]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[ProDeletedInvoices]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[ProFindDupPhone]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[ProFindDupPhone2]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[ProFlip]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
create procedure [dbo].[ProFlip] @AID int as
update dbo.tblappointments 
set dbo.tblappointments.WantNotify = ~dbo.tblappointments.WantNotify
where appointmentID = @AID
GO
/****** Object:  StoredProcedure [dbo].[ProFlipAllSMS]    Script Date: 15/05/2026 12:26:59 pm ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE procedure [dbo].[ProFlipAllSMS] @ADate date as
update dbo.tblappointments 
set dbo.tblappointments.WantNotify = ~dbo.tblappointments.WantNotify
where (AppDay = @ADate);

GO
/****** Object:  StoredProcedure [dbo].[ProFlipSMS]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[proGetLatestWire]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[proGetVisitSum]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[ProKeyWord]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[ProlatestVisitSum]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[ProSMS]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[ProSMSS]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[ProTblPatients]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[ProVisitSum]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[ProVisitSumSearched]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[PTodayAppsWeb]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[TodaysApps]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[UpdateDolph]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[UpdatePresent]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[VisitsPhotoforOne]    Script Date: 15/05/2026 12:26:59 pm ******/
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
/****** Object:  StoredProcedure [dbo].[WorkPhotoDates]    Script Date: 15/05/2026 12:26:59 pm ******/
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
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tbCities].[ID]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tbCities', @level2type=N'COLUMN',@level2name=N'ID'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tbCities].[City]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tbCities', @level2type=N'COLUMN',@level2name=N'City'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tbCities].[PrimaryKey]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tbCities', @level2type=N'CONSTRAINT',@level2name=N'tbCities$PrimaryKey'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tbCities]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tbCities'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblAddress].[ID]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblAddress', @level2type=N'COLUMN',@level2name=N'ID'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblAddress].[Zone]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblAddress', @level2type=N'COLUMN',@level2name=N'Zone'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblAddress].[CityID]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblAddress', @level2type=N'COLUMN',@level2name=N'CityID'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblAddress].[PrimaryKey]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblAddress', @level2type=N'CONSTRAINT',@level2name=N'tblAddress$PrimaryKey'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblAddress].[CityID]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblAddress', @level2type=N'INDEX',@level2name=N'tblAddress$CityID'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblAddress].[ID]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblAddress', @level2type=N'INDEX',@level2name=N'tblAddress$ID'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblAddress].[tbCitiestblAddress]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblAddress', @level2type=N'INDEX',@level2name=N'tblAddress$tbCitiestblAddress'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblAddress]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblAddress'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblAddress].[tbCitiestblAddress]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblAddress', @level2type=N'CONSTRAINT',@level2name=N'tblAddress$tbCitiestblAddress'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblappointments].[appointmentID]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblappointments', @level2type=N'COLUMN',@level2name=N'appointmentID'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblappointments].[PersonID]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblappointments', @level2type=N'COLUMN',@level2name=N'PersonID'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblappointments].[AppDetail]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblappointments', @level2type=N'COLUMN',@level2name=N'AppDetail'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblappointments].[WantNotify]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblappointments', @level2type=N'COLUMN',@level2name=N'WantNotify'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblappointments].[Notified]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblappointments', @level2type=N'COLUMN',@level2name=N'Notified'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblappointments].[SMSStatus]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblappointments', @level2type=N'COLUMN',@level2name=N'SMSStatus'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblappointments].[Present]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblappointments', @level2type=N'COLUMN',@level2name=N'Present'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblappointments].[Seated]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblappointments', @level2type=N'COLUMN',@level2name=N'Seated'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblappointments].[Dismissed]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblappointments', @level2type=N'COLUMN',@level2name=N'Dismissed'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblappointments]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblappointments'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblappointments].[tblpatientstblappointments]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblappointments', @level2type=N'CONSTRAINT',@level2name=N'tblappointments$tblpatientstblappointments'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblbends].[Bend_ID]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblbends', @level2type=N'COLUMN',@level2name=N'Bend_ID'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblbends].[Bend]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblbends', @level2type=N'COLUMN',@level2name=N'Bend'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblbends].[Bends_ID]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblbends', @level2type=N'CONSTRAINT',@level2name=N'tblbends$Bends_ID'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblbends].[PrimaryKey]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblbends', @level2type=N'INDEX',@level2name=N'tblbends$PrimaryKey'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblbends]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblbends'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables_20181101223058.[tblCalender]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblCalender'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDetail].[ID]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDetail', @level2type=N'COLUMN',@level2name=N'ID'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDetail].[Detail]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDetail', @level2type=N'COLUMN',@level2name=N'Detail'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDetail].[PrimaryKey]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDetail', @level2type=N'CONSTRAINT',@level2name=N'tblDetail$PrimaryKey'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDetail]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDetail'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[ID]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'COLUMN',@level2name=N'ID'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[DxDate]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'COLUMN',@level2name=N'DxDate'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[WorkID]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'COLUMN',@level2name=N'WorkID'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[Diagnosis]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'COLUMN',@level2name=N'Diagnosis'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[TreatmentPlan]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'COLUMN',@level2name=N'TreatmentPlan'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[ChiefComplain]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'COLUMN',@level2name=N'ChiefComplain'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[fAnteroPosterior]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'COLUMN',@level2name=N'fAnteroPosterior'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[fVertical]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'COLUMN',@level2name=N'fVertical'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[fTransverse]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'COLUMN',@level2name=N'fTransverse'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[fLipCompetence]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'COLUMN',@level2name=N'fLipCompetence'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[fNasoLabialAngle]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'COLUMN',@level2name=N'fNasoLabialAngle'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[fUpperIncisorShowRest]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'COLUMN',@level2name=N'fUpperIncisorShowRest'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[fUpperIncisorShowSmile]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'COLUMN',@level2name=N'fUpperIncisorShowSmile'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[ITeethPresent]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'COLUMN',@level2name=N'ITeethPresent'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[IDentalHealth]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'COLUMN',@level2name=N'IDentalHealth'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[ILowerCrowding]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'COLUMN',@level2name=N'ILowerCrowding'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[ILowerIncisorInclination]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'COLUMN',@level2name=N'ILowerIncisorInclination'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[ICurveofSpee]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'COLUMN',@level2name=N'ICurveofSpee'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[IUpperCrowding]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'COLUMN',@level2name=N'IUpperCrowding'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[IUpperIncisorInclination]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'COLUMN',@level2name=N'IUpperIncisorInclination'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[OIncisorRelation]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'COLUMN',@level2name=N'OIncisorRelation'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[OOverjet]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'COLUMN',@level2name=N'OOverjet'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[OOverbite]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'COLUMN',@level2name=N'OOverbite'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[OCenterlines]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'COLUMN',@level2name=N'OCenterlines'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[OMolarRelation]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'COLUMN',@level2name=N'OMolarRelation'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[OCanineRelation]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'COLUMN',@level2name=N'OCanineRelation'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[OFunctionalOcclusion]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'COLUMN',@level2name=N'OFunctionalOcclusion'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[C_SNA]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'COLUMN',@level2name=N'C_SNA'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[C_SNB]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'COLUMN',@level2name=N'C_SNB'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[C_ANB]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'COLUMN',@level2name=N'C_ANB'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[C_SNMx]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'COLUMN',@level2name=N'C_SNMx'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[C_Wits]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'COLUMN',@level2name=N'C_Wits'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[C_FMA]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'COLUMN',@level2name=N'C_FMA'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[C_MMA]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'COLUMN',@level2name=N'C_MMA'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[C_UIMX]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'COLUMN',@level2name=N'C_UIMX'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[C_LIMd]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'COLUMN',@level2name=N'C_LIMd'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[C_UI_LI]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'COLUMN',@level2name=N'C_UI_LI'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[C_LI_APo]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'COLUMN',@level2name=N'C_LI_APo'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[C_Ulip_E]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'COLUMN',@level2name=N'C_Ulip_E'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[C_Llip_E]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'COLUMN',@level2name=N'C_Llip_E'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[C_Naso_lip]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'COLUMN',@level2name=N'C_Naso_lip'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[C_TAFH]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'COLUMN',@level2name=N'C_TAFH'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[C_UAFH]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'COLUMN',@level2name=N'C_UAFH'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[C_LAFH]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'COLUMN',@level2name=N'C_LAFH'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[C_PercentLAFH]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'COLUMN',@level2name=N'C_PercentLAFH'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[Appliance]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'COLUMN',@level2name=N'Appliance'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[PrimaryKey]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'CONSTRAINT',@level2name=N'tblDiagnosis$PrimaryKey'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[CompIndex]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'INDEX',@level2name=N'tblDiagnosis$CompIndex'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[tblworktblDiagnosis]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'INDEX',@level2name=N'tblDiagnosis$tblworktblDiagnosis'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblDiagnosis].[tblworktblDiagnosis]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblDiagnosis', @level2type=N'CONSTRAINT',@level2name=N'tblDiagnosis$tblworktblDiagnosis'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblElastics].[Elastic_ID]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblElastics', @level2type=N'COLUMN',@level2name=N'Elastic_ID'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblElastics].[Elastic]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblElastics', @level2type=N'COLUMN',@level2name=N'Elastic'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblElastics].[PrimaryKey]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblElastics', @level2type=N'CONSTRAINT',@level2name=N'tblElastics$PrimaryKey'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblElastics].[Elastic_ID]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblElastics', @level2type=N'INDEX',@level2name=N'tblElastics$Elastic_ID'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblElastics]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblElastics'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblGender].[Gender_ID]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblGender', @level2type=N'COLUMN',@level2name=N'Gender_ID'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblGender].[Gender]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblGender', @level2type=N'COLUMN',@level2name=N'Gender'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblGender].[PrimaryKey1]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblGender', @level2type=N'CONSTRAINT',@level2name=N'tblGender$PrimaryKey1'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblGender].[PrimaryKey]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblGender', @level2type=N'INDEX',@level2name=N'tblGender$PrimaryKey'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblGender].[tblGenderGender]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblGender', @level2type=N'INDEX',@level2name=N'tblGender$tblGenderGender'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblGender]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblGender'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblholidays].[Holidaydate]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblholidays', @level2type=N'COLUMN',@level2name=N'Holidaydate'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblholidays].[PrimaryKey]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblholidays', @level2type=N'CONSTRAINT',@level2name=N'tblholidays$PrimaryKey'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblholidays]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblholidays'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblInvoice].[invoiceID]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblInvoice', @level2type=N'COLUMN',@level2name=N'invoiceID'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblInvoice].[Amountpaid]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblInvoice', @level2type=N'COLUMN',@level2name=N'Amountpaid'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblInvoice].[Dateofpayment]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblInvoice', @level2type=N'COLUMN',@level2name=N'Dateofpayment'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblInvoice].[workid]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblInvoice', @level2type=N'COLUMN',@level2name=N'workid'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblInvoice].[PrimaryKey]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblInvoice', @level2type=N'CONSTRAINT',@level2name=N'tblInvoice$PrimaryKey'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblInvoice]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblInvoice'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblInvoice].[tblworktblInvoice]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblInvoice', @level2type=N'CONSTRAINT',@level2name=N'tblInvoice$tblworktblInvoice'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblKeyWord].[ID]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblKeyWord', @level2type=N'COLUMN',@level2name=N'ID'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblKeyWord].[KeyWord]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblKeyWord', @level2type=N'COLUMN',@level2name=N'KeyWord'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblKeyWord].[PrimaryKey]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblKeyWord', @level2type=N'CONSTRAINT',@level2name=N'tblKeyWord$PrimaryKey'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblKeyWord].[KeyWord]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblKeyWord', @level2type=N'INDEX',@level2name=N'tblKeyWord$KeyWord'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblKeyWord]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblKeyWord'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblnumbers].[Mynumber]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblnumbers', @level2type=N'COLUMN',@level2name=N'Mynumber'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblnumbers].[PrimaryKey]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblnumbers', @level2type=N'CONSTRAINT',@level2name=N'tblnumbers$PrimaryKey'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblnumbers]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblnumbers'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tbloptions].[OptionName]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tbloptions', @level2type=N'COLUMN',@level2name=N'OptionName'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tbloptions].[OptionValue]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tbloptions', @level2type=N'COLUMN',@level2name=N'OptionValue'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tbloptions].[PrimaryKey]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tbloptions', @level2type=N'CONSTRAINT',@level2name=N'tbloptions$PrimaryKey'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tbloptions]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tbloptions'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblpatients].[PersonID]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblpatients', @level2type=N'COLUMN',@level2name=N'PersonID'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblpatients].[patientID]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblpatients', @level2type=N'COLUMN',@level2name=N'patientID'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblpatients].[PatientName]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblpatients', @level2type=N'COLUMN',@level2name=N'PatientName'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblpatients].[Phone]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblpatients', @level2type=N'COLUMN',@level2name=N'Phone'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblpatients].[FirstName]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblpatients', @level2type=N'COLUMN',@level2name=N'FirstName'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblpatients].[LastName]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblpatients', @level2type=N'COLUMN',@level2name=N'LastName'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblpatients].[DateofBirth]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblpatients', @level2type=N'COLUMN',@level2name=N'DateofBirth'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblpatients].[Gender]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblpatients', @level2type=N'COLUMN',@level2name=N'Gender'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblpatients].[Phone2]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblpatients', @level2type=N'COLUMN',@level2name=N'Phone2'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblpatients].[AddressID]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblpatients', @level2type=N'COLUMN',@level2name=N'AddressID'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblpatients].[DateAdded]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblpatients', @level2type=N'COLUMN',@level2name=N'DateAdded'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblpatients].[PrimaryKey]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblpatients', @level2type=N'CONSTRAINT',@level2name=N'tblpatients$PrimaryKey'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblpatients].[tblAddresstblpatients]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblpatients', @level2type=N'INDEX',@level2name=N'tblpatients$tblAddresstblpatients'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblpatients].[tblGendertblpatients]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblpatients', @level2type=N'INDEX',@level2name=N'tblpatients$tblGendertblpatients'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblpatients]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblpatients'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblpatients].[tblAddresstblpatients]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblpatients', @level2type=N'CONSTRAINT',@level2name=N'tblpatients$tblAddresstblpatients'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblpatients].[tblGendertblpatients]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblpatients', @level2type=N'CONSTRAINT',@level2name=N'tblpatients$tblGendertblpatients'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblscrews].[ID]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblscrews', @level2type=N'COLUMN',@level2name=N'ID'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblscrews].[WorkID]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblscrews', @level2type=N'COLUMN',@level2name=N'WorkID'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblscrews].[PersonID]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblscrews', @level2type=N'COLUMN',@level2name=N'PersonID'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblscrews].[PlacementDate]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblscrews', @level2type=N'COLUMN',@level2name=N'PlacementDate'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblscrews].[Position]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblscrews', @level2type=N'COLUMN',@level2name=N'Position'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblscrews].[State]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblscrews', @level2type=N'COLUMN',@level2name=N'State'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblscrews].[PrimaryKey]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblscrews', @level2type=N'CONSTRAINT',@level2name=N'tblscrews$PrimaryKey'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblscrews].[PersonID]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblscrews', @level2type=N'INDEX',@level2name=N'tblscrews$PersonID'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblscrews].[tblpatientstblscrews]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblscrews', @level2type=N'INDEX',@level2name=N'tblscrews$tblpatientstblscrews'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblscrews].[tblworktblscrews]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblscrews', @level2type=N'INDEX',@level2name=N'tblscrews$tblworktblscrews'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblscrews].[WorkID]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblscrews', @level2type=N'INDEX',@level2name=N'tblscrews$WorkID'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblscrews]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblscrews'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblscrews].[tblpatientstblscrews]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblscrews', @level2type=N'CONSTRAINT',@level2name=N'tblscrews$tblpatientstblscrews'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblscrews].[tblworktblscrews]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblscrews', @level2type=N'CONSTRAINT',@level2name=N'tblscrews$tblworktblscrews'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblsms].[smssent]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblsms', @level2type=N'COLUMN',@level2name=N'smssent'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblsms].[SMSID]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblsms', @level2type=N'COLUMN',@level2name=N'SMSID'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblsms].[PrimaryKey]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblsms', @level2type=N'CONSTRAINT',@level2name=N'tblsms$PrimaryKey'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblsms].[SMSID]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblsms', @level2type=N'INDEX',@level2name=N'tblsms$SMSID'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblsms]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblsms'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tbltime].[TimeID]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tbltime', @level2type=N'COLUMN',@level2name=N'TimeID'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tbltime].[Time]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tbltime', @level2type=N'COLUMN',@level2name=N'Time'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tbltime].[PrimaryKey]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tbltime', @level2type=N'CONSTRAINT',@level2name=N'tbltime$PrimaryKey'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tbltime]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tbltime'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tbltimes].[TimeID]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tbltimes', @level2type=N'COLUMN',@level2name=N'TimeID'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tbltimes].[MyTime]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tbltimes', @level2type=N'COLUMN',@level2name=N'MyTime'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tbltimes].[PrimaryKey]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tbltimes', @level2type=N'CONSTRAINT',@level2name=N'tbltimes$PrimaryKey'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tbltimes]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tbltimes'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblvideos].[ID]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblvideos', @level2type=N'COLUMN',@level2name=N'ID'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblvideos].[Description]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblvideos', @level2type=N'COLUMN',@level2name=N'Description'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblvideos].[PrimaryKey]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblvideos', @level2type=N'CONSTRAINT',@level2name=N'tblvideos$PrimaryKey'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblvideos]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblvideos'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblvisits].[ID]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblvisits', @level2type=N'COLUMN',@level2name=N'ID'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblvisits].[WorkID]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblvisits', @level2type=N'COLUMN',@level2name=N'WorkID'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblvisits].[VisitDate]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblvisits', @level2type=N'COLUMN',@level2name=N'VisitDate'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblvisits].[BracketChange]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblvisits', @level2type=N'COLUMN',@level2name=N'BracketChange'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblvisits].[WireBending]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblvisits', @level2type=N'COLUMN',@level2name=N'WireBending'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblvisits].[OPG]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblvisits', @level2type=N'COLUMN',@level2name=N'OPG'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblvisits].[Others]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblvisits', @level2type=N'COLUMN',@level2name=N'Others'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblvisits].[NextVisit]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblvisits', @level2type=N'COLUMN',@level2name=N'NextVisit'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblvisits].[Elastics]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblvisits', @level2type=N'COLUMN',@level2name=N'Elastics'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblvisits].[UpperWireID]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblvisits', @level2type=N'COLUMN',@level2name=N'UpperWireID'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblvisits].[LowerWireID]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblvisits', @level2type=N'COLUMN',@level2name=N'LowerWireID'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblvisits].[Photo]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblvisits', @level2type=N'COLUMN',@level2name=N'PPhoto'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblvisits].[PrimaryKey]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblvisits', @level2type=N'CONSTRAINT',@level2name=N'tblvisits$PrimaryKey'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblvisits].[LowerWireID]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblvisits', @level2type=N'INDEX',@level2name=N'tblvisits$LowerWireID'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblvisits].[UniqueVisit]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblvisits', @level2type=N'INDEX',@level2name=N'tblvisits$UniqueVisit'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblvisits].[UpperWireID]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblvisits', @level2type=N'INDEX',@level2name=N'tblvisits$UpperWireID'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblvisits].[WorkID]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblvisits', @level2type=N'INDEX',@level2name=N'tblvisits$WorkID'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblvisits]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblvisits'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblvisits].[tblWirestblvisits]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblvisits', @level2type=N'CONSTRAINT',@level2name=N'tblvisits$tblWirestblvisits'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblvisits].[tblworktblvisits]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblvisits', @level2type=N'CONSTRAINT',@level2name=N'tblvisits$tblworktblvisits'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblWires].[Wire_ID]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblWires', @level2type=N'COLUMN',@level2name=N'Wire_ID'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblWires].[Wire]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblWires', @level2type=N'COLUMN',@level2name=N'Wire'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblWires].[PrimaryKey]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblWires', @level2type=N'CONSTRAINT',@level2name=N'tblWires$PrimaryKey'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblWires].[Wire_ID]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblWires', @level2type=N'INDEX',@level2name=N'tblWires$Wire_ID'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblWires]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblWires'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblwork].[workid]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblwork', @level2type=N'COLUMN',@level2name=N'workid'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblwork].[PersonID]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblwork', @level2type=N'COLUMN',@level2name=N'PersonID'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblwork].[TotalRequired]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblwork', @level2type=N'COLUMN',@level2name=N'TotalRequired'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblwork].[Currency]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblwork', @level2type=N'COLUMN',@level2name=N'Currency'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblwork].[Typeofwork]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblwork', @level2type=N'COLUMN',@level2name=N'Typeofwork'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblwork].[Notes]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblwork', @level2type=N'COLUMN',@level2name=N'Notes'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblwork].[Finished]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblwork', @level2type=N'COLUMN',@level2name=N'Finished'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblwork].[AdditionDate]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblwork', @level2type=N'COLUMN',@level2name=N'AdditionDate'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblwork].[KeyWordID1]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblwork', @level2type=N'COLUMN',@level2name=N'KeyWordID1'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblwork].[KeyWordID2]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblwork', @level2type=N'COLUMN',@level2name=N'KeyWordID2'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblwork].[KeywordID3]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblwork', @level2type=N'COLUMN',@level2name=N'KeywordID3'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblwork].[PrimaryKey]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblwork', @level2type=N'CONSTRAINT',@level2name=N'tblwork$PrimaryKey'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblwork].[KeyWordID1]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblwork', @level2type=N'INDEX',@level2name=N'tblwork$KeyWordID1'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblwork].[KeyWordID2]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblwork', @level2type=N'INDEX',@level2name=N'tblwork$KeyWordID2'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblwork].[KeywordID3]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblwork', @level2type=N'INDEX',@level2name=N'tblwork$KeywordID3'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblwork].[PersonID]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblwork', @level2type=N'INDEX',@level2name=N'tblwork$PersonID'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblwork]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblwork'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPane1', @value=N'[0E232FF0-B466-11cf-A24F-00AA00A3EFFF, 1.00]
Begin DesignProperties = 
   Begin PaneConfigurations = 
      Begin PaneConfiguration = 0
         NumPanes = 4
         Configuration = "(H (1[40] 4[20] 2[20] 3) )"
      End
      Begin PaneConfiguration = 1
         NumPanes = 3
         Configuration = "(H (1 [50] 4 [25] 3))"
      End
      Begin PaneConfiguration = 2
         NumPanes = 3
         Configuration = "(H (1 [50] 2 [25] 3))"
      End
      Begin PaneConfiguration = 3
         NumPanes = 3
         Configuration = "(H (4 [30] 2 [40] 3))"
      End
      Begin PaneConfiguration = 4
         NumPanes = 2
         Configuration = "(H (1 [56] 3))"
      End
      Begin PaneConfiguration = 5
         NumPanes = 2
         Configuration = "(H (2 [66] 3))"
      End
      Begin PaneConfiguration = 6
         NumPanes = 2
         Configuration = "(H (4 [50] 3))"
      End
      Begin PaneConfiguration = 7
         NumPanes = 1
         Configuration = "(V (3))"
      End
      Begin PaneConfiguration = 8
         NumPanes = 3
         Configuration = "(H (1[56] 4[18] 2) )"
      End
      Begin PaneConfiguration = 9
         NumPanes = 2
         Configuration = "(H (1 [75] 4))"
      End
      Begin PaneConfiguration = 10
         NumPanes = 2
         Configuration = "(H (1[66] 2) )"
      End
      Begin PaneConfiguration = 11
         NumPanes = 2
         Configuration = "(H (4 [60] 2))"
      End
      Begin PaneConfiguration = 12
         NumPanes = 1
         Configuration = "(H (1) )"
      End
      Begin PaneConfiguration = 13
         NumPanes = 1
         Configuration = "(V (4))"
      End
      Begin PaneConfiguration = 14
         NumPanes = 1
         Configuration = "(V (2))"
      End
      ActivePaneConfig = 0
   End
   Begin DiagramPane = 
      Begin Origin = 
         Top = 0
         Left = 0
      End
      Begin Tables = 
         Begin Table = "tblnumbers"
            Begin Extent = 
               Top = 6
               Left = 38
               Bottom = 85
               Right = 208
            End
            DisplayFlags = 280
            TopColumn = 0
         End
      End
   End
   Begin SQLPane = 
   End
   Begin DataPane = 
      Begin ParameterDefaults = ""
      End
      Begin ColumnWidths = 9
         Width = 284
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
      End
   End
   Begin CriteriaPane = 
      Begin ColumnWidths = 11
         Column = 1440
         Alias = 900
         Table = 1170
         Output = 720
         Append = 1400
         NewValue = 1170
         SortType = 1350
         SortOrder = 1410
         GroupBy = 1350
         Filter = 1350
         Or = 1350
         Or = 1350
         Or = 1350
      End
   End
End
' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'CalStep1'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPaneCount', @value=1 , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'CalStep1'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPane1', @value=N'[0E232FF0-B466-11cf-A24F-00AA00A3EFFF, 1.00]
Begin DesignProperties = 
   Begin PaneConfigurations = 
      Begin PaneConfiguration = 0
         NumPanes = 4
         Configuration = "(H (1[40] 4[20] 2[20] 3) )"
      End
      Begin PaneConfiguration = 1
         NumPanes = 3
         Configuration = "(H (1 [50] 4 [25] 3))"
      End
      Begin PaneConfiguration = 2
         NumPanes = 3
         Configuration = "(H (1 [50] 2 [25] 3))"
      End
      Begin PaneConfiguration = 3
         NumPanes = 3
         Configuration = "(H (4 [30] 2 [40] 3))"
      End
      Begin PaneConfiguration = 4
         NumPanes = 2
         Configuration = "(H (1 [56] 3))"
      End
      Begin PaneConfiguration = 5
         NumPanes = 2
         Configuration = "(H (2 [66] 3))"
      End
      Begin PaneConfiguration = 6
         NumPanes = 2
         Configuration = "(H (4 [50] 3))"
      End
      Begin PaneConfiguration = 7
         NumPanes = 1
         Configuration = "(V (3))"
      End
      Begin PaneConfiguration = 8
         NumPanes = 3
         Configuration = "(H (1[56] 4[18] 2) )"
      End
      Begin PaneConfiguration = 9
         NumPanes = 2
         Configuration = "(H (1 [75] 4))"
      End
      Begin PaneConfiguration = 10
         NumPanes = 2
         Configuration = "(H (1[66] 2) )"
      End
      Begin PaneConfiguration = 11
         NumPanes = 2
         Configuration = "(H (4 [60] 2))"
      End
      Begin PaneConfiguration = 12
         NumPanes = 1
         Configuration = "(H (1) )"
      End
      Begin PaneConfiguration = 13
         NumPanes = 1
         Configuration = "(V (4))"
      End
      Begin PaneConfiguration = 14
         NumPanes = 1
         Configuration = "(V (2))"
      End
      ActivePaneConfig = 0
   End
   Begin DiagramPane = 
      Begin Origin = 
         Top = 0
         Left = 0
      End
      Begin Tables = 
         Begin Table = "CalStep1"
            Begin Extent = 
               Top = 6
               Left = 38
               Bottom = 85
               Right = 208
            End
            DisplayFlags = 280
            TopColumn = 0
         End
         Begin Table = "tblholidays"
            Begin Extent = 
               Top = 6
               Left = 246
               Bottom = 85
               Right = 416
            End
            DisplayFlags = 280
            TopColumn = 0
         End
      End
   End
   Begin SQLPane = 
   End
   Begin DataPane = 
      Begin ParameterDefaults = ""
      End
   End
   Begin CriteriaPane = 
      Begin ColumnWidths = 11
         Column = 1440
         Alias = 900
         Table = 1170
         Output = 720
         Append = 1400
         NewValue = 1170
         SortType = 1350
         SortOrder = 1410
         GroupBy = 1350
         Filter = 1350
         Or = 1350
         Or = 1350
         Or = 1350
      End
   End
End
' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'CalStep2'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPaneCount', @value=1 , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'CalStep2'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPane1', @value=N'[0E232FF0-B466-11cf-A24F-00AA00A3EFFF, 1.00]
Begin DesignProperties = 
   Begin PaneConfigurations = 
      Begin PaneConfiguration = 0
         NumPanes = 4
         Configuration = "(H (1[40] 4[20] 2[20] 3) )"
      End
      Begin PaneConfiguration = 1
         NumPanes = 3
         Configuration = "(H (1 [50] 4 [25] 3))"
      End
      Begin PaneConfiguration = 2
         NumPanes = 3
         Configuration = "(H (1 [50] 2 [25] 3))"
      End
      Begin PaneConfiguration = 3
         NumPanes = 3
         Configuration = "(H (4 [30] 2 [40] 3))"
      End
      Begin PaneConfiguration = 4
         NumPanes = 2
         Configuration = "(H (1 [56] 3))"
      End
      Begin PaneConfiguration = 5
         NumPanes = 2
         Configuration = "(H (2 [66] 3))"
      End
      Begin PaneConfiguration = 6
         NumPanes = 2
         Configuration = "(H (4 [50] 3))"
      End
      Begin PaneConfiguration = 7
         NumPanes = 1
         Configuration = "(V (3))"
      End
      Begin PaneConfiguration = 8
         NumPanes = 3
         Configuration = "(H (1[56] 4[18] 2) )"
      End
      Begin PaneConfiguration = 9
         NumPanes = 2
         Configuration = "(H (1 [75] 4))"
      End
      Begin PaneConfiguration = 10
         NumPanes = 2
         Configuration = "(H (1[66] 2) )"
      End
      Begin PaneConfiguration = 11
         NumPanes = 2
         Configuration = "(H (4 [60] 2))"
      End
      Begin PaneConfiguration = 12
         NumPanes = 1
         Configuration = "(H (1) )"
      End
      Begin PaneConfiguration = 13
         NumPanes = 1
         Configuration = "(V (4))"
      End
      Begin PaneConfiguration = 14
         NumPanes = 1
         Configuration = "(V (2))"
      End
      ActivePaneConfig = 0
   End
   Begin DiagramPane = 
      Begin Origin = 
         Top = 0
         Left = 0
      End
      Begin Tables = 
         Begin Table = "qrylastvisit"
            Begin Extent = 
               Top = 6
               Left = 38
               Bottom = 102
               Right = 208
            End
            DisplayFlags = 280
            TopColumn = 0
         End
         Begin Table = "tblvisits"
            Begin Extent = 
               Top = 50
               Left = 315
               Bottom = 180
               Right = 507
            End
            DisplayFlags = 280
            TopColumn = 0
         End
         Begin Table = "tblWires"
            Begin Extent = 
               Top = 6
               Left = 684
               Bottom = 102
               Right = 854
            End
            DisplayFlags = 280
            TopColumn = 0
         End
      End
   End
   Begin SQLPane = 
   End
   Begin DataPane = 
      Begin ParameterDefaults = ""
      End
      Begin ColumnWidths = 9
         Width = 284
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
      End
   End
   Begin CriteriaPane = 
      Begin ColumnWidths = 11
         Column = 1440
         Alias = 900
         Table = 1170
         Output = 720
         Append = 1400
         NewValue = 1170
         SortType = 1350
         SortOrder = 1410
         GroupBy = 1350
         Filter = 1350
         Or = 1350
         Or = 1350
         Or = 1350
      End
   End
End
' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'qrylastLwire'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPaneCount', @value=N'1' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'qrylastLwire'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPane1', @value=N'[0E232FF0-B466-11cf-A24F-00AA00A3EFFF, 1.00]
Begin DesignProperties = 
   Begin PaneConfigurations = 
      Begin PaneConfiguration = 0
         NumPanes = 4
         Configuration = "(H (1[40] 4[20] 2[20] 3) )"
      End
      Begin PaneConfiguration = 1
         NumPanes = 3
         Configuration = "(H (1 [50] 4 [25] 3))"
      End
      Begin PaneConfiguration = 2
         NumPanes = 3
         Configuration = "(H (1 [50] 2 [25] 3))"
      End
      Begin PaneConfiguration = 3
         NumPanes = 3
         Configuration = "(H (4 [30] 2 [40] 3))"
      End
      Begin PaneConfiguration = 4
         NumPanes = 2
         Configuration = "(H (1 [56] 3))"
      End
      Begin PaneConfiguration = 5
         NumPanes = 2
         Configuration = "(H (2 [66] 3))"
      End
      Begin PaneConfiguration = 6
         NumPanes = 2
         Configuration = "(H (4 [50] 3))"
      End
      Begin PaneConfiguration = 7
         NumPanes = 1
         Configuration = "(V (3))"
      End
      Begin PaneConfiguration = 8
         NumPanes = 3
         Configuration = "(H (1[56] 4[18] 2) )"
      End
      Begin PaneConfiguration = 9
         NumPanes = 2
         Configuration = "(H (1 [75] 4))"
      End
      Begin PaneConfiguration = 10
         NumPanes = 2
         Configuration = "(H (1[66] 2) )"
      End
      Begin PaneConfiguration = 11
         NumPanes = 2
         Configuration = "(H (4 [60] 2))"
      End
      Begin PaneConfiguration = 12
         NumPanes = 1
         Configuration = "(H (1) )"
      End
      Begin PaneConfiguration = 13
         NumPanes = 1
         Configuration = "(V (4))"
      End
      Begin PaneConfiguration = 14
         NumPanes = 1
         Configuration = "(V (2))"
      End
      ActivePaneConfig = 0
   End
   Begin DiagramPane = 
      Begin Origin = 
         Top = 0
         Left = 0
      End
      Begin Tables = 
         Begin Table = "qrylastvisit"
            Begin Extent = 
               Top = 89
               Left = 62
               Bottom = 190
               Right = 232
            End
            DisplayFlags = 280
            TopColumn = 0
         End
         Begin Table = "tblvisits"
            Begin Extent = 
               Top = 23
               Left = 334
               Bottom = 268
               Right = 526
            End
            DisplayFlags = 280
            TopColumn = 0
         End
         Begin Table = "tblWires"
            Begin Extent = 
               Top = 83
               Left = 645
               Bottom = 179
               Right = 815
            End
            DisplayFlags = 280
            TopColumn = 0
         End
      End
   End
   Begin SQLPane = 
   End
   Begin DataPane = 
      Begin ParameterDefaults = ""
      End
   End
   Begin CriteriaPane = 
      Begin ColumnWidths = 11
         Column = 1440
         Alias = 900
         Table = 1170
         Output = 720
         Append = 1400
         NewValue = 1170
         SortType = 1350
         SortOrder = 1410
         GroupBy = 1350
         Filter = 1350
         Or = 1350
         Or = 1350
         Or = 1350
      End
   End
End
' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'qrylastUwire'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPaneCount', @value=N'1' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'qrylastUwire'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'Dr.Shwan_V8.[qrylastwires]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'qrylastUwire'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPane1', @value=N'[0E232FF0-B466-11cf-A24F-00AA00A3EFFF, 1.00]
Begin DesignProperties = 
   Begin PaneConfigurations = 
      Begin PaneConfiguration = 0
         NumPanes = 4
         Configuration = "(H (1[32] 4[25] 2[18] 3) )"
      End
      Begin PaneConfiguration = 1
         NumPanes = 3
         Configuration = "(H (1 [50] 4 [25] 3))"
      End
      Begin PaneConfiguration = 2
         NumPanes = 3
         Configuration = "(H (1 [50] 2 [25] 3))"
      End
      Begin PaneConfiguration = 3
         NumPanes = 3
         Configuration = "(H (4 [30] 2 [40] 3))"
      End
      Begin PaneConfiguration = 4
         NumPanes = 2
         Configuration = "(H (1 [56] 3))"
      End
      Begin PaneConfiguration = 5
         NumPanes = 2
         Configuration = "(H (2 [66] 3))"
      End
      Begin PaneConfiguration = 6
         NumPanes = 2
         Configuration = "(H (4 [50] 3))"
      End
      Begin PaneConfiguration = 7
         NumPanes = 1
         Configuration = "(V (3))"
      End
      Begin PaneConfiguration = 8
         NumPanes = 3
         Configuration = "(H (1[56] 4[18] 2) )"
      End
      Begin PaneConfiguration = 9
         NumPanes = 2
         Configuration = "(H (1 [75] 4))"
      End
      Begin PaneConfiguration = 10
         NumPanes = 2
         Configuration = "(H (1[66] 2) )"
      End
      Begin PaneConfiguration = 11
         NumPanes = 2
         Configuration = "(H (4 [60] 2))"
      End
      Begin PaneConfiguration = 12
         NumPanes = 1
         Configuration = "(H (1) )"
      End
      Begin PaneConfiguration = 13
         NumPanes = 1
         Configuration = "(V (4))"
      End
      Begin PaneConfiguration = 14
         NumPanes = 1
         Configuration = "(V (2))"
      End
      ActivePaneConfig = 0
   End
   Begin DiagramPane = 
      Begin Origin = 
         Top = 0
         Left = 0
      End
      Begin Tables = 
         Begin Table = "tblpatients"
            Begin Extent = 
               Top = 6
               Left = 38
               Bottom = 136
               Right = 208
            End
            DisplayFlags = 280
            TopColumn = 0
         End
         Begin Table = "tblwork"
            Begin Extent = 
               Top = 13
               Left = 303
               Bottom = 143
               Right = 473
            End
            DisplayFlags = 280
            TopColumn = 0
         End
         Begin Table = "tblvisits"
            Begin Extent = 
               Top = 0
               Left = 559
               Bottom = 204
               Right = 800
            End
            DisplayFlags = 280
            TopColumn = 9
         End
      End
   End
   Begin SQLPane = 
   End
   Begin DataPane = 
      Begin ParameterDefaults = ""
      End
      Begin ColumnWidths = 10
         Width = 284
         Width = 1500
         Width = 510
         Width = 585
         Width = 570
         Width = 705
         Width = 9900
         Width = 1500
         Width = 1500
         Width = 870
      End
   End
   Begin CriteriaPane = 
      Begin ColumnWidths = 11
         Column = 1440
         Alias = 900
         Table = 1170
         Output = 720
         Append = 1400
         NewValue = 1170
         SortType = 1350
         SortOrder = 1410
         GroupBy = 1350
         Filter = 1350
         Or = 1350
         Or = 1350
         Or = 1350
      End
   End
End
' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'qryVisitSummary'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPaneCount', @value=1 , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'qryVisitSummary'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPane1', @value=N'[0E232FF0-B466-11cf-A24F-00AA00A3EFFF, 1.00]
Begin DesignProperties = 
   Begin PaneConfigurations = 
      Begin PaneConfiguration = 0
         NumPanes = 4
         Configuration = "(H (1[41] 4[28] 2[22] 3) )"
      End
      Begin PaneConfiguration = 1
         NumPanes = 3
         Configuration = "(H (1 [50] 4 [25] 3))"
      End
      Begin PaneConfiguration = 2
         NumPanes = 3
         Configuration = "(H (1 [50] 2 [25] 3))"
      End
      Begin PaneConfiguration = 3
         NumPanes = 3
         Configuration = "(H (4 [30] 2 [40] 3))"
      End
      Begin PaneConfiguration = 4
         NumPanes = 2
         Configuration = "(H (1 [56] 3))"
      End
      Begin PaneConfiguration = 5
         NumPanes = 2
         Configuration = "(H (2 [66] 3))"
      End
      Begin PaneConfiguration = 6
         NumPanes = 2
         Configuration = "(H (4 [50] 3))"
      End
      Begin PaneConfiguration = 7
         NumPanes = 1
         Configuration = "(V (3))"
      End
      Begin PaneConfiguration = 8
         NumPanes = 3
         Configuration = "(H (1[56] 4[18] 2) )"
      End
      Begin PaneConfiguration = 9
         NumPanes = 2
         Configuration = "(H (1 [75] 4))"
      End
      Begin PaneConfiguration = 10
         NumPanes = 2
         Configuration = "(H (1[66] 2) )"
      End
      Begin PaneConfiguration = 11
         NumPanes = 2
         Configuration = "(H (4 [60] 2))"
      End
      Begin PaneConfiguration = 12
         NumPanes = 1
         Configuration = "(H (1) )"
      End
      Begin PaneConfiguration = 13
         NumPanes = 1
         Configuration = "(V (4))"
      End
      Begin PaneConfiguration = 14
         NumPanes = 1
         Configuration = "(V (2))"
      End
      ActivePaneConfig = 0
   End
   Begin DiagramPane = 
      Begin Origin = 
         Top = 0
         Left = 0
      End
      Begin Tables = 
         Begin Table = "w"
            Begin Extent = 
               Top = 6
               Left = 38
               Bottom = 457
               Right = 263
            End
            DisplayFlags = 280
            TopColumn = 0
         End
      End
   End
   Begin SQLPane = 
   End
   Begin DataPane = 
      Begin ParameterDefaults = ""
      End
      Begin ColumnWidths = 9
         Width = 284
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
      End
   End
   Begin CriteriaPane = 
      Begin ColumnWidths = 11
         Column = 1440
         Alias = 900
         Table = 1174
         Output = 720
         Append = 1400
         NewValue = 1170
         SortType = 1354
         SortOrder = 1414
         GroupBy = 1350
         Filter = 1354
         Or = 1350
         Or = 1350
         Or = 1350
      End
   End
End
' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_ActiveWork'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPaneCount', @value=1 , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_ActiveWork'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPane1', @value=N'[0E232FF0-B466-11cf-A24F-00AA00A3EFFF, 1.00]
Begin DesignProperties = 
   Begin PaneConfigurations = 
      Begin PaneConfiguration = 0
         NumPanes = 4
         Configuration = "(H (1[40] 4[20] 2[20] 3) )"
      End
      Begin PaneConfiguration = 1
         NumPanes = 3
         Configuration = "(H (1 [50] 4 [25] 3))"
      End
      Begin PaneConfiguration = 2
         NumPanes = 3
         Configuration = "(H (1 [50] 2 [25] 3))"
      End
      Begin PaneConfiguration = 3
         NumPanes = 3
         Configuration = "(H (4 [30] 2 [40] 3))"
      End
      Begin PaneConfiguration = 4
         NumPanes = 2
         Configuration = "(H (1 [56] 3))"
      End
      Begin PaneConfiguration = 5
         NumPanes = 2
         Configuration = "(H (2 [66] 3))"
      End
      Begin PaneConfiguration = 6
         NumPanes = 2
         Configuration = "(H (4 [50] 3))"
      End
      Begin PaneConfiguration = 7
         NumPanes = 1
         Configuration = "(V (3))"
      End
      Begin PaneConfiguration = 8
         NumPanes = 3
         Configuration = "(H (1[56] 4[18] 2) )"
      End
      Begin PaneConfiguration = 9
         NumPanes = 2
         Configuration = "(H (1 [75] 4))"
      End
      Begin PaneConfiguration = 10
         NumPanes = 2
         Configuration = "(H (1[66] 2) )"
      End
      Begin PaneConfiguration = 11
         NumPanes = 2
         Configuration = "(H (4 [60] 2))"
      End
      Begin PaneConfiguration = 12
         NumPanes = 1
         Configuration = "(H (1) )"
      End
      Begin PaneConfiguration = 13
         NumPanes = 1
         Configuration = "(V (4))"
      End
      Begin PaneConfiguration = 14
         NumPanes = 1
         Configuration = "(V (2))"
      End
      ActivePaneConfig = 0
   End
   Begin DiagramPane = 
      Begin Origin = 
         Top = 0
         Left = 0
      End
      Begin Tables = 
         Begin Table = "tblInvoice"
            Begin Extent = 
               Top = 15
               Left = 96
               Bottom = 324
               Right = 449
            End
            DisplayFlags = 280
            TopColumn = 0
         End
         Begin Table = "tblwork"
            Begin Extent = 
               Top = 15
               Left = 545
               Bottom = 324
               Right = 937
            End
            DisplayFlags = 280
            TopColumn = 0
         End
      End
   End
   Begin SQLPane = 
   End
   Begin DataPane = 
      Begin ParameterDefaults = ""
      End
   End
   Begin CriteriaPane = 
      Begin ColumnWidths = 12
         Column = 1440
         Alias = 900
         Table = 1170
         Output = 720
         Append = 1400
         NewValue = 1170
         SortType = 1350
         SortOrder = 1410
         GroupBy = 1350
         Filter = 1350
         Or = 1350
         Or = 1350
         Or = 1350
      End
   End
End
' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_ActualIQD'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPaneCount', @value=1 , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_ActualIQD'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPane1', @value=N'[0E232FF0-B466-11cf-A24F-00AA00A3EFFF, 1.00]
Begin DesignProperties = 
   Begin PaneConfigurations = 
      Begin PaneConfiguration = 0
         NumPanes = 4
         Configuration = "(H (1[40] 4[20] 2[20] 3) )"
      End
      Begin PaneConfiguration = 1
         NumPanes = 3
         Configuration = "(H (1 [50] 4 [25] 3))"
      End
      Begin PaneConfiguration = 2
         NumPanes = 3
         Configuration = "(H (1 [50] 2 [25] 3))"
      End
      Begin PaneConfiguration = 3
         NumPanes = 3
         Configuration = "(H (4 [30] 2 [40] 3))"
      End
      Begin PaneConfiguration = 4
         NumPanes = 2
         Configuration = "(H (1 [56] 3))"
      End
      Begin PaneConfiguration = 5
         NumPanes = 2
         Configuration = "(H (2 [66] 3))"
      End
      Begin PaneConfiguration = 6
         NumPanes = 2
         Configuration = "(H (4 [50] 3))"
      End
      Begin PaneConfiguration = 7
         NumPanes = 1
         Configuration = "(V (3))"
      End
      Begin PaneConfiguration = 8
         NumPanes = 3
         Configuration = "(H (1[56] 4[18] 2) )"
      End
      Begin PaneConfiguration = 9
         NumPanes = 2
         Configuration = "(H (1 [75] 4))"
      End
      Begin PaneConfiguration = 10
         NumPanes = 2
         Configuration = "(H (1[66] 2) )"
      End
      Begin PaneConfiguration = 11
         NumPanes = 2
         Configuration = "(H (4 [60] 2))"
      End
      Begin PaneConfiguration = 12
         NumPanes = 1
         Configuration = "(H (1) )"
      End
      Begin PaneConfiguration = 13
         NumPanes = 1
         Configuration = "(V (4))"
      End
      Begin PaneConfiguration = 14
         NumPanes = 1
         Configuration = "(V (2))"
      End
      ActivePaneConfig = 0
   End
   Begin DiagramPane = 
      Begin Origin = 
         Top = 0
         Left = 0
      End
      Begin Tables = 
         Begin Table = "tblInvoice"
            Begin Extent = 
               Top = 15
               Left = 96
               Bottom = 324
               Right = 449
            End
            DisplayFlags = 280
            TopColumn = 0
         End
         Begin Table = "tblwork"
            Begin Extent = 
               Top = 15
               Left = 545
               Bottom = 324
               Right = 937
            End
            DisplayFlags = 280
            TopColumn = 0
         End
      End
   End
   Begin SQLPane = 
   End
   Begin DataPane = 
      Begin ParameterDefaults = ""
      End
      Begin ColumnWidths = 9
         Width = 284
         Width = 600
         Width = 600
         Width = 600
         Width = 600
         Width = 600
         Width = 600
         Width = 600
         Width = 600
      End
   End
   Begin CriteriaPane = 
      Begin ColumnWidths = 12
         Column = 1440
         Alias = 900
         Table = 1170
         Output = 720
         Append = 1400
         NewValue = 1170
         SortType = 1350
         SortOrder = 1410
         GroupBy = 1350
         Filter = 1350
         Or = 1350
         Or = 1350
         Or = 1350
      End
   End
End
' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_ActualUSD'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPaneCount', @value=1 , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_ActualUSD'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPane1', @value=N'[0E232FF0-B466-11cf-A24F-00AA00A3EFFF, 1.00]
Begin DesignProperties = 
   Begin PaneConfigurations = 
      Begin PaneConfiguration = 0
         NumPanes = 4
         Configuration = "(H (1[26] 4[38] 2[11] 3) )"
      End
      Begin PaneConfiguration = 1
         NumPanes = 3
         Configuration = "(H (1 [50] 4 [25] 3))"
      End
      Begin PaneConfiguration = 2
         NumPanes = 3
         Configuration = "(H (1 [50] 2 [25] 3))"
      End
      Begin PaneConfiguration = 3
         NumPanes = 3
         Configuration = "(H (4 [30] 2 [40] 3))"
      End
      Begin PaneConfiguration = 4
         NumPanes = 2
         Configuration = "(H (1 [56] 3))"
      End
      Begin PaneConfiguration = 5
         NumPanes = 2
         Configuration = "(H (2 [66] 3))"
      End
      Begin PaneConfiguration = 6
         NumPanes = 2
         Configuration = "(H (4 [50] 3))"
      End
      Begin PaneConfiguration = 7
         NumPanes = 1
         Configuration = "(V (3))"
      End
      Begin PaneConfiguration = 8
         NumPanes = 3
         Configuration = "(H (1[56] 4[18] 2) )"
      End
      Begin PaneConfiguration = 9
         NumPanes = 2
         Configuration = "(H (1 [75] 4))"
      End
      Begin PaneConfiguration = 10
         NumPanes = 2
         Configuration = "(H (1[66] 2) )"
      End
      Begin PaneConfiguration = 11
         NumPanes = 2
         Configuration = "(H (4 [60] 2))"
      End
      Begin PaneConfiguration = 12
         NumPanes = 1
         Configuration = "(H (1) )"
      End
      Begin PaneConfiguration = 13
         NumPanes = 1
         Configuration = "(V (4))"
      End
      Begin PaneConfiguration = 14
         NumPanes = 1
         Configuration = "(V (2))"
      End
      ActivePaneConfig = 0
   End
   Begin DiagramPane = 
      Begin Origin = 
         Top = 0
         Left = 0
      End
      Begin Tables = 
         Begin Table = "tblCarriedWires"
            Begin Extent = 
               Top = 7
               Left = 48
               Bottom = 170
               Right = 248
            End
            DisplayFlags = 280
            TopColumn = 0
         End
         Begin Table = "tblpatients"
            Begin Extent = 
               Top = 7
               Left = 296
               Bottom = 170
               Right = 503
            End
            DisplayFlags = 280
            TopColumn = 0
         End
         Begin Table = "tblWires"
            Begin Extent = 
               Top = 102
               Left = 541
               Bottom = 221
               Right = 735
            End
            DisplayFlags = 280
            TopColumn = 0
         End
      End
   End
   Begin SQLPane = 
   End
   Begin DataPane = 
      Begin ParameterDefaults = ""
      End
      Begin ColumnWidths = 10
         Width = 284
         Width = 1200
         Width = 1200
         Width = 1728
         Width = 1764
         Width = 1200
         Width = 1200
         Width = 1080
         Width = 756
         Width = 1200
      End
   End
   Begin CriteriaPane = 
      Begin ColumnWidths = 11
         Column = 3936
         Alias = 900
         Table = 1176
         Output = 720
         Append = 1400
         NewValue = 1170
         SortType = 1356
         SortOrder = 1416
         GroupBy = 1350
         Filter = 1356
         Or = 1350
         Or = 1350
         Or = 1350
      End
   End
End
' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_CarriedWires'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPaneCount', @value=1 , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_CarriedWires'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPane1', @value=N'[0E232FF0-B466-11cf-A24F-00AA00A3EFFF, 1.00]
Begin DesignProperties = 
   Begin PaneConfigurations = 
      Begin PaneConfiguration = 0
         NumPanes = 4
         Configuration = "(H (1[59] 4[10] 2[14] 3) )"
      End
      Begin PaneConfiguration = 1
         NumPanes = 3
         Configuration = "(H (1 [50] 4 [25] 3))"
      End
      Begin PaneConfiguration = 2
         NumPanes = 3
         Configuration = "(H (1 [50] 2 [25] 3))"
      End
      Begin PaneConfiguration = 3
         NumPanes = 3
         Configuration = "(H (4 [30] 2 [40] 3))"
      End
      Begin PaneConfiguration = 4
         NumPanes = 2
         Configuration = "(H (1 [56] 3))"
      End
      Begin PaneConfiguration = 5
         NumPanes = 2
         Configuration = "(H (2 [66] 3))"
      End
      Begin PaneConfiguration = 6
         NumPanes = 2
         Configuration = "(H (4 [50] 3))"
      End
      Begin PaneConfiguration = 7
         NumPanes = 1
         Configuration = "(V (3))"
      End
      Begin PaneConfiguration = 8
         NumPanes = 3
         Configuration = "(H (1[56] 4[18] 2) )"
      End
      Begin PaneConfiguration = 9
         NumPanes = 2
         Configuration = "(H (1 [75] 4))"
      End
      Begin PaneConfiguration = 10
         NumPanes = 2
         Configuration = "(H (1[66] 2) )"
      End
      Begin PaneConfiguration = 11
         NumPanes = 2
         Configuration = "(H (4 [60] 2))"
      End
      Begin PaneConfiguration = 12
         NumPanes = 1
         Configuration = "(H (1) )"
      End
      Begin PaneConfiguration = 13
         NumPanes = 1
         Configuration = "(V (4))"
      End
      Begin PaneConfiguration = 14
         NumPanes = 1
         Configuration = "(V (2))"
      End
      ActivePaneConfig = 0
   End
   Begin DiagramPane = 
      Begin Origin = 
         Top = 0
         Left = 0
      End
      Begin Tables = 
         Begin Table = "tblpatients"
            Begin Extent = 
               Top = 258
               Left = 265
               Bottom = 388
               Right = 441
            End
            DisplayFlags = 280
            TopColumn = 0
         End
         Begin Table = "dolp"
            Begin Extent = 
               Top = 0
               Left = 681
               Bottom = 356
               Right = 926
            End
            DisplayFlags = 280
            TopColumn = 11
         End
         Begin Table = "tp"
            Begin Extent = 
               Top = 0
               Left = 345
               Bottom = 244
               Right = 515
            End
            DisplayFlags = 280
            TopColumn = 1
         End
         Begin Table = "tblwork"
            Begin Extent = 
               Top = 6
               Left = 38
               Bottom = 359
               Right = 225
            End
            DisplayFlags = 280
            TopColumn = 0
         End
      End
   End
   Begin SQLPane = 
   End
   Begin DataPane = 
      Begin ParameterDefaults = ""
      End
      Begin ColumnWidths = 9
         Width = 284
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
      End
   End
   Begin CriteriaPane = 
      Begin ColumnWidths = 11
         Column = 1440
         Alias = 900
         Table = 1170
         Output = 720
         Append = 1400
         NewValue = 1170
         SortType = 1350
         SortOrder = 1410
         GroupBy = 1350
         Filter = 1350
         Or = 1350
         Or = 1350
         Or = 1350
      End
   End' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_Dol_TP'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPane2', @value=N'
End
' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_Dol_TP'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPaneCount', @value=2 , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_Dol_TP'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPane1', @value=N'[0E232FF0-B466-11cf-A24F-00AA00A3EFFF, 1.00]
Begin DesignProperties = 
   Begin PaneConfigurations = 
      Begin PaneConfiguration = 0
         NumPanes = 4
         Configuration = "(H (1[40] 4[20] 2[20] 3) )"
      End
      Begin PaneConfiguration = 1
         NumPanes = 3
         Configuration = "(H (1 [50] 4 [25] 3))"
      End
      Begin PaneConfiguration = 2
         NumPanes = 3
         Configuration = "(H (1 [50] 2 [25] 3))"
      End
      Begin PaneConfiguration = 3
         NumPanes = 3
         Configuration = "(H (4 [30] 2 [40] 3))"
      End
      Begin PaneConfiguration = 4
         NumPanes = 2
         Configuration = "(H (1 [56] 3))"
      End
      Begin PaneConfiguration = 5
         NumPanes = 2
         Configuration = "(H (2 [66] 3))"
      End
      Begin PaneConfiguration = 6
         NumPanes = 2
         Configuration = "(H (4 [50] 3))"
      End
      Begin PaneConfiguration = 7
         NumPanes = 1
         Configuration = "(V (3))"
      End
      Begin PaneConfiguration = 8
         NumPanes = 3
         Configuration = "(H (1[56] 4[18] 2) )"
      End
      Begin PaneConfiguration = 9
         NumPanes = 2
         Configuration = "(H (1 [75] 4))"
      End
      Begin PaneConfiguration = 10
         NumPanes = 2
         Configuration = "(H (1[66] 2) )"
      End
      Begin PaneConfiguration = 11
         NumPanes = 2
         Configuration = "(H (4 [60] 2))"
      End
      Begin PaneConfiguration = 12
         NumPanes = 1
         Configuration = "(H (1) )"
      End
      Begin PaneConfiguration = 13
         NumPanes = 1
         Configuration = "(V (4))"
      End
      Begin PaneConfiguration = 14
         NumPanes = 1
         Configuration = "(V (2))"
      End
      ActivePaneConfig = 0
   End
   Begin DiagramPane = 
      Begin Origin = 
         Top = 0
         Left = 0
      End
      Begin Tables = 
         Begin Table = "tblExpenses"
            Begin Extent = 
               Top = 7
               Left = 48
               Bottom = 170
               Right = 242
            End
            DisplayFlags = 280
            TopColumn = 0
         End
      End
   End
   Begin SQLPane = 
   End
   Begin DataPane = 
      Begin ParameterDefaults = ""
      End
      Begin ColumnWidths = 9
         Width = 284
         Width = 1548
         Width = 852
         Width = 600
         Width = 600
         Width = 600
         Width = 600
         Width = 600
         Width = 600
      End
   End
   Begin CriteriaPane = 
      Begin ColumnWidths = 12
         Column = 1440
         Alias = 900
         Table = 1176
         Output = 720
         Append = 1400
         NewValue = 1170
         SortType = 1356
         SortOrder = 1416
         GroupBy = 1350
         Filter = 1356
         Or = 1350
         Or = 1350
         Or = 1350
      End
   End
End
' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_EI$'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPaneCount', @value=1 , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_EI$'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPane1', @value=N'[0E232FF0-B466-11cf-A24F-00AA00A3EFFF, 1.00]
Begin DesignProperties = 
   Begin PaneConfigurations = 
      Begin PaneConfiguration = 0
         NumPanes = 4
         Configuration = "(H (1[40] 4[20] 2[20] 3) )"
      End
      Begin PaneConfiguration = 1
         NumPanes = 3
         Configuration = "(H (1 [50] 4 [25] 3))"
      End
      Begin PaneConfiguration = 2
         NumPanes = 3
         Configuration = "(H (1 [50] 2 [25] 3))"
      End
      Begin PaneConfiguration = 3
         NumPanes = 3
         Configuration = "(H (4 [30] 2 [40] 3))"
      End
      Begin PaneConfiguration = 4
         NumPanes = 2
         Configuration = "(H (1 [56] 3))"
      End
      Begin PaneConfiguration = 5
         NumPanes = 2
         Configuration = "(H (2 [66] 3))"
      End
      Begin PaneConfiguration = 6
         NumPanes = 2
         Configuration = "(H (4 [50] 3))"
      End
      Begin PaneConfiguration = 7
         NumPanes = 1
         Configuration = "(V (3))"
      End
      Begin PaneConfiguration = 8
         NumPanes = 3
         Configuration = "(H (1[56] 4[18] 2) )"
      End
      Begin PaneConfiguration = 9
         NumPanes = 2
         Configuration = "(H (1 [75] 4))"
      End
      Begin PaneConfiguration = 10
         NumPanes = 2
         Configuration = "(H (1[66] 2) )"
      End
      Begin PaneConfiguration = 11
         NumPanes = 2
         Configuration = "(H (4 [60] 2))"
      End
      Begin PaneConfiguration = 12
         NumPanes = 1
         Configuration = "(H (1) )"
      End
      Begin PaneConfiguration = 13
         NumPanes = 1
         Configuration = "(V (4))"
      End
      Begin PaneConfiguration = 14
         NumPanes = 1
         Configuration = "(V (2))"
      End
      ActivePaneConfig = 0
   End
   Begin DiagramPane = 
      Begin Origin = 
         Top = 0
         Left = 0
      End
      Begin Tables = 
         Begin Table = "tblExpenses"
            Begin Extent = 
               Top = 7
               Left = 48
               Bottom = 170
               Right = 242
            End
            DisplayFlags = 280
            TopColumn = 0
         End
      End
   End
   Begin SQLPane = 
   End
   Begin DataPane = 
      Begin ParameterDefaults = ""
      End
      Begin ColumnWidths = 9
         Width = 284
         Width = 1200
         Width = 1200
         Width = 1200
         Width = 1200
         Width = 1200
         Width = 1200
         Width = 1200
         Width = 1200
      End
   End
   Begin CriteriaPane = 
      Begin ColumnWidths = 12
         Column = 1440
         Alias = 900
         Table = 1176
         Output = 720
         Append = 1400
         NewValue = 1170
         SortType = 1356
         SortOrder = 1416
         GroupBy = 1350
         Filter = 1356
         Or = 1350
         Or = 1350
         Or = 1350
      End
   End
End
' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_EIQ'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPaneCount', @value=1 , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_EIQ'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPane1', @value=N'[0E232FF0-B466-11cf-A24F-00AA00A3EFFF, 1.00]
Begin DesignProperties = 
   Begin PaneConfigurations = 
      Begin PaneConfiguration = 0
         NumPanes = 4
         Configuration = "(H (1[40] 4[20] 2[20] 3) )"
      End
      Begin PaneConfiguration = 1
         NumPanes = 3
         Configuration = "(H (1 [50] 4 [25] 3))"
      End
      Begin PaneConfiguration = 2
         NumPanes = 3
         Configuration = "(H (1 [50] 2 [25] 3))"
      End
      Begin PaneConfiguration = 3
         NumPanes = 3
         Configuration = "(H (4 [30] 2 [40] 3))"
      End
      Begin PaneConfiguration = 4
         NumPanes = 2
         Configuration = "(H (1 [56] 3))"
      End
      Begin PaneConfiguration = 5
         NumPanes = 2
         Configuration = "(H (2 [66] 3))"
      End
      Begin PaneConfiguration = 6
         NumPanes = 2
         Configuration = "(H (4 [50] 3))"
      End
      Begin PaneConfiguration = 7
         NumPanes = 1
         Configuration = "(V (3))"
      End
      Begin PaneConfiguration = 8
         NumPanes = 3
         Configuration = "(H (1[56] 4[18] 2) )"
      End
      Begin PaneConfiguration = 9
         NumPanes = 2
         Configuration = "(H (1 [75] 4))"
      End
      Begin PaneConfiguration = 10
         NumPanes = 2
         Configuration = "(H (1[66] 2) )"
      End
      Begin PaneConfiguration = 11
         NumPanes = 2
         Configuration = "(H (4 [60] 2))"
      End
      Begin PaneConfiguration = 12
         NumPanes = 1
         Configuration = "(H (1) )"
      End
      Begin PaneConfiguration = 13
         NumPanes = 1
         Configuration = "(V (4))"
      End
      Begin PaneConfiguration = 14
         NumPanes = 1
         Configuration = "(V (2))"
      End
      ActivePaneConfig = 0
   End
   Begin DiagramPane = 
      Begin Origin = 
         Top = 0
         Left = 0
      End
      Begin Tables = 
         Begin Table = "tblInvoice"
            Begin Extent = 
               Top = 9
               Left = 57
               Bottom = 351
               Right = 285
            End
            DisplayFlags = 280
            TopColumn = 0
         End
         Begin Table = "tblwork"
            Begin Extent = 
               Top = 9
               Left = 342
               Bottom = 206
               Right = 593
            End
            DisplayFlags = 280
            TopColumn = 2
         End
      End
   End
   Begin SQLPane = 
   End
   Begin DataPane = 
      Begin ParameterDefaults = ""
      End
      Begin ColumnWidths = 9
         Width = 284
         Width = 1000
         Width = 1000
         Width = 1000
         Width = 1000
         Width = 1000
         Width = 1000
         Width = 1000
         Width = 1000
      End
   End
   Begin CriteriaPane = 
      Begin ColumnWidths = 11
         Column = 1440
         Alias = 900
         Table = 1170
         Output = 720
         Append = 1400
         NewValue = 1170
         SortType = 1350
         SortOrder = 1410
         GroupBy = 1350
         Filter = 1350
         Or = 1350
         Or = 1350
         Or = 1350
      End
   End
End
' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_InvoicesCurreny'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPaneCount', @value=1 , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_InvoicesCurreny'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'Dr.Shwan_V8.[qrylastvisit]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_lastvisit'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPane1', @value=N'[0E232FF0-B466-11cf-A24F-00AA00A3EFFF, 1.00]
Begin DesignProperties = 
   Begin PaneConfigurations = 
      Begin PaneConfiguration = 0
         NumPanes = 4
         Configuration = "(H (1[40] 4[20] 2[20] 3) )"
      End
      Begin PaneConfiguration = 1
         NumPanes = 3
         Configuration = "(H (1 [50] 4 [25] 3))"
      End
      Begin PaneConfiguration = 2
         NumPanes = 3
         Configuration = "(H (1 [50] 2 [25] 3))"
      End
      Begin PaneConfiguration = 3
         NumPanes = 3
         Configuration = "(H (4 [30] 2 [40] 3))"
      End
      Begin PaneConfiguration = 4
         NumPanes = 2
         Configuration = "(H (1 [56] 3))"
      End
      Begin PaneConfiguration = 5
         NumPanes = 2
         Configuration = "(H (2 [66] 3))"
      End
      Begin PaneConfiguration = 6
         NumPanes = 2
         Configuration = "(H (4 [50] 3))"
      End
      Begin PaneConfiguration = 7
         NumPanes = 1
         Configuration = "(V (3))"
      End
      Begin PaneConfiguration = 8
         NumPanes = 3
         Configuration = "(H (1[56] 4[18] 2) )"
      End
      Begin PaneConfiguration = 9
         NumPanes = 2
         Configuration = "(H (1 [75] 4))"
      End
      Begin PaneConfiguration = 10
         NumPanes = 2
         Configuration = "(H (1[66] 2) )"
      End
      Begin PaneConfiguration = 11
         NumPanes = 2
         Configuration = "(H (4 [60] 2))"
      End
      Begin PaneConfiguration = 12
         NumPanes = 1
         Configuration = "(H (1) )"
      End
      Begin PaneConfiguration = 13
         NumPanes = 1
         Configuration = "(V (4))"
      End
      Begin PaneConfiguration = 14
         NumPanes = 1
         Configuration = "(V (2))"
      End
      ActivePaneConfig = 0
   End
   Begin DiagramPane = 
      Begin Origin = 
         Top = 0
         Left = 0
      End
      Begin Tables = 
         Begin Table = "cte2_1"
            Begin Extent = 
               Top = 6
               Left = 38
               Bottom = 119
               Right = 208
            End
            DisplayFlags = 280
            TopColumn = 0
         End
      End
   End
   Begin SQLPane = 
   End
   Begin DataPane = 
      Begin ParameterDefaults = ""
      End
      Begin ColumnWidths = 9
         Width = 284
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
      End
   End
   Begin CriteriaPane = 
      Begin ColumnWidths = 11
         Column = 1440
         Alias = 900
         Table = 1170
         Output = 720
         Append = 1400
         NewValue = 1170
         SortType = 1350
         SortOrder = 1410
         GroupBy = 1350
         Filter = 1350
         Or = 1350
         Or = 1350
         Or = 1350
      End
   End
End
' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_MissDays'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPaneCount', @value=1 , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_MissDays'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPane1', @value=N'[0E232FF0-B466-11cf-A24F-00AA00A3EFFF, 1.00]
Begin DesignProperties = 
   Begin PaneConfigurations = 
      Begin PaneConfiguration = 0
         NumPanes = 4
         Configuration = "(H (1[41] 4[31] 2[16] 3) )"
      End
      Begin PaneConfiguration = 1
         NumPanes = 3
         Configuration = "(H (1 [50] 4 [25] 3))"
      End
      Begin PaneConfiguration = 2
         NumPanes = 3
         Configuration = "(H (1 [50] 2 [25] 3))"
      End
      Begin PaneConfiguration = 3
         NumPanes = 3
         Configuration = "(H (4 [30] 2 [40] 3))"
      End
      Begin PaneConfiguration = 4
         NumPanes = 2
         Configuration = "(H (1 [56] 3))"
      End
      Begin PaneConfiguration = 5
         NumPanes = 2
         Configuration = "(H (2 [66] 3))"
      End
      Begin PaneConfiguration = 6
         NumPanes = 2
         Configuration = "(H (4 [50] 3))"
      End
      Begin PaneConfiguration = 7
         NumPanes = 1
         Configuration = "(V (3))"
      End
      Begin PaneConfiguration = 8
         NumPanes = 3
         Configuration = "(H (1[56] 4[18] 2) )"
      End
      Begin PaneConfiguration = 9
         NumPanes = 2
         Configuration = "(H (1 [75] 4))"
      End
      Begin PaneConfiguration = 10
         NumPanes = 2
         Configuration = "(H (1[66] 2) )"
      End
      Begin PaneConfiguration = 11
         NumPanes = 2
         Configuration = "(H (4 [60] 2))"
      End
      Begin PaneConfiguration = 12
         NumPanes = 1
         Configuration = "(H (1) )"
      End
      Begin PaneConfiguration = 13
         NumPanes = 1
         Configuration = "(V (4))"
      End
      Begin PaneConfiguration = 14
         NumPanes = 1
         Configuration = "(V (2))"
      End
      ActivePaneConfig = 0
   End
   Begin DiagramPane = 
      Begin Origin = 
         Top = 0
         Left = 0
      End
      Begin Tables = 
         Begin Table = "p"
            Begin Extent = 
               Top = 10
               Left = 67
               Bottom = 240
               Right = 333
            End
            DisplayFlags = 280
            TopColumn = 1
         End
         Begin Table = "a"
            Begin Extent = 
               Top = 10
               Left = 400
               Bottom = 176
               Right = 731
            End
            DisplayFlags = 280
            TopColumn = 0
         End
      End
   End
   Begin SQLPane = 
   End
   Begin DataPane = 
      Begin ParameterDefaults = ""
      End
      Begin ColumnWidths = 9
         Width = 284
         Width = 1526
         Width = 1817
         Width = 857
         Width = 857
         Width = 857
         Width = 857
         Width = 857
         Width = 857
      End
   End
   Begin CriteriaPane = 
      Begin ColumnWidths = 11
         Column = 1440
         Alias = 900
         Table = 1174
         Output = 720
         Append = 1400
         NewValue = 1170
         SortType = 1354
         SortOrder = 1414
         GroupBy = 1350
         Filter = 1354
         Or = 1350
         Or = 1350
         Or = 1350
      End
   End
End
' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_Missing_Patients'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPaneCount', @value=1 , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_Missing_Patients'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPane1', @value=N'[0E232FF0-B466-11cf-A24F-00AA00A3EFFF, 1.00]
Begin DesignProperties = 
   Begin PaneConfigurations = 
      Begin PaneConfiguration = 0
         NumPanes = 4
         Configuration = "(H (1[19] 4[31] 2[31] 3) )"
      End
      Begin PaneConfiguration = 1
         NumPanes = 3
         Configuration = "(H (1 [50] 4 [25] 3))"
      End
      Begin PaneConfiguration = 2
         NumPanes = 3
         Configuration = "(H (1 [50] 2 [25] 3))"
      End
      Begin PaneConfiguration = 3
         NumPanes = 3
         Configuration = "(H (4 [30] 2 [40] 3))"
      End
      Begin PaneConfiguration = 4
         NumPanes = 2
         Configuration = "(H (1 [56] 3))"
      End
      Begin PaneConfiguration = 5
         NumPanes = 2
         Configuration = "(H (2 [66] 3))"
      End
      Begin PaneConfiguration = 6
         NumPanes = 2
         Configuration = "(H (4 [50] 3))"
      End
      Begin PaneConfiguration = 7
         NumPanes = 1
         Configuration = "(V (3))"
      End
      Begin PaneConfiguration = 8
         NumPanes = 3
         Configuration = "(H (1[56] 4[18] 2) )"
      End
      Begin PaneConfiguration = 9
         NumPanes = 2
         Configuration = "(H (1 [75] 4))"
      End
      Begin PaneConfiguration = 10
         NumPanes = 2
         Configuration = "(H (1[66] 2) )"
      End
      Begin PaneConfiguration = 11
         NumPanes = 2
         Configuration = "(H (4 [60] 2))"
      End
      Begin PaneConfiguration = 12
         NumPanes = 1
         Configuration = "(H (1) )"
      End
      Begin PaneConfiguration = 13
         NumPanes = 1
         Configuration = "(V (4))"
      End
      Begin PaneConfiguration = 14
         NumPanes = 1
         Configuration = "(V (2))"
      End
      ActivePaneConfig = 0
   End
   Begin DiagramPane = 
      Begin Origin = 
         Top = 0
         Left = 0
      End
      Begin Tables = 
         Begin Table = "tblappointments"
            Begin Extent = 
               Top = 15
               Left = 96
               Bottom = 324
               Right = 467
            End
            DisplayFlags = 280
            TopColumn = 0
         End
         Begin Table = "tblpatients"
            Begin Extent = 
               Top = 15
               Left = 563
               Bottom = 324
               Right = 915
            End
            DisplayFlags = 280
            TopColumn = 0
         End
         Begin Table = "tblPatientType"
            Begin Extent = 
               Top = 15
               Left = 1011
               Bottom = 238
               Right = 1339
            End
            DisplayFlags = 280
            TopColumn = 0
         End
      End
   End
   Begin SQLPane = 
   End
   Begin DataPane = 
      Begin ParameterDefaults = ""
      End
      Begin ColumnWidths = 9
         Width = 284
         Width = 600
         Width = 600
         Width = 600
         Width = 600
         Width = 600
         Width = 600
         Width = 600
         Width = 600
      End
   End
   Begin CriteriaPane = 
      Begin ColumnWidths = 11
         Column = 1440
         Alias = 900
         Table = 1170
         Output = 720
         Append = 1400
         NewValue = 1170
         SortType = 1350
         SortOrder = 1410
         GroupBy = 1350
         Filter = 1350
         Or = 1350
         Or = 1350
         Or = 1350
      End
   End
End
' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_PresentTodayApps'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPaneCount', @value=1 , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_PresentTodayApps'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPane1', @value=N'[0E232FF0-B466-11cf-A24F-00AA00A3EFFF, 1.00]
Begin DesignProperties = 
   Begin PaneConfigurations = 
      Begin PaneConfiguration = 0
         NumPanes = 4
         Configuration = "(H (1[41] 4[25] 2[15] 3) )"
      End
      Begin PaneConfiguration = 1
         NumPanes = 3
         Configuration = "(H (1 [50] 4 [25] 3))"
      End
      Begin PaneConfiguration = 2
         NumPanes = 3
         Configuration = "(H (1 [50] 2 [25] 3))"
      End
      Begin PaneConfiguration = 3
         NumPanes = 3
         Configuration = "(H (4 [30] 2 [40] 3))"
      End
      Begin PaneConfiguration = 4
         NumPanes = 2
         Configuration = "(H (1 [56] 3))"
      End
      Begin PaneConfiguration = 5
         NumPanes = 2
         Configuration = "(H (2 [66] 3))"
      End
      Begin PaneConfiguration = 6
         NumPanes = 2
         Configuration = "(H (4 [50] 3))"
      End
      Begin PaneConfiguration = 7
         NumPanes = 1
         Configuration = "(V (3))"
      End
      Begin PaneConfiguration = 8
         NumPanes = 3
         Configuration = "(H (1[56] 4[18] 2) )"
      End
      Begin PaneConfiguration = 9
         NumPanes = 2
         Configuration = "(H (1 [75] 4))"
      End
      Begin PaneConfiguration = 10
         NumPanes = 2
         Configuration = "(H (1[66] 2) )"
      End
      Begin PaneConfiguration = 11
         NumPanes = 2
         Configuration = "(H (4 [60] 2))"
      End
      Begin PaneConfiguration = 12
         NumPanes = 1
         Configuration = "(H (1) )"
      End
      Begin PaneConfiguration = 13
         NumPanes = 1
         Configuration = "(V (4))"
      End
      Begin PaneConfiguration = 14
         NumPanes = 1
         Configuration = "(V (2))"
      End
      ActivePaneConfig = 0
   End
   Begin DiagramPane = 
      Begin Origin = 
         Top = 0
         Left = 0
      End
      Begin Tables = 
         Begin Table = "V_TodayPayment"
            Begin Extent = 
               Top = 112
               Left = 704
               Bottom = 225
               Right = 874
            End
            DisplayFlags = 280
            TopColumn = 0
         End
         Begin Table = "VTotPaid"
            Begin Extent = 
               Top = 0
               Left = 576
               Bottom = 96
               Right = 746
            End
            DisplayFlags = 280
            TopColumn = 0
         End
         Begin Table = "tblpatients"
            Begin Extent = 
               Top = 163
               Left = 477
               Bottom = 293
               Right = 647
            End
            DisplayFlags = 280
            TopColumn = 0
         End
         Begin Table = "VLastApp"
            Begin Extent = 
               Top = 165
               Left = 57
               Bottom = 286
               Right = 227
            End
            DisplayFlags = 280
            TopColumn = 0
         End
         Begin Table = "V_ActiveWork"
            Begin Extent = 
               Top = 6
               Left = 38
               Bottom = 136
               Right = 208
            End
            DisplayFlags = 280
            TopColumn = 0
         End
      End
   End
   Begin SQLPane = 
   End
   Begin DataPane = 
      Begin ParameterDefaults = ""
      End
      Begin ColumnWidths = 15
         Width = 284
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 150' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_Report'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPane2', @value=N'0
         Width = 1500
      End
   End
   Begin CriteriaPane = 
      Begin ColumnWidths = 11
         Column = 2295
         Alias = 900
         Table = 1170
         Output = 720
         Append = 1400
         NewValue = 1170
         SortType = 1350
         SortOrder = 1410
         GroupBy = 1350
         Filter = 1350
         Or = 1350
         Or = 1350
         Or = 1350
      End
   End
End
' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_Report'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPaneCount', @value=N'2' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_Report'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPane1', @value=N'[0E232FF0-B466-11cf-A24F-00AA00A3EFFF, 1.00]
Begin DesignProperties = 
   Begin PaneConfigurations = 
      Begin PaneConfiguration = 0
         NumPanes = 4
         Configuration = "(H (1[40] 4[20] 2[20] 3) )"
      End
      Begin PaneConfiguration = 1
         NumPanes = 3
         Configuration = "(H (1 [50] 4 [25] 3))"
      End
      Begin PaneConfiguration = 2
         NumPanes = 3
         Configuration = "(H (1 [50] 2 [25] 3))"
      End
      Begin PaneConfiguration = 3
         NumPanes = 3
         Configuration = "(H (4 [30] 2 [40] 3))"
      End
      Begin PaneConfiguration = 4
         NumPanes = 2
         Configuration = "(H (1 [56] 3))"
      End
      Begin PaneConfiguration = 5
         NumPanes = 2
         Configuration = "(H (2 [66] 3))"
      End
      Begin PaneConfiguration = 6
         NumPanes = 2
         Configuration = "(H (4 [50] 3))"
      End
      Begin PaneConfiguration = 7
         NumPanes = 1
         Configuration = "(V (3))"
      End
      Begin PaneConfiguration = 8
         NumPanes = 3
         Configuration = "(H (1[56] 4[18] 2) )"
      End
      Begin PaneConfiguration = 9
         NumPanes = 2
         Configuration = "(H (1 [75] 4))"
      End
      Begin PaneConfiguration = 10
         NumPanes = 2
         Configuration = "(H (1[66] 2) )"
      End
      Begin PaneConfiguration = 11
         NumPanes = 2
         Configuration = "(H (4 [60] 2))"
      End
      Begin PaneConfiguration = 12
         NumPanes = 1
         Configuration = "(H (1) )"
      End
      Begin PaneConfiguration = 13
         NumPanes = 1
         Configuration = "(V (4))"
      End
      Begin PaneConfiguration = 14
         NumPanes = 1
         Configuration = "(V (2))"
      End
      ActivePaneConfig = 0
   End
   Begin DiagramPane = 
      Begin Origin = 
         Top = 0
         Left = 0
      End
      Begin Tables = 
         Begin Table = "VLastApp"
            Begin Extent = 
               Top = 261
               Left = 1094
               Bottom = 527
               Right = 1426
            End
            DisplayFlags = 280
            TopColumn = 0
         End
         Begin Table = "tblpatients"
            Begin Extent = 
               Top = 307
               Left = 87
               Bottom = 616
               Right = 439
            End
            DisplayFlags = 280
            TopColumn = 0
         End
      End
   End
   Begin SQLPane = 
   End
   Begin DataPane = 
      Begin ParameterDefaults = ""
      End
      Begin ColumnWidths = 9
         Width = 284
         Width = 600
         Width = 600
         Width = 600
         Width = 600
         Width = 600
         Width = 600
         Width = 600
         Width = 600
      End
   End
   Begin CriteriaPane = 
      Begin ColumnWidths = 11
         Column = 1440
         Alias = 900
         Table = 1170
         Output = 720
         Append = 1400
         NewValue = 1170
         SortType = 1350
         SortOrder = 1410
         GroupBy = 1350
         Filter = 1350
         Or = 1350
         Or = 1350
         Or = 1350
      End
   End
End
' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_rptNoWork'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPaneCount', @value=1 , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_rptNoWork'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPane1', @value=N'[0E232FF0-B466-11cf-A24F-00AA00A3EFFF, 1.00]
Begin DesignProperties = 
   Begin PaneConfigurations = 
      Begin PaneConfiguration = 0
         NumPanes = 4
         Configuration = "(H (1[52] 4[2] 2[30] 3) )"
      End
      Begin PaneConfiguration = 1
         NumPanes = 3
         Configuration = "(H (1 [50] 4 [25] 3))"
      End
      Begin PaneConfiguration = 2
         NumPanes = 3
         Configuration = "(H (1 [50] 2 [25] 3))"
      End
      Begin PaneConfiguration = 3
         NumPanes = 3
         Configuration = "(H (4 [30] 2 [40] 3))"
      End
      Begin PaneConfiguration = 4
         NumPanes = 2
         Configuration = "(H (1 [56] 3))"
      End
      Begin PaneConfiguration = 5
         NumPanes = 2
         Configuration = "(H (2 [66] 3))"
      End
      Begin PaneConfiguration = 6
         NumPanes = 2
         Configuration = "(H (4 [50] 3))"
      End
      Begin PaneConfiguration = 7
         NumPanes = 1
         Configuration = "(V (3))"
      End
      Begin PaneConfiguration = 8
         NumPanes = 3
         Configuration = "(H (1[56] 4[18] 2) )"
      End
      Begin PaneConfiguration = 9
         NumPanes = 2
         Configuration = "(H (1 [75] 4))"
      End
      Begin PaneConfiguration = 10
         NumPanes = 2
         Configuration = "(H (1[66] 2) )"
      End
      Begin PaneConfiguration = 11
         NumPanes = 2
         Configuration = "(H (4 [60] 2))"
      End
      Begin PaneConfiguration = 12
         NumPanes = 1
         Configuration = "(H (1) )"
      End
      Begin PaneConfiguration = 13
         NumPanes = 1
         Configuration = "(V (4))"
      End
      Begin PaneConfiguration = 14
         NumPanes = 1
         Configuration = "(V (2))"
      End
      ActivePaneConfig = 0
   End
   Begin DiagramPane = 
      Begin Origin = 
         Top = 0
         Left = 0
      End
      Begin Tables = 
         Begin Table = "V_WorkCounts"
            Begin Extent = 
               Top = 287
               Left = 1756
               Bottom = 510
               Right = 2084
            End
            DisplayFlags = 280
            TopColumn = 0
         End
         Begin Table = "tblpatients"
            Begin Extent = 
               Top = 262
               Left = 875
               Bottom = 571
               Right = 1227
            End
            DisplayFlags = 280
            TopColumn = 10
         End
         Begin Table = "VTotPaid"
            Begin Extent = 
               Top = 42
               Left = 422
               Bottom = 308
               Right = 777
            End
            DisplayFlags = 280
            TopColumn = 0
         End
         Begin Table = "V_ActiveWork"
            Begin Extent = 
               Top = 259
               Left = 72
               Bottom = 647
               Right = 592
            End
            DisplayFlags = 280
            TopColumn = 0
         End
         Begin Table = "VLastApp"
            Begin Extent = 
               Top = 1030
               Left = 1177
               Bottom = 1296
               Right = 1509
            End
            DisplayFlags = 280
            TopColumn = 0
         End
      End
   End
   Begin SQLPane = 
   End
   Begin DataPane = 
      Begin ParameterDefaults = ""
      End
      Begin ColumnWidths = 23
         Width = 284
         Width = 600
         Width = 600
         Width = 1963
         Width = 600
         Width = 600
         Width = 600
         Width = 600
         Width = 600
         Width = 1200
         Width = 1200
         Width = 1200
         Width = 1200
         Width = ' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_Spatient'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPane2', @value=N'1200
         Width = 1200
         Width = 1200
         Width = 1200
         Width = 1200
         Width = 1200
         Width = 1200
         Width = 1200
         Width = 1200
         Width = 1200
      End
   End
   Begin CriteriaPane = 
      Begin ColumnWidths = 11
         Column = 1440
         Alias = 900
         Table = 1183
         Output = 720
         Append = 1400
         NewValue = 1170
         SortType = 1363
         SortOrder = 1423
         GroupBy = 1350
         Filter = 1363
         Or = 1350
         Or = 1350
         Or = 1350
      End
   End
End
' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_Spatient'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPaneCount', @value=2 , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_Spatient'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPane1', @value=N'[0E232FF0-B466-11cf-A24F-00AA00A3EFFF, 1.00]
Begin DesignProperties = 
   Begin PaneConfigurations = 
      Begin PaneConfiguration = 0
         NumPanes = 4
         Configuration = "(H (1[40] 4[20] 2[20] 3) )"
      End
      Begin PaneConfiguration = 1
         NumPanes = 3
         Configuration = "(H (1 [50] 4 [25] 3))"
      End
      Begin PaneConfiguration = 2
         NumPanes = 3
         Configuration = "(H (1 [50] 2 [25] 3))"
      End
      Begin PaneConfiguration = 3
         NumPanes = 3
         Configuration = "(H (4 [30] 2 [40] 3))"
      End
      Begin PaneConfiguration = 4
         NumPanes = 2
         Configuration = "(H (1 [56] 3))"
      End
      Begin PaneConfiguration = 5
         NumPanes = 2
         Configuration = "(H (2 [66] 3))"
      End
      Begin PaneConfiguration = 6
         NumPanes = 2
         Configuration = "(H (4 [50] 3))"
      End
      Begin PaneConfiguration = 7
         NumPanes = 1
         Configuration = "(V (3))"
      End
      Begin PaneConfiguration = 8
         NumPanes = 3
         Configuration = "(H (1[56] 4[18] 2) )"
      End
      Begin PaneConfiguration = 9
         NumPanes = 2
         Configuration = "(H (1 [75] 4))"
      End
      Begin PaneConfiguration = 10
         NumPanes = 2
         Configuration = "(H (1[66] 2) )"
      End
      Begin PaneConfiguration = 11
         NumPanes = 2
         Configuration = "(H (4 [60] 2))"
      End
      Begin PaneConfiguration = 12
         NumPanes = 1
         Configuration = "(H (1) )"
      End
      Begin PaneConfiguration = 13
         NumPanes = 1
         Configuration = "(V (4))"
      End
      Begin PaneConfiguration = 14
         NumPanes = 1
         Configuration = "(V (2))"
      End
      ActivePaneConfig = 0
   End
   Begin DiagramPane = 
      Begin Origin = 
         Top = 0
         Left = 0
      End
      Begin Tables = 
         Begin Table = "i"
            Begin Extent = 
               Top = 56
               Left = 37
               Bottom = 442
               Right = 276
            End
            DisplayFlags = 280
            TopColumn = 0
         End
         Begin Table = "w"
            Begin Extent = 
               Top = 9
               Left = 333
               Bottom = 152
               Right = 555
            End
            DisplayFlags = 280
            TopColumn = 0
         End
      End
   End
   Begin SQLPane = 
   End
   Begin DataPane = 
      Begin ParameterDefaults = ""
      End
      Begin ColumnWidths = 9
         Width = 284
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
      End
   End
   Begin CriteriaPane = 
      Begin ColumnWidths = 11
         Column = 1440
         Alias = 900
         Table = 1170
         Output = 720
         Append = 1400
         NewValue = 1170
         SortType = 1350
         SortOrder = 1410
         GroupBy = 1350
         Filter = 1350
         Or = 1350
         Or = 1350
         Or = 1350
      End
   End
End
' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_TodayPayment'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPaneCount', @value=1 , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_TodayPayment'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPane1', @value=N'[0E232FF0-B466-11cf-A24F-00AA00A3EFFF, 1.00]
Begin DesignProperties = 
   Begin PaneConfigurations = 
      Begin PaneConfiguration = 0
         NumPanes = 4
         Configuration = "(H (1[40] 4[20] 2[20] 3) )"
      End
      Begin PaneConfiguration = 1
         NumPanes = 3
         Configuration = "(H (1 [50] 4 [25] 3))"
      End
      Begin PaneConfiguration = 2
         NumPanes = 3
         Configuration = "(H (1 [50] 2 [25] 3))"
      End
      Begin PaneConfiguration = 3
         NumPanes = 3
         Configuration = "(H (4 [30] 2 [40] 3))"
      End
      Begin PaneConfiguration = 4
         NumPanes = 2
         Configuration = "(H (1 [56] 3))"
      End
      Begin PaneConfiguration = 5
         NumPanes = 2
         Configuration = "(H (2 [66] 3))"
      End
      Begin PaneConfiguration = 6
         NumPanes = 2
         Configuration = "(H (4 [50] 3))"
      End
      Begin PaneConfiguration = 7
         NumPanes = 1
         Configuration = "(V (3))"
      End
      Begin PaneConfiguration = 8
         NumPanes = 3
         Configuration = "(H (1[56] 4[18] 2) )"
      End
      Begin PaneConfiguration = 9
         NumPanes = 2
         Configuration = "(H (1 [75] 4))"
      End
      Begin PaneConfiguration = 10
         NumPanes = 2
         Configuration = "(H (1[66] 2) )"
      End
      Begin PaneConfiguration = 11
         NumPanes = 2
         Configuration = "(H (4 [60] 2))"
      End
      Begin PaneConfiguration = 12
         NumPanes = 1
         Configuration = "(H (1) )"
      End
      Begin PaneConfiguration = 13
         NumPanes = 1
         Configuration = "(V (4))"
      End
      Begin PaneConfiguration = 14
         NumPanes = 1
         Configuration = "(V (2))"
      End
      ActivePaneConfig = 0
   End
   Begin DiagramPane = 
      Begin Origin = 
         Top = 0
         Left = 0
      End
      Begin Tables = 
         Begin Table = "tblvideos"
            Begin Extent = 
               Top = 6
               Left = 38
               Bottom = 156
               Right = 225
            End
            DisplayFlags = 280
            TopColumn = 0
         End
         Begin Table = "CTE_1"
            Begin Extent = 
               Top = 6
               Left = 249
               Bottom = 371
               Right = 777
            End
            DisplayFlags = 280
            TopColumn = 0
         End
      End
   End
   Begin SQLPane = 
   End
   Begin DataPane = 
      Begin ParameterDefaults = ""
      End
      Begin ColumnWidths = 9
         Width = 284
         Width = 1560
         Width = 2568
         Width = 4800
         Width = 4224
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
      End
   End
   Begin CriteriaPane = 
      Begin ColumnWidths = 11
         Column = 5364
         Alias = 900
         Table = 1176
         Output = 720
         Append = 1400
         NewValue = 1170
         SortType = 1356
         SortOrder = 1416
         GroupBy = 1350
         Filter = 1356
         Or = 1350
         Or = 1350
         Or = 1350
      End
   End
End
' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_Videos'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPaneCount', @value=1 , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_Videos'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPane1', @value=N'[0E232FF0-B466-11cf-A24F-00AA00A3EFFF, 1.00]
Begin DesignProperties = 
   Begin PaneConfigurations = 
      Begin PaneConfiguration = 0
         NumPanes = 4
         Configuration = "(H (1[40] 4[20] 2[20] 3) )"
      End
      Begin PaneConfiguration = 1
         NumPanes = 3
         Configuration = "(H (1 [50] 4 [25] 3))"
      End
      Begin PaneConfiguration = 2
         NumPanes = 3
         Configuration = "(H (1 [50] 2 [25] 3))"
      End
      Begin PaneConfiguration = 3
         NumPanes = 3
         Configuration = "(H (4 [30] 2 [40] 3))"
      End
      Begin PaneConfiguration = 4
         NumPanes = 2
         Configuration = "(H (1 [56] 3))"
      End
      Begin PaneConfiguration = 5
         NumPanes = 2
         Configuration = "(H (2 [66] 3))"
      End
      Begin PaneConfiguration = 6
         NumPanes = 2
         Configuration = "(H (4 [50] 3))"
      End
      Begin PaneConfiguration = 7
         NumPanes = 1
         Configuration = "(V (3))"
      End
      Begin PaneConfiguration = 8
         NumPanes = 3
         Configuration = "(H (1[56] 4[18] 2) )"
      End
      Begin PaneConfiguration = 9
         NumPanes = 2
         Configuration = "(H (1 [75] 4))"
      End
      Begin PaneConfiguration = 10
         NumPanes = 2
         Configuration = "(H (1[66] 2) )"
      End
      Begin PaneConfiguration = 11
         NumPanes = 2
         Configuration = "(H (4 [60] 2))"
      End
      Begin PaneConfiguration = 12
         NumPanes = 1
         Configuration = "(H (1) )"
      End
      Begin PaneConfiguration = 13
         NumPanes = 1
         Configuration = "(V (4))"
      End
      Begin PaneConfiguration = 14
         NumPanes = 1
         Configuration = "(V (2))"
      End
      ActivePaneConfig = 0
   End
   Begin DiagramPane = 
      Begin Origin = 
         Top = 0
         Left = 0
      End
      Begin Tables = 
         Begin Table = "tblWaiting"
            Begin Extent = 
               Top = 6
               Left = 38
               Bottom = 136
               Right = 208
            End
            DisplayFlags = 280
            TopColumn = 0
         End
         Begin Table = "tblpatients"
            Begin Extent = 
               Top = 26
               Left = 392
               Bottom = 156
               Right = 568
            End
            DisplayFlags = 280
            TopColumn = 0
         End
      End
   End
   Begin SQLPane = 
   End
   Begin DataPane = 
      Begin ParameterDefaults = ""
      End
   End
   Begin CriteriaPane = 
      Begin ColumnWidths = 11
         Column = 1440
         Alias = 900
         Table = 1170
         Output = 720
         Append = 1400
         NewValue = 1170
         SortType = 1350
         SortOrder = 1410
         GroupBy = 1350
         Filter = 1350
         Or = 1350
         Or = 1350
         Or = 1350
      End
   End
End
' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_Waiting'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPaneCount', @value=N'1' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_Waiting'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPane1', @value=N'[0E232FF0-B466-11cf-A24F-00AA00A3EFFF, 1.00]
Begin DesignProperties = 
   Begin PaneConfigurations = 
      Begin PaneConfiguration = 0
         NumPanes = 4
         Configuration = "(H (1[40] 4[20] 2[20] 3) )"
      End
      Begin PaneConfiguration = 1
         NumPanes = 3
         Configuration = "(H (1 [50] 4 [25] 3))"
      End
      Begin PaneConfiguration = 2
         NumPanes = 3
         Configuration = "(H (1 [50] 2 [25] 3))"
      End
      Begin PaneConfiguration = 3
         NumPanes = 3
         Configuration = "(H (4 [30] 2 [40] 3))"
      End
      Begin PaneConfiguration = 4
         NumPanes = 2
         Configuration = "(H (1 [56] 3))"
      End
      Begin PaneConfiguration = 5
         NumPanes = 2
         Configuration = "(H (2 [66] 3))"
      End
      Begin PaneConfiguration = 6
         NumPanes = 2
         Configuration = "(H (4 [50] 3))"
      End
      Begin PaneConfiguration = 7
         NumPanes = 1
         Configuration = "(V (3))"
      End
      Begin PaneConfiguration = 8
         NumPanes = 3
         Configuration = "(H (1[56] 4[18] 2) )"
      End
      Begin PaneConfiguration = 9
         NumPanes = 2
         Configuration = "(H (1 [75] 4))"
      End
      Begin PaneConfiguration = 10
         NumPanes = 2
         Configuration = "(H (1[66] 2) )"
      End
      Begin PaneConfiguration = 11
         NumPanes = 2
         Configuration = "(H (4 [60] 2))"
      End
      Begin PaneConfiguration = 12
         NumPanes = 1
         Configuration = "(H (1) )"
      End
      Begin PaneConfiguration = 13
         NumPanes = 1
         Configuration = "(V (4))"
      End
      Begin PaneConfiguration = 14
         NumPanes = 1
         Configuration = "(V (2))"
      End
      ActivePaneConfig = 0
   End
   Begin DiagramPane = 
      Begin Origin = 
         Top = 0
         Left = 0
      End
      Begin Tables = 
         Begin Table = "tblwork"
            Begin Extent = 
               Top = 29
               Left = 273
               Bottom = 250
               Right = 467
            End
            DisplayFlags = 280
            TopColumn = 7
         End
         Begin Table = "tblpatients"
            Begin Extent = 
               Top = 46
               Left = 14
               Bottom = 176
               Right = 184
            End
            DisplayFlags = 280
            TopColumn = 0
         End
      End
   End
   Begin SQLPane = 
   End
   Begin DataPane = 
      Begin ParameterDefaults = ""
      End
      Begin ColumnWidths = 9
         Width = 284
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
      End
   End
   Begin CriteriaPane = 
      Begin ColumnWidths = 11
         Column = 1440
         Alias = 900
         Table = 1170
         Output = 720
         Append = 1400
         NewValue = 1170
         SortType = 1350
         SortOrder = 1410
         GroupBy = 1350
         Filter = 1350
         Or = 1350
         Or = 1350
         Or = 1350
      End
   End
End
' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_Work_Names'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPaneCount', @value=N'1' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_Work_Names'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPane1', @value=N'[0E232FF0-B466-11cf-A24F-00AA00A3EFFF, 1.00]
Begin DesignProperties = 
   Begin PaneConfigurations = 
      Begin PaneConfiguration = 0
         NumPanes = 4
         Configuration = "(H (1[47] 4[15] 2[22] 3) )"
      End
      Begin PaneConfiguration = 1
         NumPanes = 3
         Configuration = "(H (1 [50] 4 [25] 3))"
      End
      Begin PaneConfiguration = 2
         NumPanes = 3
         Configuration = "(H (1 [50] 2 [25] 3))"
      End
      Begin PaneConfiguration = 3
         NumPanes = 3
         Configuration = "(H (4 [30] 2 [40] 3))"
      End
      Begin PaneConfiguration = 4
         NumPanes = 2
         Configuration = "(H (1 [56] 3))"
      End
      Begin PaneConfiguration = 5
         NumPanes = 2
         Configuration = "(H (2 [66] 3))"
      End
      Begin PaneConfiguration = 6
         NumPanes = 2
         Configuration = "(H (4 [50] 3))"
      End
      Begin PaneConfiguration = 7
         NumPanes = 1
         Configuration = "(V (3))"
      End
      Begin PaneConfiguration = 8
         NumPanes = 3
         Configuration = "(H (1[56] 4[18] 2) )"
      End
      Begin PaneConfiguration = 9
         NumPanes = 2
         Configuration = "(H (1 [75] 4))"
      End
      Begin PaneConfiguration = 10
         NumPanes = 2
         Configuration = "(H (1[66] 2) )"
      End
      Begin PaneConfiguration = 11
         NumPanes = 2
         Configuration = "(H (4 [60] 2))"
      End
      Begin PaneConfiguration = 12
         NumPanes = 1
         Configuration = "(H (1) )"
      End
      Begin PaneConfiguration = 13
         NumPanes = 1
         Configuration = "(V (4))"
      End
      Begin PaneConfiguration = 14
         NumPanes = 1
         Configuration = "(V (2))"
      End
      ActivePaneConfig = 0
   End
   Begin DiagramPane = 
      Begin Origin = 
         Top = 0
         Left = 0
      End
      Begin Tables = 
         Begin Table = "tblwork"
            Begin Extent = 
               Top = 6
               Left = 38
               Bottom = 136
               Right = 225
            End
            DisplayFlags = 280
            TopColumn = 6
         End
         Begin Table = "tblvisits"
            Begin Extent = 
               Top = 41
               Left = 272
               Bottom = 255
               Right = 485
            End
            DisplayFlags = 280
            TopColumn = 0
         End
         Begin Table = "tblpatients"
            Begin Extent = 
               Top = 24
               Left = 548
               Bottom = 154
               Right = 735
            End
            DisplayFlags = 280
            TopColumn = 0
         End
      End
   End
   Begin SQLPane = 
   End
   Begin DataPane = 
      Begin ParameterDefaults = ""
      End
      Begin ColumnWidths = 9
         Width = 284
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
      End
   End
   Begin CriteriaPane = 
      Begin ColumnWidths = 11
         Column = 4668
         Alias = 1260
         Table = 1170
         Output = 720
         Append = 1400
         NewValue = 1170
         SortType = 1350
         SortOrder = 1410
         GroupBy = 1350
         Filter = 3390
         Or = 1350
         Or = 1350
         Or = 1350
      End
   End
End
' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_Work_Visits'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPaneCount', @value=1 , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_Work_Visits'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPane1', @value=N'[0E232FF0-B466-11cf-A24F-00AA00A3EFFF, 1.00]
Begin DesignProperties = 
   Begin PaneConfigurations = 
      Begin PaneConfiguration = 0
         NumPanes = 4
         Configuration = "(H (1[40] 4[20] 2[20] 3) )"
      End
      Begin PaneConfiguration = 1
         NumPanes = 3
         Configuration = "(H (1 [50] 4 [25] 3))"
      End
      Begin PaneConfiguration = 2
         NumPanes = 3
         Configuration = "(H (1 [50] 2 [25] 3))"
      End
      Begin PaneConfiguration = 3
         NumPanes = 3
         Configuration = "(H (4 [30] 2 [40] 3))"
      End
      Begin PaneConfiguration = 4
         NumPanes = 2
         Configuration = "(H (1 [56] 3))"
      End
      Begin PaneConfiguration = 5
         NumPanes = 2
         Configuration = "(H (2 [66] 3))"
      End
      Begin PaneConfiguration = 6
         NumPanes = 2
         Configuration = "(H (4 [50] 3))"
      End
      Begin PaneConfiguration = 7
         NumPanes = 1
         Configuration = "(V (3))"
      End
      Begin PaneConfiguration = 8
         NumPanes = 3
         Configuration = "(H (1[56] 4[18] 2) )"
      End
      Begin PaneConfiguration = 9
         NumPanes = 2
         Configuration = "(H (1 [75] 4))"
      End
      Begin PaneConfiguration = 10
         NumPanes = 2
         Configuration = "(H (1[66] 2) )"
      End
      Begin PaneConfiguration = 11
         NumPanes = 2
         Configuration = "(H (4 [60] 2))"
      End
      Begin PaneConfiguration = 12
         NumPanes = 1
         Configuration = "(H (1) )"
      End
      Begin PaneConfiguration = 13
         NumPanes = 1
         Configuration = "(V (4))"
      End
      Begin PaneConfiguration = 14
         NumPanes = 1
         Configuration = "(V (2))"
      End
      ActivePaneConfig = 0
   End
   Begin DiagramPane = 
      Begin Origin = 
         Top = 0
         Left = 0
      End
      Begin Tables = 
         Begin Table = "tblwork"
            Begin Extent = 
               Top = 15
               Left = 96
               Bottom = 324
               Right = 488
            End
            DisplayFlags = 280
            TopColumn = 0
         End
      End
   End
   Begin SQLPane = 
   End
   Begin DataPane = 
      Begin ParameterDefaults = ""
      End
      Begin ColumnWidths = 9
         Width = 284
         Width = 600
         Width = 600
         Width = 600
         Width = 600
         Width = 600
         Width = 600
         Width = 600
         Width = 600
      End
   End
   Begin CriteriaPane = 
      Begin ColumnWidths = 12
         Column = 1440
         Alias = 900
         Table = 1170
         Output = 720
         Append = 1400
         NewValue = 1170
         SortType = 1350
         SortOrder = 1410
         GroupBy = 1350
         Filter = 1350
         Or = 1350
         Or = 1350
         Or = 1350
      End
   End
End
' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_WorkCounts'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPaneCount', @value=1 , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_WorkCounts'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPane1', @value=N'[0E232FF0-B466-11cf-A24F-00AA00A3EFFF, 1.00]
Begin DesignProperties = 
   Begin PaneConfigurations = 
      Begin PaneConfiguration = 0
         NumPanes = 4
         Configuration = "(H (1[40] 4[20] 2[20] 3) )"
      End
      Begin PaneConfiguration = 1
         NumPanes = 3
         Configuration = "(H (1 [50] 4 [25] 3))"
      End
      Begin PaneConfiguration = 2
         NumPanes = 3
         Configuration = "(H (1 [50] 2 [25] 3))"
      End
      Begin PaneConfiguration = 3
         NumPanes = 3
         Configuration = "(H (4 [30] 2 [40] 3))"
      End
      Begin PaneConfiguration = 4
         NumPanes = 2
         Configuration = "(H (1 [56] 3))"
      End
      Begin PaneConfiguration = 5
         NumPanes = 2
         Configuration = "(H (2 [66] 3))"
      End
      Begin PaneConfiguration = 6
         NumPanes = 2
         Configuration = "(H (4 [50] 3))"
      End
      Begin PaneConfiguration = 7
         NumPanes = 1
         Configuration = "(V (3))"
      End
      Begin PaneConfiguration = 8
         NumPanes = 3
         Configuration = "(H (1[56] 4[18] 2) )"
      End
      Begin PaneConfiguration = 9
         NumPanes = 2
         Configuration = "(H (1 [75] 4))"
      End
      Begin PaneConfiguration = 10
         NumPanes = 2
         Configuration = "(H (1[66] 2) )"
      End
      Begin PaneConfiguration = 11
         NumPanes = 2
         Configuration = "(H (4 [60] 2))"
      End
      Begin PaneConfiguration = 12
         NumPanes = 1
         Configuration = "(H (1) )"
      End
      Begin PaneConfiguration = 13
         NumPanes = 1
         Configuration = "(V (4))"
      End
      Begin PaneConfiguration = 14
         NumPanes = 1
         Configuration = "(V (2))"
      End
      ActivePaneConfig = 0
   End
   Begin DiagramPane = 
      Begin Origin = 
         Top = 0
         Left = 0
      End
      Begin Tables = 
         Begin Table = "tblwork"
            Begin Extent = 
               Top = 6
               Left = 38
               Bottom = 136
               Right = 225
            End
            DisplayFlags = 280
            TopColumn = 12
         End
         Begin Table = "tblpatients"
            Begin Extent = 
               Top = 6
               Left = 263
               Bottom = 136
               Right = 450
            End
            DisplayFlags = 280
            TopColumn = 0
         End
      End
   End
   Begin SQLPane = 
   End
   Begin DataPane = 
      Begin ParameterDefaults = ""
      End
   End
   Begin CriteriaPane = 
      Begin ColumnWidths = 11
         Column = 1440
         Alias = 900
         Table = 1170
         Output = 720
         Append = 1400
         NewValue = 1170
         SortType = 1350
         SortOrder = 1410
         GroupBy = 1350
         Filter = 1350
         Or = 1350
         Or = 1350
         Or = 1350
      End
   End
End
' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_WorkKW'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPaneCount', @value=1 , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_WorkKW'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPane1', @value=N'[0E232FF0-B466-11cf-A24F-00AA00A3EFFF, 1.00]
Begin DesignProperties = 
   Begin PaneConfigurations = 
      Begin PaneConfiguration = 0
         NumPanes = 4
         Configuration = "(H (1[40] 4[28] 2[12] 3) )"
      End
      Begin PaneConfiguration = 1
         NumPanes = 3
         Configuration = "(H (1 [50] 4 [25] 3))"
      End
      Begin PaneConfiguration = 2
         NumPanes = 3
         Configuration = "(H (1 [50] 2 [25] 3))"
      End
      Begin PaneConfiguration = 3
         NumPanes = 3
         Configuration = "(H (4 [30] 2 [40] 3))"
      End
      Begin PaneConfiguration = 4
         NumPanes = 2
         Configuration = "(H (1 [56] 3))"
      End
      Begin PaneConfiguration = 5
         NumPanes = 2
         Configuration = "(H (2 [66] 3))"
      End
      Begin PaneConfiguration = 6
         NumPanes = 2
         Configuration = "(H (4 [50] 3))"
      End
      Begin PaneConfiguration = 7
         NumPanes = 1
         Configuration = "(V (3))"
      End
      Begin PaneConfiguration = 8
         NumPanes = 3
         Configuration = "(H (1[56] 4[18] 2) )"
      End
      Begin PaneConfiguration = 9
         NumPanes = 2
         Configuration = "(H (1 [75] 4))"
      End
      Begin PaneConfiguration = 10
         NumPanes = 2
         Configuration = "(H (1[66] 2) )"
      End
      Begin PaneConfiguration = 11
         NumPanes = 2
         Configuration = "(H (4 [60] 2))"
      End
      Begin PaneConfiguration = 12
         NumPanes = 1
         Configuration = "(H (1) )"
      End
      Begin PaneConfiguration = 13
         NumPanes = 1
         Configuration = "(V (4))"
      End
      Begin PaneConfiguration = 14
         NumPanes = 1
         Configuration = "(V (2))"
      End
      ActivePaneConfig = 0
   End
   Begin DiagramPane = 
      Begin Origin = 
         Top = 0
         Left = 0
      End
      Begin Tables = 
         Begin Table = "tblpatients"
            Begin Extent = 
               Top = 6
               Left = 38
               Bottom = 557
               Right = 378
            End
            DisplayFlags = 280
            TopColumn = 7
         End
         Begin Table = "tblwork"
            Begin Extent = 
               Top = 17
               Left = 450
               Bottom = 618
               Right = 1321
            End
            DisplayFlags = 280
            TopColumn = 7
         End
      End
   End
   Begin SQLPane = 
   End
   Begin DataPane = 
      Begin ParameterDefaults = ""
      End
      Begin ColumnWidths = 9
         Width = 284
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
      End
   End
   Begin CriteriaPane = 
      Begin ColumnWidths = 11
         Column = 1440
         Alias = 900
         Table = 1170
         Output = 720
         Append = 1400
         NewValue = 1170
         SortType = 1350
         SortOrder = 1410
         GroupBy = 1350
         Filter = 1350
         Or = 1350
         Or = 1350
         Or = 1350
      End
   End
End
' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_Works'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPaneCount', @value=1 , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_Works'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPane1', @value=N'[0E232FF0-B466-11cf-A24F-00AA00A3EFFF, 1.00]
Begin DesignProperties = 
   Begin PaneConfigurations = 
      Begin PaneConfiguration = 0
         NumPanes = 4
         Configuration = "(H (1[40] 4[20] 2[20] 3) )"
      End
      Begin PaneConfiguration = 1
         NumPanes = 3
         Configuration = "(H (1 [50] 4 [25] 3))"
      End
      Begin PaneConfiguration = 2
         NumPanes = 3
         Configuration = "(H (1 [50] 2 [25] 3))"
      End
      Begin PaneConfiguration = 3
         NumPanes = 3
         Configuration = "(H (4 [30] 2 [40] 3))"
      End
      Begin PaneConfiguration = 4
         NumPanes = 2
         Configuration = "(H (1 [56] 3))"
      End
      Begin PaneConfiguration = 5
         NumPanes = 2
         Configuration = "(H (2 [66] 3))"
      End
      Begin PaneConfiguration = 6
         NumPanes = 2
         Configuration = "(H (4 [50] 3))"
      End
      Begin PaneConfiguration = 7
         NumPanes = 1
         Configuration = "(V (3))"
      End
      Begin PaneConfiguration = 8
         NumPanes = 3
         Configuration = "(H (1[56] 4[18] 2) )"
      End
      Begin PaneConfiguration = 9
         NumPanes = 2
         Configuration = "(H (1 [75] 4))"
      End
      Begin PaneConfiguration = 10
         NumPanes = 2
         Configuration = "(H (1[66] 2) )"
      End
      Begin PaneConfiguration = 11
         NumPanes = 2
         Configuration = "(H (4 [60] 2))"
      End
      Begin PaneConfiguration = 12
         NumPanes = 1
         Configuration = "(H (1) )"
      End
      Begin PaneConfiguration = 13
         NumPanes = 1
         Configuration = "(V (4))"
      End
      Begin PaneConfiguration = 14
         NumPanes = 1
         Configuration = "(V (2))"
      End
      ActivePaneConfig = 0
   End
   Begin DiagramPane = 
      Begin Origin = 
         Top = 0
         Left = 0
      End
      Begin Tables = 
         Begin Table = "tblpatients"
            Begin Extent = 
               Top = 20
               Left = 652
               Bottom = 183
               Right = 859
            End
            DisplayFlags = 280
            TopColumn = 12
         End
         Begin Table = "tblwork"
            Begin Extent = 
               Top = 50
               Left = 309
               Bottom = 299
               Right = 528
            End
            DisplayFlags = 280
            TopColumn = 14
         End
         Begin Table = "VTotPaid"
            Begin Extent = 
               Top = 7
               Left = 48
               Bottom = 148
               Right = 255
            End
            DisplayFlags = 280
            TopColumn = 0
         End
      End
   End
   Begin SQLPane = 
   End
   Begin DataPane = 
      Begin ParameterDefaults = ""
      End
      Begin ColumnWidths = 19
         Width = 284
         Width = 1200
         Width = 1200
         Width = 1200
         Width = 1200
         Width = 1200
         Width = 1200
         Width = 1200
         Width = 1200
         Width = 1200
         Width = 1200
         Width = 1200
         Width = 1200
         Width = 1200
         Width = 1200
         Width = 1200
         Width = 1200
         Width = 1200
         Width = 1200
      End
   End
   Begin CriteriaPane = 
      Begin ColumnWidths = 11
         Column = 1440
         Alias = 900
         Table = 1180
         Output = 720
         Append = 1400
         NewValue = 1170
         SortType = 1360
         SortOrder = 1420
         GroupBy = 1350
         Filter = 1360
         Or = 1350
         Or = 1350
         Or = 1350
      End
   End
End
' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_WrkFrmSrc'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPaneCount', @value=1 , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_WrkFrmSrc'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPane1', @value=N'[0E232FF0-B466-11cf-A24F-00AA00A3EFFF, 1.00]
Begin DesignProperties = 
   Begin PaneConfigurations = 
      Begin PaneConfiguration = 0
         NumPanes = 4
         Configuration = "(H (1[40] 4[20] 2[20] 3) )"
      End
      Begin PaneConfiguration = 1
         NumPanes = 3
         Configuration = "(H (1 [50] 4 [25] 3))"
      End
      Begin PaneConfiguration = 2
         NumPanes = 3
         Configuration = "(H (1 [50] 2 [25] 3))"
      End
      Begin PaneConfiguration = 3
         NumPanes = 3
         Configuration = "(H (4 [30] 2 [40] 3))"
      End
      Begin PaneConfiguration = 4
         NumPanes = 2
         Configuration = "(H (1 [56] 3))"
      End
      Begin PaneConfiguration = 5
         NumPanes = 2
         Configuration = "(H (2 [66] 3))"
      End
      Begin PaneConfiguration = 6
         NumPanes = 2
         Configuration = "(H (4 [50] 3))"
      End
      Begin PaneConfiguration = 7
         NumPanes = 1
         Configuration = "(V (3))"
      End
      Begin PaneConfiguration = 8
         NumPanes = 3
         Configuration = "(H (1[56] 4[18] 2) )"
      End
      Begin PaneConfiguration = 9
         NumPanes = 2
         Configuration = "(H (1 [75] 4))"
      End
      Begin PaneConfiguration = 10
         NumPanes = 2
         Configuration = "(H (1[66] 2) )"
      End
      Begin PaneConfiguration = 11
         NumPanes = 2
         Configuration = "(H (4 [60] 2))"
      End
      Begin PaneConfiguration = 12
         NumPanes = 1
         Configuration = "(H (1) )"
      End
      Begin PaneConfiguration = 13
         NumPanes = 1
         Configuration = "(V (4))"
      End
      Begin PaneConfiguration = 14
         NumPanes = 1
         Configuration = "(V (2))"
      End
      ActivePaneConfig = 0
   End
   Begin DiagramPane = 
      Begin Origin = 
         Top = 0
         Left = 0
      End
      Begin Tables = 
         Begin Table = "CalStep2"
            Begin Extent = 
               Top = 6
               Left = 38
               Bottom = 85
               Right = 208
            End
            DisplayFlags = 280
            TopColumn = 0
         End
         Begin Table = "tbltimes"
            Begin Extent = 
               Top = 6
               Left = 246
               Bottom = 102
               Right = 416
            End
            DisplayFlags = 280
            TopColumn = 0
         End
      End
   End
   Begin SQLPane = 
   End
   Begin DataPane = 
      Begin ParameterDefaults = ""
      End
      Begin ColumnWidths = 9
         Width = 284
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
      End
   End
   Begin CriteriaPane = 
      Begin ColumnWidths = 11
         Column = 1440
         Alias = 900
         Table = 1170
         Output = 720
         Append = 1400
         NewValue = 1170
         SortType = 1350
         SortOrder = 1410
         GroupBy = 1350
         Filter = 1350
         Or = 1350
         Or = 1350
         Or = 1350
      End
   End
End
' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'VFillCal'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPaneCount', @value=1 , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'VFillCal'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPane1', @value=N'[0E232FF0-B466-11cf-A24F-00AA00A3EFFF, 1.00]
Begin DesignProperties = 
   Begin PaneConfigurations = 
      Begin PaneConfiguration = 0
         NumPanes = 4
         Configuration = "(H (1[40] 4[20] 2[20] 3) )"
      End
      Begin PaneConfiguration = 1
         NumPanes = 3
         Configuration = "(H (1 [50] 4 [25] 3))"
      End
      Begin PaneConfiguration = 2
         NumPanes = 3
         Configuration = "(H (1 [50] 2 [25] 3))"
      End
      Begin PaneConfiguration = 3
         NumPanes = 3
         Configuration = "(H (4 [30] 2 [40] 3))"
      End
      Begin PaneConfiguration = 4
         NumPanes = 2
         Configuration = "(H (1 [56] 3))"
      End
      Begin PaneConfiguration = 5
         NumPanes = 2
         Configuration = "(H (2 [66] 3))"
      End
      Begin PaneConfiguration = 6
         NumPanes = 2
         Configuration = "(H (4 [50] 3))"
      End
      Begin PaneConfiguration = 7
         NumPanes = 1
         Configuration = "(V (3))"
      End
      Begin PaneConfiguration = 8
         NumPanes = 3
         Configuration = "(H (1[56] 4[18] 2) )"
      End
      Begin PaneConfiguration = 9
         NumPanes = 2
         Configuration = "(H (1 [75] 4))"
      End
      Begin PaneConfiguration = 10
         NumPanes = 2
         Configuration = "(H (1[66] 2) )"
      End
      Begin PaneConfiguration = 11
         NumPanes = 2
         Configuration = "(H (4 [60] 2))"
      End
      Begin PaneConfiguration = 12
         NumPanes = 1
         Configuration = "(H (1) )"
      End
      Begin PaneConfiguration = 13
         NumPanes = 1
         Configuration = "(V (4))"
      End
      Begin PaneConfiguration = 14
         NumPanes = 1
         Configuration = "(V (2))"
      End
      ActivePaneConfig = 0
   End
   Begin DiagramPane = 
      Begin Origin = 
         Top = 0
         Left = 0
      End
      Begin Tables = 
         Begin Table = "tblInvoice"
            Begin Extent = 
               Top = 6
               Left = 38
               Bottom = 136
               Right = 225
            End
            DisplayFlags = 280
            TopColumn = 0
         End
         Begin Table = "tblwork"
            Begin Extent = 
               Top = 6
               Left = 263
               Bottom = 136
               Right = 449
            End
            DisplayFlags = 280
            TopColumn = 0
         End
      End
   End
   Begin SQLPane = 
   End
   Begin DataPane = 
      Begin ParameterDefaults = ""
      End
   End
   Begin CriteriaPane = 
      Begin ColumnWidths = 12
         Column = 1440
         Alias = 900
         Table = 1170
         Output = 720
         Append = 1400
         NewValue = 1170
         SortType = 1350
         SortOrder = 1410
         GroupBy = 1350
         Filter = 1350
         Or = 1350
         Or = 1350
         Or = 1350
      End
   End
End
' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'VIncome'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPaneCount', @value=1 , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'VIncome'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPane1', @value=N'[0E232FF0-B466-11cf-A24F-00AA00A3EFFF, 1.00]
Begin DesignProperties = 
   Begin PaneConfigurations = 
      Begin PaneConfiguration = 0
         NumPanes = 4
         Configuration = "(H (1[40] 4[20] 2[20] 3) )"
      End
      Begin PaneConfiguration = 1
         NumPanes = 3
         Configuration = "(H (1 [50] 4 [25] 3))"
      End
      Begin PaneConfiguration = 2
         NumPanes = 3
         Configuration = "(H (1 [50] 2 [25] 3))"
      End
      Begin PaneConfiguration = 3
         NumPanes = 3
         Configuration = "(H (4 [30] 2 [40] 3))"
      End
      Begin PaneConfiguration = 4
         NumPanes = 2
         Configuration = "(H (1 [56] 3))"
      End
      Begin PaneConfiguration = 5
         NumPanes = 2
         Configuration = "(H (2 [66] 3))"
      End
      Begin PaneConfiguration = 6
         NumPanes = 2
         Configuration = "(H (4 [50] 3))"
      End
      Begin PaneConfiguration = 7
         NumPanes = 1
         Configuration = "(V (3))"
      End
      Begin PaneConfiguration = 8
         NumPanes = 3
         Configuration = "(H (1[56] 4[18] 2) )"
      End
      Begin PaneConfiguration = 9
         NumPanes = 2
         Configuration = "(H (1 [75] 4))"
      End
      Begin PaneConfiguration = 10
         NumPanes = 2
         Configuration = "(H (1[66] 2) )"
      End
      Begin PaneConfiguration = 11
         NumPanes = 2
         Configuration = "(H (4 [60] 2))"
      End
      Begin PaneConfiguration = 12
         NumPanes = 1
         Configuration = "(H (1) )"
      End
      Begin PaneConfiguration = 13
         NumPanes = 1
         Configuration = "(V (4))"
      End
      Begin PaneConfiguration = 14
         NumPanes = 1
         Configuration = "(V (2))"
      End
      ActivePaneConfig = 0
   End
   Begin DiagramPane = 
      Begin Origin = 
         Top = 0
         Left = 0
      End
      Begin Tables = 
         Begin Table = "tblInvoice"
            Begin Extent = 
               Top = 6
               Left = 38
               Bottom = 136
               Right = 225
            End
            DisplayFlags = 280
            TopColumn = 0
         End
         Begin Table = "tblwork"
            Begin Extent = 
               Top = 6
               Left = 263
               Bottom = 136
               Right = 449
            End
            DisplayFlags = 280
            TopColumn = 0
         End
      End
   End
   Begin SQLPane = 
   End
   Begin DataPane = 
      Begin ParameterDefaults = ""
      End
      Begin ColumnWidths = 9
         Width = 284
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
      End
   End
   Begin CriteriaPane = 
      Begin ColumnWidths = 12
         Column = 1440
         Alias = 900
         Table = 1170
         Output = 720
         Append = 1400
         NewValue = 1170
         SortType = 1350
         SortOrder = 1410
         GroupBy = 1350
         Filter = 1350
         Or = 1350
         Or = 1350
         Or = 1350
      End
   End
End
' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'VIQD'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPaneCount', @value=1 , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'VIQD'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPane1', @value=N'[0E232FF0-B466-11cf-A24F-00AA00A3EFFF, 1.00]
Begin DesignProperties = 
   Begin PaneConfigurations = 
      Begin PaneConfiguration = 0
         NumPanes = 4
         Configuration = "(H (1[40] 4[20] 2[20] 3) )"
      End
      Begin PaneConfiguration = 1
         NumPanes = 3
         Configuration = "(H (1 [50] 4 [25] 3))"
      End
      Begin PaneConfiguration = 2
         NumPanes = 3
         Configuration = "(H (1 [50] 2 [25] 3))"
      End
      Begin PaneConfiguration = 3
         NumPanes = 3
         Configuration = "(H (4 [30] 2 [40] 3))"
      End
      Begin PaneConfiguration = 4
         NumPanes = 2
         Configuration = "(H (1 [56] 3))"
      End
      Begin PaneConfiguration = 5
         NumPanes = 2
         Configuration = "(H (2 [66] 3))"
      End
      Begin PaneConfiguration = 6
         NumPanes = 2
         Configuration = "(H (4 [50] 3))"
      End
      Begin PaneConfiguration = 7
         NumPanes = 1
         Configuration = "(V (3))"
      End
      Begin PaneConfiguration = 8
         NumPanes = 3
         Configuration = "(H (1[56] 4[18] 2) )"
      End
      Begin PaneConfiguration = 9
         NumPanes = 2
         Configuration = "(H (1 [75] 4))"
      End
      Begin PaneConfiguration = 10
         NumPanes = 2
         Configuration = "(H (1[66] 2) )"
      End
      Begin PaneConfiguration = 11
         NumPanes = 2
         Configuration = "(H (4 [60] 2))"
      End
      Begin PaneConfiguration = 12
         NumPanes = 1
         Configuration = "(H (1) )"
      End
      Begin PaneConfiguration = 13
         NumPanes = 1
         Configuration = "(V (4))"
      End
      Begin PaneConfiguration = 14
         NumPanes = 1
         Configuration = "(V (2))"
      End
      ActivePaneConfig = 0
   End
   Begin DiagramPane = 
      Begin Origin = 
         Top = 0
         Left = 0
      End
      Begin Tables = 
         Begin Table = "tblappointments"
            Begin Extent = 
               Top = 6
               Left = 38
               Bottom = 576
               Right = 486
            End
            DisplayFlags = 280
            TopColumn = 9
         End
         Begin Table = "T"
            Begin Extent = 
               Top = 6
               Left = 262
               Bottom = 102
               Right = 449
            End
            DisplayFlags = 280
            TopColumn = 0
         End
      End
   End
   Begin SQLPane = 
   End
   Begin DataPane = 
      Begin ParameterDefaults = ""
      End
      Begin ColumnWidths = 9
         Width = 284
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
      End
   End
   Begin CriteriaPane = 
      Begin ColumnWidths = 11
         Column = 1440
         Alias = 900
         Table = 1170
         Output = 720
         Append = 1400
         NewValue = 1170
         SortType = 1350
         SortOrder = 1410
         GroupBy = 1350
         Filter = 1350
         Or = 1350
         Or = 1350
         Or = 1350
      End
   End
End
' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'VLastApp'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPaneCount', @value=1 , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'VLastApp'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPane1', @value=N'[0E232FF0-B466-11cf-A24F-00AA00A3EFFF, 1.00]
Begin DesignProperties = 
   Begin PaneConfigurations = 
      Begin PaneConfiguration = 0
         NumPanes = 4
         Configuration = "(H (1[40] 4[20] 2[20] 3) )"
      End
      Begin PaneConfiguration = 1
         NumPanes = 3
         Configuration = "(H (1 [50] 4 [25] 3))"
      End
      Begin PaneConfiguration = 2
         NumPanes = 3
         Configuration = "(H (1 [50] 2 [25] 3))"
      End
      Begin PaneConfiguration = 3
         NumPanes = 3
         Configuration = "(H (4 [30] 2 [40] 3))"
      End
      Begin PaneConfiguration = 4
         NumPanes = 2
         Configuration = "(H (1 [56] 3))"
      End
      Begin PaneConfiguration = 5
         NumPanes = 2
         Configuration = "(H (2 [66] 3))"
      End
      Begin PaneConfiguration = 6
         NumPanes = 2
         Configuration = "(H (4 [50] 3))"
      End
      Begin PaneConfiguration = 7
         NumPanes = 1
         Configuration = "(V (3))"
      End
      Begin PaneConfiguration = 8
         NumPanes = 3
         Configuration = "(H (1[56] 4[18] 2) )"
      End
      Begin PaneConfiguration = 9
         NumPanes = 2
         Configuration = "(H (1 [75] 4))"
      End
      Begin PaneConfiguration = 10
         NumPanes = 2
         Configuration = "(H (1[66] 2) )"
      End
      Begin PaneConfiguration = 11
         NumPanes = 2
         Configuration = "(H (4 [60] 2))"
      End
      Begin PaneConfiguration = 12
         NumPanes = 1
         Configuration = "(H (1) )"
      End
      Begin PaneConfiguration = 13
         NumPanes = 1
         Configuration = "(V (4))"
      End
      Begin PaneConfiguration = 14
         NumPanes = 1
         Configuration = "(V (2))"
      End
      ActivePaneConfig = 0
   End
   Begin DiagramPane = 
      Begin Origin = 
         Top = 0
         Left = 0
      End
      Begin Tables = 
         Begin Table = "tblwork"
            Begin Extent = 
               Top = 12
               Left = 47
               Bottom = 175
               Right = 282
            End
            DisplayFlags = 280
            TopColumn = 1
         End
         Begin Table = "tblInvoice"
            Begin Extent = 
               Top = 61
               Left = 479
               Bottom = 411
               Right = 1004
            End
            DisplayFlags = 280
            TopColumn = 0
         End
      End
   End
   Begin SQLPane = 
   End
   Begin DataPane = 
      Begin ParameterDefaults = ""
      End
      Begin ColumnWidths = 9
         Width = 284
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
      End
   End
   Begin CriteriaPane = 
      Begin ColumnWidths = 12
         Column = 1440
         Alias = 900
         Table = 1180
         Output = 720
         Append = 1400
         NewValue = 1170
         SortType = 1360
         SortOrder = 1420
         GroupBy = 1350
         Filter = 1360
         Or = 1350
         Or = 1350
         Or = 1350
      End
   End
End
' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'VTotPaid'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPaneCount', @value=1 , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'VTotPaid'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPane1', @value=N'[0E232FF0-B466-11cf-A24F-00AA00A3EFFF, 1.00]
Begin DesignProperties = 
   Begin PaneConfigurations = 
      Begin PaneConfiguration = 0
         NumPanes = 4
         Configuration = "(H (1[40] 4[20] 2[20] 3) )"
      End
      Begin PaneConfiguration = 1
         NumPanes = 3
         Configuration = "(H (1 [50] 4 [25] 3))"
      End
      Begin PaneConfiguration = 2
         NumPanes = 3
         Configuration = "(H (1 [50] 2 [25] 3))"
      End
      Begin PaneConfiguration = 3
         NumPanes = 3
         Configuration = "(H (4 [30] 2 [40] 3))"
      End
      Begin PaneConfiguration = 4
         NumPanes = 2
         Configuration = "(H (1 [56] 3))"
      End
      Begin PaneConfiguration = 5
         NumPanes = 2
         Configuration = "(H (2 [66] 3))"
      End
      Begin PaneConfiguration = 6
         NumPanes = 2
         Configuration = "(H (4 [50] 3))"
      End
      Begin PaneConfiguration = 7
         NumPanes = 1
         Configuration = "(V (3))"
      End
      Begin PaneConfiguration = 8
         NumPanes = 3
         Configuration = "(H (1[56] 4[18] 2) )"
      End
      Begin PaneConfiguration = 9
         NumPanes = 2
         Configuration = "(H (1 [75] 4))"
      End
      Begin PaneConfiguration = 10
         NumPanes = 2
         Configuration = "(H (1[66] 2) )"
      End
      Begin PaneConfiguration = 11
         NumPanes = 2
         Configuration = "(H (4 [60] 2))"
      End
      Begin PaneConfiguration = 12
         NumPanes = 1
         Configuration = "(H (1) )"
      End
      Begin PaneConfiguration = 13
         NumPanes = 1
         Configuration = "(V (4))"
      End
      Begin PaneConfiguration = 14
         NumPanes = 1
         Configuration = "(V (2))"
      End
      ActivePaneConfig = 0
   End
   Begin DiagramPane = 
      Begin Origin = 
         Top = 0
         Left = 0
      End
      Begin Tables = 
         Begin Table = "tblInvoice"
            Begin Extent = 
               Top = 6
               Left = 38
               Bottom = 136
               Right = 225
            End
            DisplayFlags = 280
            TopColumn = 0
         End
         Begin Table = "tblwork"
            Begin Extent = 
               Top = 6
               Left = 263
               Bottom = 136
               Right = 449
            End
            DisplayFlags = 280
            TopColumn = 0
         End
      End
   End
   Begin SQLPane = 
   End
   Begin DataPane = 
      Begin ParameterDefaults = ""
      End
      Begin ColumnWidths = 9
         Width = 284
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
         Width = 1500
      End
   End
   Begin CriteriaPane = 
      Begin ColumnWidths = 12
         Column = 1440
         Alias = 900
         Table = 1170
         Output = 720
         Append = 1400
         NewValue = 1170
         SortType = 1350
         SortOrder = 1410
         GroupBy = 1350
         Filter = 1350
         Or = 1350
         Or = 1350
         Or = 1350
      End
   End
End
' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'VUSD'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPaneCount', @value=1 , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'VUSD'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPane1', @value=N'[0E232FF0-B466-11cf-A24F-00AA00A3EFFF, 1.00]
Begin DesignProperties = 
   Begin PaneConfigurations = 
      Begin PaneConfiguration = 0
         NumPanes = 4
         Configuration = "(H (1[40] 4[20] 2[20] 3) )"
      End
      Begin PaneConfiguration = 1
         NumPanes = 3
         Configuration = "(H (1 [50] 4 [25] 3))"
      End
      Begin PaneConfiguration = 2
         NumPanes = 3
         Configuration = "(H (1 [50] 2 [25] 3))"
      End
      Begin PaneConfiguration = 3
         NumPanes = 3
         Configuration = "(H (4 [30] 2 [40] 3))"
      End
      Begin PaneConfiguration = 4
         NumPanes = 2
         Configuration = "(H (1 [56] 3))"
      End
      Begin PaneConfiguration = 5
         NumPanes = 2
         Configuration = "(H (2 [66] 3))"
      End
      Begin PaneConfiguration = 6
         NumPanes = 2
         Configuration = "(H (4 [50] 3))"
      End
      Begin PaneConfiguration = 7
         NumPanes = 1
         Configuration = "(V (3))"
      End
      Begin PaneConfiguration = 8
         NumPanes = 3
         Configuration = "(H (1[56] 4[18] 2) )"
      End
      Begin PaneConfiguration = 9
         NumPanes = 2
         Configuration = "(H (1 [75] 4))"
      End
      Begin PaneConfiguration = 10
         NumPanes = 2
         Configuration = "(H (1[66] 2) )"
      End
      Begin PaneConfiguration = 11
         NumPanes = 2
         Configuration = "(H (4 [60] 2))"
      End
      Begin PaneConfiguration = 12
         NumPanes = 1
         Configuration = "(H (1) )"
      End
      Begin PaneConfiguration = 13
         NumPanes = 1
         Configuration = "(V (4))"
      End
      Begin PaneConfiguration = 14
         NumPanes = 1
         Configuration = "(V (2))"
      End
      ActivePaneConfig = 0
   End
   Begin DiagramPane = 
      Begin Origin = 
         Top = 0
         Left = 0
      End
      Begin Tables = 
         Begin Table = "V"
            Begin Extent = 
               Top = 15
               Left = 96
               Bottom = 324
               Right = 433
            End
            DisplayFlags = 280
            TopColumn = 0
         End
         Begin Table = "E"
            Begin Extent = 
               Top = 15
               Left = 529
               Bottom = 281
               Right = 857
            End
            DisplayFlags = 280
            TopColumn = 0
         End
      End
   End
   Begin SQLPane = 
   End
   Begin DataPane = 
      Begin ParameterDefaults = ""
      End
      Begin ColumnWidths = 9
         Width = 284
         Width = 600
         Width = 600
         Width = 600
         Width = 600
         Width = 600
         Width = 600
         Width = 600
         Width = 600
      End
   End
   Begin CriteriaPane = 
      Begin ColumnWidths = 11
         Column = 1440
         Alias = 900
         Table = 1176
         Output = 720
         Append = 1400
         NewValue = 1170
         SortType = 1356
         SortOrder = 1416
         GroupBy = 1350
         Filter = 1356
         Or = 1350
         Or = 1350
         Or = 1350
      End
   End
End
' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'VWIQD'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPaneCount', @value=1 , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'VWIQD'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPane1', @value=N'[0E232FF0-B466-11cf-A24F-00AA00A3EFFF, 1.00]
Begin DesignProperties = 
   Begin PaneConfigurations = 
      Begin PaneConfiguration = 0
         NumPanes = 4
         Configuration = "(H (1[40] 4[20] 2[20] 3) )"
      End
      Begin PaneConfiguration = 1
         NumPanes = 3
         Configuration = "(H (1 [50] 4 [25] 3))"
      End
      Begin PaneConfiguration = 2
         NumPanes = 3
         Configuration = "(H (1 [50] 2 [25] 3))"
      End
      Begin PaneConfiguration = 3
         NumPanes = 3
         Configuration = "(H (4 [30] 2 [40] 3))"
      End
      Begin PaneConfiguration = 4
         NumPanes = 2
         Configuration = "(H (1 [56] 3))"
      End
      Begin PaneConfiguration = 5
         NumPanes = 2
         Configuration = "(H (2 [66] 3))"
      End
      Begin PaneConfiguration = 6
         NumPanes = 2
         Configuration = "(H (4 [50] 3))"
      End
      Begin PaneConfiguration = 7
         NumPanes = 1
         Configuration = "(V (3))"
      End
      Begin PaneConfiguration = 8
         NumPanes = 3
         Configuration = "(H (1[56] 4[18] 2) )"
      End
      Begin PaneConfiguration = 9
         NumPanes = 2
         Configuration = "(H (1 [75] 4))"
      End
      Begin PaneConfiguration = 10
         NumPanes = 2
         Configuration = "(H (1[66] 2) )"
      End
      Begin PaneConfiguration = 11
         NumPanes = 2
         Configuration = "(H (4 [60] 2))"
      End
      Begin PaneConfiguration = 12
         NumPanes = 1
         Configuration = "(H (1) )"
      End
      Begin PaneConfiguration = 13
         NumPanes = 1
         Configuration = "(V (4))"
      End
      Begin PaneConfiguration = 14
         NumPanes = 1
         Configuration = "(V (2))"
      End
      ActivePaneConfig = 0
   End
   Begin DiagramPane = 
      Begin Origin = 
         Top = 0
         Left = 0
      End
      Begin Tables = 
         Begin Table = "V"
            Begin Extent = 
               Top = 15
               Left = 96
               Bottom = 324
               Right = 433
            End
            DisplayFlags = 280
            TopColumn = 0
         End
         Begin Table = "E"
            Begin Extent = 
               Top = 15
               Left = 529
               Bottom = 281
               Right = 857
            End
            DisplayFlags = 280
            TopColumn = 0
         End
      End
   End
   Begin SQLPane = 
   End
   Begin DataPane = 
      Begin ParameterDefaults = ""
      End
      Begin ColumnWidths = 9
         Width = 284
         Width = 600
         Width = 600
         Width = 600
         Width = 600
         Width = 600
         Width = 600
         Width = 600
         Width = 600
      End
   End
   Begin CriteriaPane = 
      Begin ColumnWidths = 11
         Column = 1440
         Alias = 900
         Table = 1176
         Output = 720
         Append = 1400
         NewValue = 1170
         SortType = 1356
         SortOrder = 1416
         GroupBy = 1350
         Filter = 1356
         Or = 1350
         Or = 1350
         Or = 1350
      End
   End
End
' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'VWUSD'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPaneCount', @value=1 , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'VWUSD'
GO
USE [master]
GO
ALTER DATABASE [ShwanNew] SET  READ_WRITE 
GO
