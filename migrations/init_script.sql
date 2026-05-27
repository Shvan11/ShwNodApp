USE [master]
GO
/****** Object:  Database [ShwanNew]    Script Date: 5/27/2026 7:11:35 PM ******/
CREATE DATABASE [ShwanNew]
 CONTAINMENT = NONE
 ON  PRIMARY 
( NAME = N'ShwanNew', FILENAME = N'C:\Program Files\Microsoft SQL Server\MSSQL16.DOLPHIN\MSSQL\DATA\ShwanNew.mdf' , SIZE = 174656KB , MAXSIZE = UNLIMITED, FILEGROWTH = 65536KB )
 LOG ON 
( NAME = N'ShwanNew_log', FILENAME = N'C:\Program Files\Microsoft SQL Server\MSSQL16.DOLPHIN\MSSQL\DATA\ShwanNew.ldf' , SIZE = 139264KB , MAXSIZE = 2048GB , FILEGROWTH = 65536KB )
 COLLATE Arabic_CI_AS
 WITH CATALOG_COLLATION = DATABASE_DEFAULT, LEDGER = OFF
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
ALTER DATABASE [ShwanNew] SET  READ_WRITE 
GO
USE [ShwanNew]
GO
/****** Object:  Schema [History]    Script Date: 5/27/2026 7:11:44 PM ******/
CREATE SCHEMA [History]
GO
/****** Object:  UserDefinedTableType [dbo].[SMSStatusType]    Script Date: 5/27/2026 7:11:44 PM ******/
CREATE TYPE [dbo].[SMSStatusType] AS TABLE(
	[AppointmentID] [int] NULL,
	[SMSStatus] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[sms_sid] [nvarchar](255) COLLATE Arabic_CI_AS NULL
)
GO
/****** Object:  UserDefinedTableType [dbo].[WhatsTableType]    Script Date: 5/27/2026 7:11:44 PM ******/
CREATE TYPE [dbo].[WhatsTableType] AS TABLE(
	[AppointmentID] [int] NULL,
	[SentWa] [bit] NULL,
	[DeliveredWa] [nvarchar](50) COLLATE Arabic_CI_AS NULL,
	[WaMessageID] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[LastUpdated] [datetime] NULL,
	[SentTimestamp] [datetime] NULL
)
GO
/****** Object:  UserDefinedFunction [dbo].[ArabicDay]    Script Date: 5/27/2026 7:11:44 PM ******/
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
/****** Object:  UserDefinedFunction [dbo].[FuncTotalPaid]    Script Date: 5/27/2026 7:11:44 PM ******/
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
/****** Object:  UserDefinedFunction [dbo].[FuncTotalPaidW]    Script Date: 5/27/2026 7:11:44 PM ******/
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
/****** Object:  UserDefinedFunction [dbo].[HasVisit]    Script Date: 5/27/2026 7:11:44 PM ******/
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
/****** Object:  Table [dbo].[tblvisits]    Script Date: 5/27/2026 7:11:44 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblvisits](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[WorkID] [int] NOT NULL,
	[VisitDate] [date] NOT NULL,
	[BracketChange] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[WireBending] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[OPG] [bit] NULL,
	[Others] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[NextVisit] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[Elastics] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[UpperWireID] [int] NULL,
	[LowerWireID] [int] NULL,
	[PPhoto] [bit] NULL,
	[IPhoto] [bit] NULL,
	[FPhoto] [bit] NULL,
	[ApplianceRemoved] [bit] NULL,
	[OperatorID] [int] NULL,
	[CreatedAt] [datetime] NULL,
 CONSTRAINT [tblvisits$PrimaryKey] PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
/****** Object:  View [dbo].[V_lastvisit]    Script Date: 5/27/2026 7:11:44 PM ******/
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
/****** Object:  Table [dbo].[tblAlignerSets]    Script Date: 5/27/2026 7:11:44 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblAlignerSets](
	[AlignerSetID] [int] IDENTITY(1,1) NOT NULL,
	[WorkID] [int] NOT NULL,
	[UpperAlignersCount] [int] NULL,
	[LowerAlignersCount] [int] NULL,
	[CreationDate] [date] NULL,
	[Notes] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[IsActive] [bit] NULL,
	[Days] [int] NULL,
	[FolderPath] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[AlignerDrID] [int] NOT NULL,
	[Type] [nvarchar](50) COLLATE Arabic_CI_AS NULL,
	[SetSequence] [int] NULL,
	[RemainingUpperAligners] [int] NULL,
	[RemainingLowerAligners] [int] NULL,
	[SetUrl] [nvarchar](2000) COLLATE Arabic_CI_AS NULL,
	[SetPdfUrl] [nvarchar](2000) COLLATE Arabic_CI_AS NULL,
	[SetCost] [decimal](10, 2) NULL,
	[Currency] [nvarchar](3) COLLATE Arabic_CI_AS NULL,
	[PdfUploadedAt] [datetime] NULL,
	[PdfUploadedBy] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[DriveFileId] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[SetVideo] [nvarchar](2000) COLLATE Arabic_CI_AS NULL,
	[ArchformID] [int] NULL,
 CONSTRAINT [PK__tblAlign__8C6E8FA44F19A436] PRIMARY KEY CLUSTERED 
(
	[AlignerSetID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY],
 CONSTRAINT [UQ_SetSequence_WorkID] UNIQUE NONCLUSTERED 
(
	[WorkID] ASC,
	[SetSequence] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
/****** Object:  Table [History].[tblInvoice]    Script Date: 5/27/2026 7:11:44 PM ******/
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
	[ActualCur] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[Change] [int] NULL,
	[AlignerSetID] [int] NULL,
	[USDReceived] [int] NOT NULL,
	[IQDReceived] [int] NOT NULL
) ON [PRIMARY]
WITH
(
DATA_COMPRESSION = PAGE
)

GO
/****** Object:  Index [ix_tblInvoice]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE CLUSTERED INDEX [ix_tblInvoice] ON [History].[tblInvoice]
(
	[SysEndTime] ASC,
	[SysStartTime] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF, DATA_COMPRESSION = PAGE) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[tblInvoice]    Script Date: 5/27/2026 7:11:45 PM ******/
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
	[ActualCur] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[Change] [int] NULL,
	[AlignerSetID] [int] NULL,
	[USDReceived] [int] NOT NULL,
	[IQDReceived] [int] NOT NULL,
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
/****** Object:  View [dbo].[vw_AlignerSetPayments]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE VIEW vw_AlignerSetPayments AS SELECT s.AlignerSetID, s.WorkID, s.SetSequence, s.Type, s.SetCost, s.Currency, ISNULL(SUM(i.Amountpaid), 0) as TotalPaid, s.SetCost - ISNULL(SUM(i.Amountpaid), 0) as Balance, CASE WHEN s.SetCost IS NULL THEN 'No Cost Set' WHEN ISNULL(SUM(i.Amountpaid), 0) = 0 THEN 'Unpaid' WHEN ISNULL(SUM(i.Amountpaid), 0) < s.SetCost THEN 'Partial' WHEN ISNULL(SUM(i.Amountpaid), 0) >= s.SetCost THEN 'Paid' ELSE 'Unknown' END as PaymentStatus FROM tblAlignerSets s LEFT JOIN tblInvoice i ON s.AlignerSetID = i.AlignerSetID GROUP BY s.AlignerSetID, s.WorkID, s.SetSequence, s.Type, s.SetCost, s.Currency
GO
/****** Object:  Table [dbo].[tblwork]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblwork](
	[workid] [int] IDENTITY(1,1) NOT NULL,
	[PersonID] [int] NOT NULL,
	[TotalRequired] [int] NOT NULL,
	[Currency] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[Typeofwork] [int] NOT NULL,
	[Notes] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
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
	[Status] [tinyint] NOT NULL,
	[Discount] [int] NULL,
	[DiscountDate] [date] NULL,
	[DiscountReason] [nvarchar](500) COLLATE Arabic_CI_AS NULL,
 CONSTRAINT [tblwork$PrimaryKey] PRIMARY KEY CLUSTERED 
(
	[workid] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
/****** Object:  View [dbo].[VTotPaid]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE VIEW dbo.VTotPaid
AS
SELECT dbo.tblwork.workid, SUM(dbo.tblInvoice.Amountpaid) AS TotalPaid, MAX(dbo.tblInvoice.Dateofpayment) AS LastPaymrntDate, dbo.tblwork.TotalRequired
FROM   dbo.tblwork LEFT OUTER JOIN
             dbo.tblInvoice ON dbo.tblwork.workid = dbo.tblInvoice.workid
GROUP BY dbo.tblwork.workid, dbo.tblwork.TotalRequired

GO
/****** Object:  Table [dbo].[tblAlignerBatches]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
SET ANSI_PADDING ON
GO
CREATE TABLE [dbo].[tblAlignerBatches](
	[AlignerBatchID] [int] IDENTITY(1,1) NOT NULL,
	[AlignerSetID] [int] NOT NULL,
	[UpperAlignerCount] [int] NOT NULL,
	[LowerAlignerCount] [int] NOT NULL,
	[ManufactureDate] [date] NULL,
	[DeliveredToPatientDate] [date] NULL,
	[Notes] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[IsActive] [bit] NULL,
	[BatchSequence] [int] NOT NULL,
	[UpperAlignerStartSequence] [int] NULL,
	[LowerAlignerStartSequence] [int] NULL,
	[UpperAlignerEndSequence]  AS (case when [UpperAlignerStartSequence] IS NULL then NULL else ([UpperAlignerStartSequence]+[UpperAlignerCount])-(1) end) PERSISTED,
	[LowerAlignerEndSequence]  AS (case when [LowerAlignerStartSequence] IS NULL then NULL else ([LowerAlignerStartSequence]+[LowerAlignerCount])-(1) end) PERSISTED,
	[Days] [int] NULL,
	[IsLast] [bit] NOT NULL,
	[CreationDate] [datetime] NOT NULL,
	[HasUpperTemplate] [bit] NOT NULL,
	[HasLowerTemplate] [bit] NOT NULL,
	[ValidityPeriod]  AS (case when [Days] IS NULL then NULL when ([UpperAlignerCount]-case when [HasUpperTemplate]=(1) then (1) else (0) end)>=([LowerAlignerCount]-case when [HasLowerTemplate]=(1) then (1) else (0) end) then ([UpperAlignerCount]-case when [HasUpperTemplate]=(1) then (1) else (0) end)*[Days] else ([LowerAlignerCount]-case when [HasLowerTemplate]=(1) then (1) else (0) end)*[Days] end),
	[BatchExpiryDate]  AS (dateadd(day,case when [Days] IS NULL then NULL when ([UpperAlignerCount]-case when [HasUpperTemplate]=(1) then (1) else (0) end)>=([LowerAlignerCount]-case when [HasLowerTemplate]=(1) then (1) else (0) end) then ([UpperAlignerCount]-case when [HasUpperTemplate]=(1) then (1) else (0) end)*[Days] else ([LowerAlignerCount]-case when [HasLowerTemplate]=(1) then (1) else (0) end)*[Days] end,[DeliveredToPatientDate])),
 CONSTRAINT [PK__tblAlign__1C222425A57BE68E] PRIMARY KEY CLUSTERED 
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
SET ANSI_PADDING OFF
GO
/****** Object:  Table [dbo].[tblpatients]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblpatients](
	[PersonID] [int] IDENTITY(1,1) NOT NULL,
	[patientID] [nvarchar](6) COLLATE Arabic_CI_AS NULL,
	[PatientName] [nvarchar](255) COLLATE Arabic_CI_AS NOT NULL,
	[Phone] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[FirstName] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[LastName] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[DateofBirth] [date] NULL,
	[Gender] [int] NULL,
	[Phone2] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[AddressID] [int] NULL,
	[DateAdded] [datetime2](0) NULL,
	[ReferralSourceID] [int] NULL,
	[EstimatedCost] [int] NULL,
	[Currency] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[PatientTypeID] [int] NULL,
	[Notes] [nvarchar](100) COLLATE Arabic_CI_AS NULL,
	[Email] [nchar](255) COLLATE Arabic_CI_AS NULL,
	[Language] [tinyint] NULL,
	[Age]  AS (CONVERT([decimal](3,1),datediff(month,[DateofBirth],getdate())/CONVERT([decimal](3,1),(12)))),
	[TagID] [int] NULL,
	[CountryCode] [nvarchar](5) COLLATE Arabic_CI_AS NULL,
	[WebCephPatientID] [nvarchar](50) COLLATE Arabic_CI_AS NULL,
	[WebCephLink] [nvarchar](500) COLLATE Arabic_CI_AS NULL,
	[WebCephCreatedAt] [datetime2](7) NULL,
 CONSTRAINT [tblpatients$PrimaryKey] PRIMARY KEY CLUSTERED 
(
	[PersonID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
/****** Object:  View [dbo].[v_allsets]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE VIEW dbo.v_allsets AS
SELECT
    dbo.tblpatients.PatientName,
    dbo.tblAlignerSets.AlignerSetID,
    dbo.tblAlignerSets.SetSequence,
    dbo.tblAlignerSets.CreationDate,
    dbo.tblAlignerSets.IsActive AS SetIsActive,
    lb.AlignerBatchID,
    lb.BatchSequence,
    lb.CreationDate AS BatchCreationDate,
    lb.ManufactureDate,
    lb.DeliveredToPatientDate,
    lb.BatchExpiryDate,
    lb.Notes,
    lb.IsLast,
    -- NextDueDate: Based on the latest DELIVERED batch's expiry date
    (SELECT TOP 1 b.BatchExpiryDate
     FROM dbo.tblAlignerBatches b
     WHERE b.AlignerSetID = dbo.tblAlignerSets.AlignerSetID
       AND b.DeliveredToPatientDate IS NOT NULL
     ORDER BY b.BatchSequence DESC
    ) AS NextDueDate,
    -- NextBatchPresent: Is there a manufactured batch waiting to be delivered?
    CASE
        WHEN EXISTS (
            SELECT 1
            FROM dbo.tblAlignerBatches ReadyBatch
            WHERE ReadyBatch.AlignerSetID = dbo.tblAlignerSets.AlignerSetID
              AND ReadyBatch.ManufactureDate IS NOT NULL
              AND ReadyBatch.DeliveredToPatientDate IS NULL
              AND ReadyBatch.BatchSequence > ISNULL(
                  (SELECT MAX(b2.BatchSequence)
                   FROM dbo.tblAlignerBatches b2
                   WHERE b2.AlignerSetID = dbo.tblAlignerSets.AlignerSetID
                     AND b2.DeliveredToPatientDate IS NOT NULL), 0)
        ) THEN 'True'
        ELSE 'False'
    END AS NextBatchPresent,
    -- LabStatus: What's the current manufacturing status?
    CASE
        WHEN NOT EXISTS (
            SELECT 1
            FROM dbo.tblAlignerBatches b2
            WHERE b2.AlignerSetID = dbo.tblAlignerSets.AlignerSetID
        ) THEN 'no_batches'
        WHEN EXISTS (
            SELECT 1
            FROM dbo.tblAlignerBatches b2
            WHERE b2.AlignerSetID = dbo.tblAlignerSets.AlignerSetID
              AND b2.ManufactureDate IS NOT NULL
              AND b2.DeliveredToPatientDate IS NULL
        ) THEN 'in_lab'
        WHEN EXISTS (
            SELECT 1
            FROM dbo.tblAlignerBatches b2
            WHERE b2.AlignerSetID = dbo.tblAlignerSets.AlignerSetID
              AND b2.ManufactureDate IS NULL
        ) THEN 'needs_mfg'
        ELSE 'all_delivered'
    END AS LabStatus,
    dbo.tblAlignerSets.WorkID,
    dbo.tblAlignerSets.AlignerDrID,
    dbo.tblwork.PersonID
FROM dbo.tblpatients
INNER JOIN dbo.tblwork ON dbo.tblwork.PersonID = dbo.tblpatients.PersonID
INNER JOIN dbo.tblAlignerSets ON dbo.tblwork.workid = dbo.tblAlignerSets.WorkID
LEFT OUTER JOIN (
    SELECT
        AlignerSetID,
        AlignerBatchID,
        BatchSequence,
        CreationDate,
        ManufactureDate,
        DeliveredToPatientDate,
        BatchExpiryDate,
        Notes,
        IsLast,
        IsActive,
        ROW_NUMBER() OVER (
            PARTITION BY AlignerSetID
            ORDER BY CASE WHEN IsActive = 1 THEN 0 ELSE 1 END, BatchSequence DESC
        ) AS RowNum
    FROM dbo.tblAlignerBatches
) lb ON dbo.tblAlignerSets.AlignerSetID = lb.AlignerSetID AND lb.RowNum = 1
WHERE dbo.tblwork.Typeofwork = 19
   OR dbo.tblwork.Typeofwork = 20
   OR dbo.tblwork.Typeofwork = 21;

GO
/****** Object:  Table [dbo].[tblappointments]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
SET ANSI_PADDING ON
GO
CREATE TABLE [dbo].[tblappointments](
	[appointmentID] [int] IDENTITY(1,1) NOT NULL,
	[PersonID] [int] NOT NULL,
	[AppDetail] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[WantNotify] [bit] NULL,
	[Notified] [bit] NULL,
	[SMSStatus] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[Present] [time](0) NULL,
	[Seated] [time](0) NULL,
	[Dismissed] [time](0) NULL,
	[SSMA_TimeStamp] [timestamp] NOT NULL,
	[AppDate] [datetime2](0) NOT NULL,
	[AppDay]  AS (CONVERT([date],[Appdate])) PERSISTED,
	[AppCost] [nvarchar](50) COLLATE Arabic_CI_AS NULL,
	[SentWa] [bit] NULL,
	[DeliveredWa] [nvarchar](50) COLLATE Arabic_CI_AS NULL,
	[WantWa] [bit] NULL,
	[WaMessageID] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[sms_sid] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[AppTime]  AS (CONVERT([time],[AppDate])) PERSISTED,
	[DrID] [int] NULL,
	[LastUpdated] [datetime] NULL,
	[SentTimestamp] [datetime] NULL,
	[DeliveredTimestamp] [datetime] NULL,
	[ReadTimestamp] [datetime] NULL,
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
SET ANSI_PADDING OFF
GO
SET ANSI_PADDING ON

GO
/****** Object:  Index [IX_ID]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE UNIQUE CLUSTERED INDEX [IX_ID] ON [dbo].[tblappointments]
(
	[appointmentID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, IGNORE_DUP_KEY = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  View [dbo].[VLastApp]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE VIEW dbo.VLastApp
WITH SCHEMABINDING 
AS
SELECT dbo.tblappointments.PersonID, dbo.tblappointments.AppDate, dbo.tblappointments.appointmentID, dbo.tblappointments.AppTime
FROM  dbo.tblappointments INNER JOIN
             (SELECT PersonID, MAX(AppDate) AS MaxDate
           FROM   dbo.tblappointments AS tblappointments_1
           GROUP BY PersonID) AS T ON T.PersonID = dbo.tblappointments.PersonID AND T.MaxDate = dbo.tblappointments.AppDate
WHERE (dbo.tblappointments.AppDate > GETDATE())

GO
/****** Object:  View [dbo].[VIQD]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER OFF
GO
-- Migration: Create new statistics views using USDReceived/IQDReceived fields
-- Date: 2025-11-10
-- Description: Replace old views with new ones that properly handle dual-currency payments

-- Create new VIQD view using IQDReceived field
CREATE VIEW dbo.VIQD
AS
SELECT
    Dateofpayment AS Day,
    SUM(IQDReceived) AS SumIQD,
    MONTH(Dateofpayment) AS month,
    YEAR(Dateofpayment) AS Year
FROM dbo.tblInvoice
WHERE IQDReceived > 0
GROUP BY Dateofpayment;

GO
/****** Object:  View [dbo].[VUSD]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER OFF
GO

-- Create new VUSD view using USDReceived field
CREATE VIEW dbo.VUSD
AS
SELECT
    Dateofpayment AS Day,
    SUM(USDReceived) AS SumUSD,
    MONTH(Dateofpayment) AS month,
    YEAR(Dateofpayment) AS Year
FROM dbo.tblInvoice
WHERE USDReceived > 0
GROUP BY Dateofpayment;

GO
/****** Object:  Table [dbo].[tblExpenses]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblExpenses](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[expenseDate] [date] NOT NULL,
	[Amount] [int] NOT NULL,
	[Currency] [nchar](10) COLLATE Arabic_CI_AS NULL,
	[Note] [nvarchar](100) COLLATE Arabic_CI_AS NULL,
	[CategoryID] [int] NULL,
	[SubcategoryID] [int] NULL,
 CONSTRAINT [PK_tblExpenses] PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
/****** Object:  View [dbo].[V_EIQ]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER OFF
GO

-- Create new V_EIQ view for IQD expenses (same as old)
CREATE VIEW dbo.V_EIQ
AS
SELECT
    expenseDate AS EIDateQ,
    -SUM(Amount) AS SumExQ
FROM dbo.tblExpenses
WHERE Currency = 'IQD'
GROUP BY expenseDate;

GO
/****** Object:  View [dbo].[V_TodayPayment]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE VIEW dbo.V_TodayPayment
AS
SELECT i.workid, i.Amountpaid, i.Dateofpayment
FROM   dbo.tblInvoice AS i INNER JOIN
                 (SELECT workid, MAX(Dateofpayment) AS LastPayment
                 FROM    dbo.tblInvoice
                 GROUP BY workid) AS w ON w.workid = i.workid AND w.LastPayment = i.Dateofpayment
WHERE (w.LastPayment = CAST(GETDATE() AS date))

GO
/****** Object:  View [dbo].[V_EI$]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER OFF
GO

-- Create new V_EI$ view for USD expenses (same as old)
CREATE VIEW dbo.V_EI$
AS
SELECT
    expenseDate AS EIDate,
    -SUM(Amount) AS SumEx$
FROM dbo.tblExpenses
WHERE Currency = 'USD'
GROUP BY expenseDate;

GO
/****** Object:  View [dbo].[VWIQD]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER OFF
GO

-- Create new VWIQD view combining payments and expenses
CREATE VIEW dbo.VWIQD
AS
SELECT
    ISNULL(V.Day, E.EIDateQ) AS Day,
    V.SumIQD,
    E.SumExQ,
    ISNULL(V.SumIQD, 0) + ISNULL(E.SumExQ, 0) AS FinalIQDSum
FROM dbo.VIQD AS V
FULL OUTER JOIN dbo.V_EIQ AS E ON V.Day = E.EIDateQ;

GO
/****** Object:  View [dbo].[VWUSD]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER OFF
GO

-- Create new VWUSD view combining payments and expenses
CREATE VIEW dbo.VWUSD
AS
SELECT
    ISNULL(V.Day, E.EIDate) AS Day,
    V.SumUSD,
    E.SumEx$,
    ISNULL(V.SumUSD, 0) + ISNULL(E.SumEx$, 0) AS FinalUSDSum
FROM dbo.VUSD AS V
FULL OUTER JOIN dbo.V_EI$ AS E ON V.Day = E.EIDate;

GO
/****** Object:  Table [dbo].[tblvideos]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblvideos](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[Description] [nvarchar](255) COLLATE Arabic_CI_AS NOT NULL,
	[Category] [int] NULL,
	[URL] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[Details] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[FileName] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[VideoExtension] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
 CONSTRAINT [tblvideos$PrimaryKey] PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
/****** Object:  Table [dbo].[tbloptions]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tbloptions](
	[OptionName] [nvarchar](255) COLLATE Arabic_CI_AS NOT NULL,
	[OptionValue] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
 CONSTRAINT [tbloptions$PrimaryKey] PRIMARY KEY CLUSTERED 
(
	[OptionName] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
/****** Object:  View [dbo].[V_Videos]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE VIEW dbo.V_Videos
AS
WITH CTE(Path) AS (SELECT OptionValue
                                        FROM      dbo.tbloptions
                                        WHERE   (OptionName = 'VideosPath'))
    SELECT dbo.tblvideos.ID, dbo.tblvideos.Description, CTE_1.Path + dbo.tblvideos.FileName + '.' + dbo.tblvideos.VideoExtension AS Video, CTE_1.Path + dbo.tblvideos.FileName + '.jpg' AS Image, dbo.tblvideos.Category, dbo.tblvideos.Details
    FROM     dbo.tblvideos CROSS JOIN
                      CTE AS CTE_1

GO
/****** Object:  Table [dbo].[tblnumbers]    Script Date: 5/27/2026 7:11:45 PM ******/
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
/****** Object:  View [dbo].[CalStep1]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE VIEW [dbo].[CalStep1]
AS
SELECT        DATEADD(day, Mynumber, CONVERT(date, GETDATE())) AS PreCal
FROM            dbo.tblnumbers

GO
/****** Object:  Table [dbo].[tblholidays]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblholidays](
	[Holidaydate] [date] NOT NULL,
	[Description] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[HolidayName] [nvarchar](100) COLLATE Arabic_CI_AS NOT NULL,
 CONSTRAINT [tblholidays$PrimaryKey] PRIMARY KEY CLUSTERED 
(
	[Holidaydate] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
/****** Object:  View [dbo].[CalStep2]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE VIEW dbo.CalStep2
AS
SELECT        dbo.CalStep1.PreCal
FROM            dbo.CalStep1 LEFT OUTER JOIN
                         dbo.tblholidays ON dbo.CalStep1.PreCal = dbo.tblholidays.Holidaydate
WHERE        (dbo.tblholidays.Holidaydate IS NULL) AND (DATEPART(dw, dbo.CalStep1.PreCal) <> 6)

GO
/****** Object:  Table [dbo].[tbltimes]    Script Date: 5/27/2026 7:11:45 PM ******/
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
/****** Object:  View [dbo].[VFillCal]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE VIEW dbo.VFillCal
AS
SELECT        CAST(CAST(dbo.CalStep2.PreCal AS datetime) + CAST(dbo.tbltimes.MyTime AS datetime) AS datetime2(0)) AS MyDates
FROM            dbo.CalStep2 CROSS JOIN
                         dbo.tbltimes

GO
/****** Object:  View [dbo].[V_Report]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
/* Alter View V_Report*/
CREATE VIEW dbo.V_Report
AS
SELECT   dbo.tblpatients.PersonID, dbo.tblpatients.PatientName, dbo.tblpatients.Phone, dbo.VTotPaid.TotalPaid, dbo.VLastApp.AppDate, dbo.V_TodayPayment.Dateofpayment, dbo.V_TodayPayment.Amountpaid, dbo.tblwork.workid, dbo.tblwork.TotalRequired, dbo.tblwork.Currency
FROM     dbo.VLastApp RIGHT OUTER JOIN
             dbo.tblwork LEFT OUTER JOIN
             dbo.V_TodayPayment ON dbo.tblwork.workid = dbo.V_TodayPayment.workid LEFT OUTER JOIN
             dbo.VTotPaid ON dbo.tblwork.workid = dbo.VTotPaid.workid RIGHT OUTER JOIN
             dbo.tblpatients ON dbo.tblwork.PersonID = dbo.tblpatients.PersonID ON dbo.VLastApp.PersonID = dbo.tblpatients.PersonID

GO
/****** Object:  Table [dbo].[tblWires]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblWires](
	[Wire_ID] [int] IDENTITY(1,1) NOT NULL,
	[Wire] [nvarchar](255) COLLATE Arabic_CI_AS NOT NULL,
 CONSTRAINT [tblWires$PrimaryKey] PRIMARY KEY CLUSTERED 
(
	[Wire_ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
/****** Object:  View [dbo].[qrylastUwire]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE VIEW dbo.qrylastUwire
AS
SELECT        dbo.tblWires.Wire_ID, dbo.tblWires.Wire, dbo.V_lastvisit.WorkID
FROM            dbo.V_lastvisit INNER JOIN
                         dbo.tblvisits ON dbo.V_lastvisit.LastVisit = dbo.tblvisits.VisitDate AND dbo.V_lastvisit.WorkID = dbo.tblvisits.WorkID LEFT OUTER JOIN
                         dbo.tblWires ON dbo.tblvisits.UpperWireID = dbo.tblWires.Wire_ID

GO
/****** Object:  View [dbo].[qrylastLwire]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE VIEW dbo.qrylastLwire
AS
SELECT        dbo.tblWires.Wire_ID, dbo.tblWires.Wire, dbo.V_lastvisit.WorkID
FROM            dbo.V_lastvisit INNER JOIN
                         dbo.tblvisits ON dbo.V_lastvisit.LastVisit = dbo.tblvisits.VisitDate AND dbo.V_lastvisit.WorkID = dbo.tblvisits.WorkID LEFT OUTER JOIN
                         dbo.tblWires ON dbo.tblvisits.LowerWireID = dbo.tblWires.Wire_ID

GO
/****** Object:  View [dbo].[V_rptNoWork]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE VIEW dbo.V_rptNoWork
AS
SELECT dbo.tblpatients.PersonID, dbo.tblpatients.PatientName, dbo.tblpatients.Phone, dbo.VLastApp.AppDate
FROM  dbo.tblpatients LEFT OUTER JOIN
         dbo.VLastApp ON dbo.tblpatients.PersonID = dbo.VLastApp.PersonID

GO
/****** Object:  Table [dbo].[AlignerDoctors]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
SET ANSI_PADDING ON
GO
CREATE TABLE [dbo].[AlignerDoctors](
	[DrID] [int] IDENTITY(1,1) NOT NULL,
	[DoctorName] [nvarchar](255) COLLATE Arabic_CI_AS NOT NULL,
	[LogoPath] [nvarchar](500) COLLATE Arabic_CI_AS NULL,
	[DoctorEmail] [varchar](255) COLLATE Arabic_CI_AS NULL,
PRIMARY KEY CLUSTERED 
(
	[DrID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
SET ANSI_PADDING OFF
GO
/****** Object:  Table [dbo].[DocumentTemplates]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[DocumentTemplates](
	[template_id] [int] IDENTITY(1,1) NOT NULL,
	[template_name] [nvarchar](100) COLLATE Arabic_CI_AS NOT NULL,
	[description] [nvarchar](500) COLLATE Arabic_CI_AS NULL,
	[document_type_id] [int] NOT NULL,
	[paper_width] [int] NOT NULL,
	[paper_height] [int] NOT NULL,
	[paper_orientation] [nvarchar](20) COLLATE Arabic_CI_AS NULL,
	[paper_margin_top] [int] NULL,
	[paper_margin_right] [int] NULL,
	[paper_margin_bottom] [int] NULL,
	[paper_margin_left] [int] NULL,
	[background_color] [nvarchar](20) COLLATE Arabic_CI_AS NULL,
	[show_grid] [bit] NULL,
	[grid_size] [int] NULL,
	[is_default] [bit] NULL,
	[is_active] [bit] NULL,
	[is_system] [bit] NULL,
	[template_version] [int] NULL,
	[parent_template_id] [int] NULL,
	[created_by] [nvarchar](100) COLLATE Arabic_CI_AS NULL,
	[created_date] [datetime] NULL,
	[modified_by] [nvarchar](100) COLLATE Arabic_CI_AS NULL,
	[modified_date] [datetime] NULL,
	[last_used_date] [datetime] NULL,
	[template_file_path] [nvarchar](500) COLLATE Arabic_CI_AS NULL,
PRIMARY KEY CLUSTERED 
(
	[template_id] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
/****** Object:  Table [dbo].[DocumentTypes]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[DocumentTypes](
	[type_id] [int] IDENTITY(1,1) NOT NULL,
	[type_code] [nvarchar](50) COLLATE Arabic_CI_AS NOT NULL,
	[type_name] [nvarchar](100) COLLATE Arabic_CI_AS NOT NULL,
	[description] [nvarchar](500) COLLATE Arabic_CI_AS NULL,
	[icon] [nvarchar](50) COLLATE Arabic_CI_AS NULL,
	[default_paper_width] [int] NULL,
	[default_paper_height] [int] NULL,
	[default_orientation] [nvarchar](20) COLLATE Arabic_CI_AS NULL,
	[is_active] [bit] NULL,
	[sort_order] [int] NULL,
PRIMARY KEY CLUSTERED 
(
	[type_id] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY],
UNIQUE NONCLUSTERED 
(
	[type_code] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
/****** Object:  Table [dbo].[Patients]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
SET ANSI_PADDING ON
GO
CREATE TABLE [dbo].[Patients](
	[patID] [uniqueidentifier] ROWGUIDCOL  NOT NULL,
	[patName] [varchar](50) COLLATE Arabic_CI_AS NULL,
	[patFirstName] [varchar](50) COLLATE Arabic_CI_AS NULL,
	[patLastName] [varchar](50) COLLATE Arabic_CI_AS NULL,
	[patPhone1] [varchar](50) COLLATE Arabic_CI_AS NULL,
	[patGender] [char](1) COLLATE Arabic_CI_AS NULL,
	[patBirthdate] [datetime] NULL,
	[patOtherID] [varchar](50) COLLATE Arabic_CI_AS NULL
) ON [PRIMARY]

GO
SET ANSI_PADDING OFF
GO
/****** Object:  Table [dbo].[SyncQueue]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
SET ANSI_PADDING ON
GO
CREATE TABLE [dbo].[SyncQueue](
	[QueueID] [int] IDENTITY(1,1) NOT NULL,
	[TableName] [varchar](50) COLLATE Arabic_CI_AS NOT NULL,
	[RecordID] [int] NOT NULL,
	[Operation] [varchar](10) COLLATE Arabic_CI_AS NOT NULL,
	[JsonData] [nvarchar](max) COLLATE Arabic_CI_AS NULL,
	[CreatedAt] [datetime] NULL,
	[Attempts] [int] NULL,
	[LastAttempt] [datetime] NULL,
	[LastError] [nvarchar](500) COLLATE Arabic_CI_AS NULL,
	[Status] [varchar](20) COLLATE Arabic_CI_AS NULL,
PRIMARY KEY CLUSTERED 
(
	[QueueID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]

GO
SET ANSI_PADDING OFF
GO
/****** Object:  Table [dbo].[tbCities]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tbCities](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[City] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
 CONSTRAINT [tbCities$PrimaryKey] PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
/****** Object:  Table [dbo].[tblAddress]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblAddress](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[Zone] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[CityID] [int] NULL,
 CONSTRAINT [tblAddress$PrimaryKey] PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
/****** Object:  Table [dbo].[tblAlerts]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblAlerts](
	[AlertID] [int] IDENTITY(1,1) NOT NULL,
	[PersonID] [int] NOT NULL,
	[AlertTypeID] [int] NOT NULL,
	[AlertSeverity] [int] NOT NULL,
	[AlertDetails] [nvarchar](max) COLLATE Arabic_CI_AS NULL,
	[CreationDate] [datetime] NOT NULL,
	[IsActive] [bit] NOT NULL,
PRIMARY KEY CLUSTERED 
(
	[AlertID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]

GO
/****** Object:  Table [dbo].[tblAlertTypes]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblAlertTypes](
	[AlertTypeID] [int] IDENTITY(1,1) NOT NULL,
	[TypeName] [nvarchar](100) COLLATE Arabic_CI_AS NOT NULL,
PRIMARY KEY CLUSTERED 
(
	[AlertTypeID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY],
UNIQUE NONCLUSTERED 
(
	[TypeName] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
/****** Object:  Table [dbo].[tblAlignerActivityFlags]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblAlignerActivityFlags](
	[ActivityID] [int] IDENTITY(1,1) NOT NULL,
	[AlignerSetID] [int] NOT NULL,
	[ActivityType] [nvarchar](50) COLLATE Arabic_CI_AS NOT NULL,
	[ActivityDescription] [nvarchar](500) COLLATE Arabic_CI_AS NOT NULL,
	[CreatedAt] [datetime] NULL,
	[IsRead] [bit] NULL,
	[ReadAt] [datetime] NULL,
	[RelatedRecordID] [int] NULL,
PRIMARY KEY CLUSTERED 
(
	[ActivityID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
/****** Object:  Table [dbo].[tblAlignerNotes]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
SET ANSI_PADDING ON
GO
CREATE TABLE [dbo].[tblAlignerNotes](
	[NoteID] [int] IDENTITY(1,1) NOT NULL,
	[AlignerSetID] [int] NOT NULL,
	[NoteType] [varchar](20) COLLATE Arabic_CI_AS NOT NULL,
	[NoteText] [nvarchar](max) COLLATE Arabic_CI_AS NOT NULL,
	[CreatedAt] [datetime] NULL,
	[IsEdited] [bit] NULL,
	[EditedAt] [datetime] NULL,
	[IsRead] [bit] NOT NULL,
PRIMARY KEY CLUSTERED 
(
	[NoteID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]

GO
SET ANSI_PADDING OFF
GO
/****** Object:  Table [dbo].[tblbends]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblbends](
	[Bend_ID] [int] IDENTITY(1,1) NOT NULL,
	[Bend] [nvarchar](255) COLLATE Arabic_CI_AS NOT NULL,
 CONSTRAINT [tblbends$Bends_ID] PRIMARY KEY CLUSTERED 
(
	[Bend_ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
/****** Object:  Table [dbo].[tblCalender]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblCalender](
	[AppDate] [datetime2](0) NOT NULL
) ON [PRIMARY]

GO
/****** Object:  Index [IX_Calender]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE UNIQUE CLUSTERED INDEX [IX_Calender] ON [dbo].[tblCalender]
(
	[AppDate] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, IGNORE_DUP_KEY = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[tblCarriedWires]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
SET ANSI_PADDING ON
GO
CREATE TABLE [dbo].[tblCarriedWires](
	[Id] [int] IDENTITY(1,1) NOT NULL,
	[PersonID] [int] NOT NULL,
	[WireBag] [varchar](50) COLLATE Arabic_CI_AS NOT NULL,
	[WireSlot] [int] NOT NULL,
	[Wire_ID] [int] NOT NULL,
	[UpperLower] [varchar](10) COLLATE Arabic_CI_AS NOT NULL,
	[AdditionDate] [date] NOT NULL,
 CONSTRAINT [PK_tblCarriedWires] PRIMARY KEY CLUSTERED 
(
	[Id] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
SET ANSI_PADDING OFF
GO
/****** Object:  Table [dbo].[tblDetail]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblDetail](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[Detail] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
 CONSTRAINT [tblDetail$PrimaryKey] PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
/****** Object:  Table [dbo].[tblDiagnosis]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblDiagnosis](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[DxDate] [datetime2](0) NULL,
	[WorkID] [int] NOT NULL,
	[Diagnosis] [nvarchar](255) COLLATE Arabic_CI_AS NOT NULL,
	[TreatmentPlan] [nvarchar](255) COLLATE Arabic_CI_AS NOT NULL,
	[ChiefComplain] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[fAnteroPosterior] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[fVertical] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[fTransverse] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[fLipCompetence] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[fNasoLabialAngle] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[fUpperIncisorShowRest] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[fUpperIncisorShowSmile] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[ITeethPresent] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[IDentalHealth] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[ILowerCrowding] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[ILowerIncisorInclination] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[ICurveofSpee] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[IUpperCrowding] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[IUpperIncisorInclination] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[OIncisorRelation] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[OOverjet] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[OOverbite] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[OCenterlines] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[OMolarRelation] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[OCanineRelation] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[OFunctionalOcclusion] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[C_SNA] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[C_SNB] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[C_ANB] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[C_SNMx] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[C_Wits] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[C_FMA] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[C_MMA] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[C_UIMX] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[C_LIMd] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[C_UI_LI] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[C_LI_APo] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[C_Ulip_E] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[C_Llip_E] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[C_Naso_lip] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[C_TAFH] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[C_UAFH] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[C_LAFH] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[C_PercentLAFH] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[Appliance] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
 CONSTRAINT [tblDiagnosis$PrimaryKey] PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
/****** Object:  Table [dbo].[tblElastics]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblElastics](
	[Elastic_ID] [int] IDENTITY(1,1) NOT NULL,
	[Elastic] [nvarchar](255) COLLATE Arabic_CI_AS NOT NULL,
 CONSTRAINT [tblElastics$PrimaryKey] PRIMARY KEY CLUSTERED 
(
	[Elastic_ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
/****** Object:  Table [dbo].[tblEmployees]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblEmployees](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[employeeName] [nvarchar](50) COLLATE Arabic_CI_AS NOT NULL,
	[Position] [int] NULL,
	[Email] [nvarchar](50) COLLATE Arabic_CI_AS NULL,
	[Phone] [nvarchar](50) COLLATE Arabic_CI_AS NULL,
	[Percentage] [bit] NOT NULL,
	[receiveEmail] [bit] NOT NULL,
	[getAppointments] [bit] NOT NULL,
	[SortOrder] [int] NOT NULL,
	[AppointmentColor] [nvarchar](20) COLLATE Arabic_CI_AS NULL,
 CONSTRAINT [PK__tblEmplo__3214EC2785CA47DB] PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
/****** Object:  Table [dbo].[tblEndo]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblEndo](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[DetailID] [int] NULL,
	[Canal] [nchar](10) COLLATE Arabic_CI_AS NULL,
	[RefrencePoint] [nchar](10) COLLATE Arabic_CI_AS NULL,
	[WorkingLength] [decimal](3, 1) NULL,
	[Curvature] [nvarchar](50) COLLATE Arabic_CI_AS NULL,
	[Note] [nvarchar](max) COLLATE Arabic_CI_AS NULL,
 CONSTRAINT [PK_tblEndo] PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]

GO
/****** Object:  Table [dbo].[tblEstimatedCostPresets]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblEstimatedCostPresets](
	[PresetID] [int] IDENTITY(1,1) NOT NULL,
	[Amount] [decimal](18, 2) NOT NULL,
	[Currency] [nvarchar](10) COLLATE Arabic_CI_AS NOT NULL,
	[DisplayOrder] [int] NULL,
PRIMARY KEY CLUSTERED 
(
	[PresetID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
/****** Object:  Table [dbo].[tblExpenseCategories]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblExpenseCategories](
	[CategoryID] [int] IDENTITY(1,1) NOT NULL,
	[CategoryName] [nvarchar](50) COLLATE Arabic_CI_AS NOT NULL,
PRIMARY KEY CLUSTERED 
(
	[CategoryID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
/****** Object:  Table [dbo].[tblExpenseSubcategories]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblExpenseSubcategories](
	[SubcategoryID] [int] IDENTITY(1,1) NOT NULL,
	[SubcategoryName] [nvarchar](100) COLLATE Arabic_CI_AS NOT NULL,
	[CategoryID] [int] NOT NULL,
 CONSTRAINT [PK__tblExpen__9C4E707D6C548634] PRIMARY KEY CLUSTERED 
(
	[SubcategoryID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY],
 CONSTRAINT [UQ_Category_Subcategory] UNIQUE NONCLUSTERED 
(
	[SubcategoryID] ASC,
	[CategoryID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY],
 CONSTRAINT [UQ_ExpenseSubcat_Category_Name] UNIQUE NONCLUSTERED 
(
	[CategoryID] ASC,
	[SubcategoryName] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
/****** Object:  Table [dbo].[tblGender]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblGender](
	[Gender_ID] [int] NOT NULL,
	[Gender] [nvarchar](255) COLLATE Arabic_CI_AS NOT NULL,
 CONSTRAINT [tblGender$PrimaryKey1] PRIMARY KEY CLUSTERED 
(
	[Gender_ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
/****** Object:  Table [dbo].[tblImplant]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblImplant](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[WorkID] [int] NOT NULL,
	[Tooth] [nchar](10) COLLATE Arabic_CI_AS NULL,
	[ImplantLength] [decimal](3, 1) NULL,
	[ImplantDiameter] [decimal](3, 1) NULL,
	[ImplantCompany] [nvarchar](50) COLLATE Arabic_CI_AS NULL,
	[Note] [nvarchar](100) COLLATE Arabic_CI_AS NULL,
 CONSTRAINT [PK_tblImplant] PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
/****** Object:  Table [dbo].[tblImplantManufacturer]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblImplantManufacturer](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[ManufacturerName] [nvarchar](255) COLLATE Arabic_CI_AS NOT NULL,
PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
/****** Object:  Table [dbo].[tblKeyWord]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblKeyWord](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[KeyWord] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
 CONSTRAINT [tblKeyWord$PrimaryKey] PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
/****** Object:  Table [dbo].[tblMessageStatusHistory]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblMessageStatusHistory](
	[StatusHistoryID] [int] IDENTITY(1,1) NOT NULL,
	[AppointmentID] [int] NOT NULL,
	[WaMessageID] [nvarchar](100) COLLATE Arabic_CI_AS NOT NULL,
	[StatusCode] [int] NOT NULL,
	[StatusText] [nvarchar](50) COLLATE Arabic_CI_AS NOT NULL,
	[Timestamp] [datetime] NOT NULL,
PRIMARY KEY CLUSTERED 
(
	[StatusHistoryID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
/****** Object:  Table [dbo].[tblOldOPG]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblOldOPG](
	[ID] [int] NOT NULL,
	[last_name] [nvarchar](50) COLLATE Arabic_CI_AS NOT NULL,
	[first_name] [nvarchar](50) COLLATE Arabic_CI_AS NOT NULL,
	[sex] [nvarchar](50) COLLATE Arabic_CI_AS NOT NULL,
	[birth_date] [datetime2](7) NULL,
	[directory] [nvarchar](50) COLLATE Arabic_CI_AS NOT NULL,
 CONSTRAINT [PK_tblFiles] PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
/****** Object:  Table [dbo].[tblPatientPortalAuth]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblPatientPortalAuth](
	[PersonID] [int] NOT NULL,
	[PinHash] [nvarchar](255) COLLATE Arabic_CI_AS NOT NULL,
	[Enabled] [bit] NOT NULL,
	[FailedAttempts] [int] NOT NULL,
	[LockedUntil] [datetime2](7) NULL,
	[LastLoginAt] [datetime2](7) NULL,
	[CreatedAt] [datetime2](7) NOT NULL,
	[UpdatedAt] [datetime2](7) NOT NULL,
PRIMARY KEY CLUSTERED 
(
	[PersonID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
/****** Object:  Table [dbo].[tblPatientType]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
SET ANSI_PADDING ON
GO
CREATE TABLE [dbo].[tblPatientType](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[PatientType] [varchar](50) COLLATE Arabic_CI_AS NULL,
 CONSTRAINT [PK_tblPatientType] PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
SET ANSI_PADDING OFF
GO
/****** Object:  Table [dbo].[tblPositions]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
SET ANSI_PADDING ON
GO
CREATE TABLE [dbo].[tblPositions](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[PositionName] [varchar](20) COLLATE Arabic_CI_AS NULL,
PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
SET ANSI_PADDING OFF
GO
/****** Object:  Table [dbo].[tblPrivatePhotos]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblPrivatePhotos](
	[PersonID] [int] NOT NULL,
	[TimepointCode] [nvarchar](10) COLLATE Arabic_CI_AS NOT NULL,
	[ImageName] [nvarchar](50) COLLATE Arabic_CI_AS NOT NULL,
	[MarkedBy] [int] NULL,
	[MarkedAt] [datetime2](7) NOT NULL,
 CONSTRAINT [PK_PrivatePhotos] PRIMARY KEY CLUSTERED 
(
	[PersonID] ASC,
	[TimepointCode] ASC,
	[ImageName] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
/****** Object:  Table [dbo].[tblReferrals]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblReferrals](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[Referral] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
 CONSTRAINT [tblReferrals$PrimaryKey] PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
/****** Object:  Table [dbo].[tblscrews]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblscrews](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[WorkID] [int] NULL,
	[PersonID] [int] NOT NULL,
	[PlacementDate] [datetime2](0) NULL,
	[Position] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[State] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
 CONSTRAINT [tblscrews$PrimaryKey] PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
/****** Object:  Table [dbo].[tblsms]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblsms](
	[id] [int] IDENTITY(1,1) NOT NULL,
	[date] [date] NOT NULL,
	[smssent] [bit] NOT NULL,
	[SMSID] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[emailsent] [bit] NOT NULL,
	[ExchangeRate] [int] NULL,
 CONSTRAINT [tblsms$PrimaryKey] PRIMARY KEY CLUSTERED 
(
	[id] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
/****** Object:  Table [dbo].[tblStandCategories]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblStandCategories](
	[CategoryID] [int] IDENTITY(1,1) NOT NULL,
	[CategoryName] [nvarchar](100) COLLATE Arabic_CI_AS NOT NULL,
	[IsActive] [bit] NOT NULL,
PRIMARY KEY CLUSTERED 
(
	[CategoryID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY],
UNIQUE NONCLUSTERED 
(
	[CategoryName] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
/****** Object:  Table [dbo].[tblStandItems]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblStandItems](
	[ItemID] [int] IDENTITY(1,1) NOT NULL,
	[ItemName] [nvarchar](255) COLLATE Arabic_CI_AS NOT NULL,
	[SKU] [nvarchar](50) COLLATE Arabic_CI_AS NULL,
	[Barcode] [nvarchar](100) COLLATE Arabic_CI_AS NULL,
	[CategoryID] [int] NULL,
	[CostPrice] [int] NOT NULL,
	[SellPrice] [int] NOT NULL,
	[CurrentStock] [int] NOT NULL,
	[ReorderLevel] [int] NOT NULL,
	[ExpiryDate] [date] NULL,
	[Unit] [nvarchar](20) COLLATE Arabic_CI_AS NULL,
	[Notes] [nvarchar](500) COLLATE Arabic_CI_AS NULL,
	[IsActive] [bit] NOT NULL,
	[DateAdded] [datetime2](7) NOT NULL,
	[ModifiedDate] [datetime2](7) NULL,
	[CreatedBy] [int] NULL,
PRIMARY KEY CLUSTERED 
(
	[ItemID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
/****** Object:  Table [dbo].[tblStandSaleItems]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblStandSaleItems](
	[SaleItemID] [int] IDENTITY(1,1) NOT NULL,
	[SaleID] [int] NOT NULL,
	[ItemID] [int] NOT NULL,
	[Quantity] [int] NOT NULL,
	[UnitPrice] [int] NOT NULL,
	[UnitCost] [int] NOT NULL,
	[LineTotal] [int] NOT NULL,
PRIMARY KEY CLUSTERED 
(
	[SaleItemID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
/****** Object:  Table [dbo].[tblStandSales]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblStandSales](
	[SaleID] [int] IDENTITY(1,1) NOT NULL,
	[SaleDate] [datetime2](7) NOT NULL,
	[TotalAmount] [int] NOT NULL,
	[TotalCost] [int] NOT NULL,
	[TotalProfit] [int] NOT NULL,
	[AmountPaid] [int] NOT NULL,
	[Change] [int] NOT NULL,
	[PaymentMethod] [nvarchar](20) COLLATE Arabic_CI_AS NOT NULL,
	[CustomerNote] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[PersonID] [int] NULL,
	[CashierID] [int] NULL,
	[VoidedDate] [datetime2](7) NULL,
	[VoidedBy] [int] NULL,
	[VoidReason] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
PRIMARY KEY CLUSTERED 
(
	[SaleID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
/****** Object:  Table [dbo].[tblStandStockMovements]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblStandStockMovements](
	[MovementID] [int] IDENTITY(1,1) NOT NULL,
	[ItemID] [int] NOT NULL,
	[MovementType] [nvarchar](20) COLLATE Arabic_CI_AS NOT NULL,
	[Quantity] [int] NOT NULL,
	[UnitCost] [int] NULL,
	[TotalCost] [int] NULL,
	[RelatedSaleID] [int] NULL,
	[Reason] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
	[MovementDate] [datetime2](7) NOT NULL,
	[PerformedBy] [int] NULL,
PRIMARY KEY CLUSTERED 
(
	[MovementID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
/****** Object:  Table [dbo].[tblTagOptions]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblTagOptions](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[Tag] [nvarchar](50) COLLATE Arabic_CI_AS NOT NULL,
 CONSTRAINT [PK_tblTagOptions] PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
/****** Object:  Table [dbo].[tblToothNumber]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblToothNumber](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[ToothCode] [nvarchar](10) COLLATE Arabic_CI_AS NOT NULL,
	[ToothName] [nvarchar](100) COLLATE Arabic_CI_AS NOT NULL,
	[Quadrant] [nvarchar](2) COLLATE Arabic_CI_AS NOT NULL,
	[ToothNumber] [nvarchar](5) COLLATE Arabic_CI_AS NOT NULL,
	[IsPermanent] [bit] NOT NULL,
	[SortOrder] [int] NOT NULL,
PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY],
UNIQUE NONCLUSTERED 
(
	[ToothCode] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
/****** Object:  Table [dbo].[tblUsers]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblUsers](
	[UserID] [int] IDENTITY(1,1) NOT NULL,
	[Username] [nvarchar](50) COLLATE Arabic_CI_AS NOT NULL,
	[PasswordHash] [nvarchar](255) COLLATE Arabic_CI_AS NOT NULL,
	[FullName] [nvarchar](100) COLLATE Arabic_CI_AS NULL,
	[Role] [nvarchar](50) COLLATE Arabic_CI_AS NULL,
	[IsActive] [bit] NULL,
	[LastLogin] [datetime] NULL,
	[CreatedAt] [datetime] NULL,
	[CreatedBy] [nvarchar](50) COLLATE Arabic_CI_AS NULL,
PRIMARY KEY CLUSTERED 
(
	[UserID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY],
UNIQUE NONCLUSTERED 
(
	[Username] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
/****** Object:  Table [dbo].[tblVidCat]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblVidCat](
	[VidCatID] [int] IDENTITY(1,1) NOT NULL,
	[Category] [nvarchar](255) COLLATE Arabic_CI_AS NULL,
 CONSTRAINT [PK_tblVidCat] PRIMARY KEY CLUSTERED 
(
	[VidCatID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
/****** Object:  Table [dbo].[tblWaiting]    Script Date: 5/27/2026 7:11:45 PM ******/
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
/****** Object:  Table [dbo].[tblWaitReason]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblWaitReason](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[WaitType] [nvarchar](max) COLLATE Arabic_CI_AS NULL
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]

GO
/****** Object:  Table [dbo].[tblWorkItems]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblWorkItems](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[WorkID] [int] NOT NULL,
	[FillingType] [nvarchar](50) COLLATE Arabic_CI_AS NULL,
	[FillingDepth] [nvarchar](50) COLLATE Arabic_CI_AS NULL,
	[CanalsNo] [int] NULL,
	[ItemCost] [int] NULL,
	[StartDate] [date] NULL,
	[CompletedDate] [date] NULL,
	[Note] [nvarchar](max) COLLATE Arabic_CI_AS NULL,
	[WorkingLength] [nvarchar](200) COLLATE Arabic_CI_AS NULL,
	[ImplantLength] [decimal](5, 2) NULL,
	[ImplantDiameter] [decimal](5, 2) NULL,
	[Material] [nvarchar](100) COLLATE Arabic_CI_AS NULL,
	[LabName] [nvarchar](100) COLLATE Arabic_CI_AS NULL,
	[ImplantManufacturerID] [int] NULL,
PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]

GO
/****** Object:  Table [dbo].[tblWorkItemTeeth]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblWorkItemTeeth](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[WorkItemID] [int] NOT NULL,
	[ToothID] [int] NOT NULL,
PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY],
 CONSTRAINT [UQ_WorkItemTeeth] UNIQUE NONCLUSTERED 
(
	[WorkItemID] ASC,
	[ToothID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
/****** Object:  Table [dbo].[tblWorkStatus]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[tblWorkStatus](
	[StatusID] [tinyint] NOT NULL,
	[StatusName] [nvarchar](50) COLLATE Arabic_CI_AS NOT NULL,
PRIMARY KEY CLUSTERED 
(
	[StatusID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
/****** Object:  Table [dbo].[tblWorkType]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
SET ANSI_PADDING ON
GO
CREATE TABLE [dbo].[tblWorkType](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[WorkType] [varchar](50) COLLATE Arabic_CI_AS NOT NULL,
 CONSTRAINT [PK_tblWorkType] PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]

GO
SET ANSI_PADDING OFF
GO
/****** Object:  Index [IX_DocumentTemplates_Default]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [IX_DocumentTemplates_Default] ON [dbo].[DocumentTemplates]
(
	[is_default] ASC,
	[document_type_id] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [IX_DocumentTemplates_Type]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [IX_DocumentTemplates_Type] ON [dbo].[DocumentTemplates]
(
	[document_type_id] ASC,
	[is_active] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
SET ANSI_PADDING ON

GO
/****** Object:  Index [idx_sync_status]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [idx_sync_status] ON [dbo].[SyncQueue]
(
	[Status] ASC,
	[CreatedAt] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
SET ANSI_PADDING ON

GO
/****** Object:  Index [idx_sync_table]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [idx_sync_table] ON [dbo].[SyncQueue]
(
	[TableName] ASC,
	[RecordID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [tblAddress$CityID]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [tblAddress$CityID] ON [dbo].[tblAddress]
(
	[CityID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [tblAddress$ID]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [tblAddress$ID] ON [dbo].[tblAddress]
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [tblAddress$tbCitiestblAddress]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [tblAddress$tbCitiestblAddress] ON [dbo].[tblAddress]
(
	[CityID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [idx_activity_created]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [idx_activity_created] ON [dbo].[tblAlignerActivityFlags]
(
	[CreatedAt] DESC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [idx_activity_set_unread]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [idx_activity_set_unread] ON [dbo].[tblAlignerActivityFlags]
(
	[AlignerSetID] ASC,
	[IsRead] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [IX_tblAlignerBatches_AlignerSetID]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [IX_tblAlignerBatches_AlignerSetID] ON [dbo].[tblAlignerBatches]
(
	[AlignerSetID] ASC
)
INCLUDE([UpperAlignerCount],[LowerAlignerCount],[ManufactureDate],[AlignerBatchID]) WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [IX_tblAlignerBatches_IsLast]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [IX_tblAlignerBatches_IsLast] ON [dbo].[tblAlignerBatches]
(
	[AlignerSetID] ASC,
	[IsLast] ASC
)
WHERE ([IsLast]=(1))
WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [IX_tblAlignerBatches_OneActivePerSet]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE UNIQUE NONCLUSTERED INDEX [IX_tblAlignerBatches_OneActivePerSet] ON [dbo].[tblAlignerBatches]
(
	[AlignerSetID] ASC
)
WHERE ([IsActive]=(1))
WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, IGNORE_DUP_KEY = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [IX_tblAlignerBatches_SetID_MfgDate_BatchID]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [IX_tblAlignerBatches_SetID_MfgDate_BatchID] ON [dbo].[tblAlignerBatches]
(
	[AlignerSetID] ASC,
	[ManufactureDate] ASC,
	[AlignerBatchID] ASC
)
INCLUDE([UpperAlignerCount],[LowerAlignerCount],[UpperAlignerStartSequence],[LowerAlignerStartSequence]) WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [IX_AlignerNotes_CreatedAt]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [IX_AlignerNotes_CreatedAt] ON [dbo].[tblAlignerNotes]
(
	[CreatedAt] DESC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [IX_AlignerNotes_SetID]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [IX_AlignerNotes_SetID] ON [dbo].[tblAlignerNotes]
(
	[AlignerSetID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [IX_tblAlignerSets_OneActivePerWork]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE UNIQUE NONCLUSTERED INDEX [IX_tblAlignerSets_OneActivePerWork] ON [dbo].[tblAlignerSets]
(
	[WorkID] ASC
)
WHERE ([IsActive]=(1))
WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, IGNORE_DUP_KEY = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [IX_Appdate_PID]    Script Date: 5/27/2026 7:11:45 PM ******/
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
/****** Object:  Index [IX_AppDay]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [IX_AppDay] ON [dbo].[tblappointments]
(
	[AppDay] ASC
)
INCLUDE([appointmentID],[Present],[PersonID],[AppDetail],[Seated],[Dismissed],[AppCost],[AppDate],[SSMA_TimeStamp],[WantNotify],[Notified],[SMSStatus]) WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [IX_PID_All]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE UNIQUE NONCLUSTERED INDEX [IX_PID_All] ON [dbo].[tblappointments]
(
	[PersonID] ASC,
	[AppDate] ASC
)
INCLUDE([appointmentID],[AppDetail]) WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, IGNORE_DUP_KEY = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [IX_tblappointments_AppDate_Optimized]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [IX_tblappointments_AppDate_Optimized] ON [dbo].[tblappointments]
(
	[AppDate] ASC
)
INCLUDE([appointmentID],[AppDetail],[DrID],[PersonID],[Present],[Seated],[Dismissed]) WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
SET ARITHABORT ON
SET CONCAT_NULL_YIELDS_NULL ON
SET QUOTED_IDENTIFIER ON
SET ANSI_NULLS ON
SET ANSI_PADDING ON
SET ANSI_WARNINGS ON
SET NUMERIC_ROUNDABORT OFF

GO
/****** Object:  Index [IX_tblappointments_DeliveryStatus]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [IX_tblappointments_DeliveryStatus] ON [dbo].[tblappointments]
(
	[AppDay] ASC,
	[SentWa] ASC,
	[DeliveredWa] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
SET ANSI_PADDING ON

GO
/****** Object:  Index [IX_tblappointments_MessageID]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [IX_tblappointments_MessageID] ON [dbo].[tblappointments]
(
	[WaMessageID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [IX_tblcalender_AppDate_Date]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [IX_tblcalender_AppDate_Date] ON [dbo].[tblCalender]
(
	[AppDate] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [tblDiagnosis$CompIndex]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE UNIQUE NONCLUSTERED INDEX [tblDiagnosis$CompIndex] ON [dbo].[tblDiagnosis]
(
	[ID] ASC,
	[WorkID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, IGNORE_DUP_KEY = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [tblDiagnosis$tblworktblDiagnosis]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [tblDiagnosis$tblworktblDiagnosis] ON [dbo].[tblDiagnosis]
(
	[WorkID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
SET ANSI_PADDING ON

GO
/****** Object:  Index [IX_EstimatedCostPresets_Currency]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [IX_EstimatedCostPresets_Currency] ON [dbo].[tblEstimatedCostPresets]
(
	[Currency] ASC,
	[DisplayOrder] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [tblGender$PrimaryKey]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE UNIQUE NONCLUSTERED INDEX [tblGender$PrimaryKey] ON [dbo].[tblGender]
(
	[Gender_ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, IGNORE_DUP_KEY = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
SET ANSI_PADDING ON

GO
/****** Object:  Index [tblGender$tblGenderGender]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [tblGender$tblGenderGender] ON [dbo].[tblGender]
(
	[Gender] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [Ind_UniqueDate]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE UNIQUE NONCLUSTERED INDEX [Ind_UniqueDate] ON [dbo].[tblInvoice]
(
	[Dateofpayment] ASC,
	[workid] ASC
)
INCLUDE([Amountpaid]) WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, IGNORE_DUP_KEY = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [IX_Statistics]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE UNIQUE NONCLUSTERED INDEX [IX_Statistics] ON [dbo].[tblInvoice]
(
	[workid] ASC,
	[Dateofpayment] ASC
)
INCLUDE([Amountpaid]) WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, IGNORE_DUP_KEY = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [IX_WID_Date_Sum]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [IX_WID_Date_Sum] ON [dbo].[tblInvoice]
(
	[workid] ASC
)
INCLUDE([Amountpaid],[Dateofpayment]) WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
SET ANSI_PADDING ON

GO
/****** Object:  Index [tblKeyWord$KeyWord]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [tblKeyWord$KeyWord] ON [dbo].[tblKeyWord]
(
	[KeyWord] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
SET ANSI_PADDING ON

GO
/****** Object:  Index [IX_Name_ID]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE UNIQUE NONCLUSTERED INDEX [IX_Name_ID] ON [dbo].[tblpatients]
(
	[PatientName] ASC
)
INCLUDE([PersonID]) WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, IGNORE_DUP_KEY = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [IX_Patients_Phone]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [IX_Patients_Phone] ON [dbo].[tblpatients]
(
	[PersonID] ASC
)
INCLUDE([PatientName],[Phone],[patientID],[PatientTypeID],[EstimatedCost],[Currency]) WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [tblpatients$tblAddresstblpatients]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [tblpatients$tblAddresstblpatients] ON [dbo].[tblpatients]
(
	[AddressID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [tblpatients$tblGendertblpatients]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [tblpatients$tblGendertblpatients] ON [dbo].[tblpatients]
(
	[Gender] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
SET ANSI_PADDING ON

GO
/****** Object:  Index [IX_PrivatePhotos_Patient_TP]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [IX_PrivatePhotos_Patient_TP] ON [dbo].[tblPrivatePhotos]
(
	[PersonID] ASC,
	[TimepointCode] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [tblscrews$PersonID]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [tblscrews$PersonID] ON [dbo].[tblscrews]
(
	[PersonID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [tblscrews$tblpatientstblscrews]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [tblscrews$tblpatientstblscrews] ON [dbo].[tblscrews]
(
	[PersonID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [tblscrews$tblworktblscrews]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [tblscrews$tblworktblscrews] ON [dbo].[tblscrews]
(
	[WorkID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [tblscrews$WorkID]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [tblscrews$WorkID] ON [dbo].[tblscrews]
(
	[WorkID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
SET ANSI_PADDING ON

GO
/****** Object:  Index [tblsms$SMSID]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [tblsms$SMSID] ON [dbo].[tblsms]
(
	[SMSID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [IX_StandItems_Active_Expiry]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [IX_StandItems_Active_Expiry] ON [dbo].[tblStandItems]
(
	[IsActive] ASC,
	[ExpiryDate] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [IX_StandItems_CategoryID]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [IX_StandItems_CategoryID] ON [dbo].[tblStandItems]
(
	[CategoryID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
SET ANSI_PADDING ON

GO
/****** Object:  Index [UX_StandItems_Barcode]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE UNIQUE NONCLUSTERED INDEX [UX_StandItems_Barcode] ON [dbo].[tblStandItems]
(
	[Barcode] ASC
)
WHERE ([Barcode] IS NOT NULL)
WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, IGNORE_DUP_KEY = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
SET ANSI_PADDING ON

GO
/****** Object:  Index [UX_StandItems_SKU]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE UNIQUE NONCLUSTERED INDEX [UX_StandItems_SKU] ON [dbo].[tblStandItems]
(
	[SKU] ASC
)
WHERE ([SKU] IS NOT NULL)
WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, IGNORE_DUP_KEY = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [IX_StandSaleItems_ItemID]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [IX_StandSaleItems_ItemID] ON [dbo].[tblStandSaleItems]
(
	[ItemID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [IX_StandSaleItems_SaleID]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [IX_StandSaleItems_SaleID] ON [dbo].[tblStandSaleItems]
(
	[SaleID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [IX_StandSales_CashierID]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [IX_StandSales_CashierID] ON [dbo].[tblStandSales]
(
	[CashierID] ASC
)
WHERE ([CashierID] IS NOT NULL)
WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [IX_StandSales_PersonID]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [IX_StandSales_PersonID] ON [dbo].[tblStandSales]
(
	[PersonID] ASC
)
WHERE ([PersonID] IS NOT NULL)
WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [IX_StandSales_SaleDate]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [IX_StandSales_SaleDate] ON [dbo].[tblStandSales]
(
	[SaleDate] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [IX_StandStockMovements_ItemID]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [IX_StandStockMovements_ItemID] ON [dbo].[tblStandStockMovements]
(
	[ItemID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [IX_StandStockMovements_MovementDate]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [IX_StandStockMovements_MovementDate] ON [dbo].[tblStandStockMovements]
(
	[MovementDate] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
SET ANSI_PADDING ON

GO
/****** Object:  Index [IX_StandStockMovements_MovementType]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [IX_StandStockMovements_MovementType] ON [dbo].[tblStandStockMovements]
(
	[MovementType] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [IDX_Users_IsActive]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [IDX_Users_IsActive] ON [dbo].[tblUsers]
(
	[IsActive] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
SET ANSI_PADDING ON

GO
/****** Object:  Index [IDX_Users_Username]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [IDX_Users_Username] ON [dbo].[tblUsers]
(
	[Username] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [Photo_index]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE UNIQUE NONCLUSTERED INDEX [Photo_index] ON [dbo].[tblvisits]
(
	[WorkID] ASC,
	[IPhoto] ASC
)
WHERE ([Iphoto]=(1))
WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, IGNORE_DUP_KEY = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [PhotoF_index]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE UNIQUE NONCLUSTERED INDEX [PhotoF_index] ON [dbo].[tblvisits]
(
	[WorkID] ASC,
	[FPhoto] ASC
)
WHERE ([Fphoto]=(1))
WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, IGNORE_DUP_KEY = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [tblvisits$LowerWireID]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [tblvisits$LowerWireID] ON [dbo].[tblvisits]
(
	[LowerWireID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
SET ANSI_PADDING ON

GO
/****** Object:  Index [tblvisits$UniqueVisit]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE UNIQUE NONCLUSTERED INDEX [tblvisits$UniqueVisit] ON [dbo].[tblvisits]
(
	[ID] ASC,
	[BracketChange] ASC,
	[WireBending] ASC,
	[OPG] ASC,
	[Others] ASC,
	[NextVisit] ASC,
	[Elastics] ASC,
	[UpperWireID] ASC,
	[LowerWireID] ASC,
	[PPhoto] ASC,
	[IPhoto] ASC,
	[FPhoto] ASC,
	[ApplianceRemoved] ASC,
	[OperatorID] ASC,
	[WorkID] ASC,
	[VisitDate] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, IGNORE_DUP_KEY = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [tblvisits$UpperWireID]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [tblvisits$UpperWireID] ON [dbo].[tblvisits]
(
	[UpperWireID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [tblvisits$WorkID]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [tblvisits$WorkID] ON [dbo].[tblvisits]
(
	[VisitDate] ASC,
	[WorkID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [IX_tblWaiting]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE UNIQUE NONCLUSTERED INDEX [IX_tblWaiting] ON [dbo].[tblWaiting]
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, IGNORE_DUP_KEY = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [IX_tblWaitReason]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE UNIQUE NONCLUSTERED INDEX [IX_tblWaitReason] ON [dbo].[tblWaitReason]
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, IGNORE_DUP_KEY = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [tblWires$Wire_ID]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [tblWires$Wire_ID] ON [dbo].[tblWires]
(
	[Wire_ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
SET ANSI_PADDING ON

GO
/****** Object:  Index [IX_Currency]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE UNIQUE NONCLUSTERED INDEX [IX_Currency] ON [dbo].[tblwork]
(
	[Currency] ASC,
	[workid] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, IGNORE_DUP_KEY = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [IX_tblwork_Status]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [IX_tblwork_Status] ON [dbo].[tblwork]
(
	[Status] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [tblwork$KeyWordID1]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [tblwork$KeyWordID1] ON [dbo].[tblwork]
(
	[KeyWordID1] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [tblwork$KeyWordID2]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [tblwork$KeyWordID2] ON [dbo].[tblwork]
(
	[KeyWordID2] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [tblwork$KeywordID3]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [tblwork$KeywordID3] ON [dbo].[tblwork]
(
	[KeywordID3] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [UNQ_tblWork_Active]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE UNIQUE NONCLUSTERED INDEX [UNQ_tblWork_Active] ON [dbo].[tblwork]
(
	[PersonID] ASC
)
WHERE ([Status]=(1))
WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, IGNORE_DUP_KEY = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [IX_WorkItems_WorkID]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [IX_WorkItems_WorkID] ON [dbo].[tblWorkItems]
(
	[WorkID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [IX_WorkItemTeeth_ToothID]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [IX_WorkItemTeeth_ToothID] ON [dbo].[tblWorkItemTeeth]
(
	[ToothID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
/****** Object:  Index [IX_WorkItemTeeth_WorkItemID]    Script Date: 5/27/2026 7:11:45 PM ******/
CREATE NONCLUSTERED INDEX [IX_WorkItemTeeth_WorkItemID] ON [dbo].[tblWorkItemTeeth]
(
	[WorkItemID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
ALTER TABLE [dbo].[DocumentTemplates] ADD  DEFAULT ('portrait') FOR [paper_orientation]
GO
ALTER TABLE [dbo].[DocumentTemplates] ADD  DEFAULT ((10)) FOR [paper_margin_top]
GO
ALTER TABLE [dbo].[DocumentTemplates] ADD  DEFAULT ((10)) FOR [paper_margin_right]
GO
ALTER TABLE [dbo].[DocumentTemplates] ADD  DEFAULT ((10)) FOR [paper_margin_bottom]
GO
ALTER TABLE [dbo].[DocumentTemplates] ADD  DEFAULT ((10)) FOR [paper_margin_left]
GO
ALTER TABLE [dbo].[DocumentTemplates] ADD  DEFAULT ('#FFFFFF') FOR [background_color]
GO
ALTER TABLE [dbo].[DocumentTemplates] ADD  DEFAULT ((0)) FOR [show_grid]
GO
ALTER TABLE [dbo].[DocumentTemplates] ADD  DEFAULT ((10)) FOR [grid_size]
GO
ALTER TABLE [dbo].[DocumentTemplates] ADD  DEFAULT ((0)) FOR [is_default]
GO
ALTER TABLE [dbo].[DocumentTemplates] ADD  DEFAULT ((1)) FOR [is_active]
GO
ALTER TABLE [dbo].[DocumentTemplates] ADD  DEFAULT ((0)) FOR [is_system]
GO
ALTER TABLE [dbo].[DocumentTemplates] ADD  DEFAULT ((1)) FOR [template_version]
GO
ALTER TABLE [dbo].[DocumentTemplates] ADD  DEFAULT (getdate()) FOR [created_date]
GO
ALTER TABLE [dbo].[DocumentTypes] ADD  DEFAULT ((210)) FOR [default_paper_width]
GO
ALTER TABLE [dbo].[DocumentTypes] ADD  DEFAULT ((297)) FOR [default_paper_height]
GO
ALTER TABLE [dbo].[DocumentTypes] ADD  DEFAULT ('portrait') FOR [default_orientation]
GO
ALTER TABLE [dbo].[DocumentTypes] ADD  DEFAULT ((1)) FOR [is_active]
GO
ALTER TABLE [dbo].[DocumentTypes] ADD  DEFAULT ((0)) FOR [sort_order]
GO
ALTER TABLE [dbo].[SyncQueue] ADD  DEFAULT (getdate()) FOR [CreatedAt]
GO
ALTER TABLE [dbo].[SyncQueue] ADD  DEFAULT ((0)) FOR [Attempts]
GO
ALTER TABLE [dbo].[SyncQueue] ADD  DEFAULT ('Pending') FOR [Status]
GO
ALTER TABLE [dbo].[tblAlerts] ADD  DEFAULT (getdate()) FOR [CreationDate]
GO
ALTER TABLE [dbo].[tblAlerts] ADD  DEFAULT ((1)) FOR [IsActive]
GO
ALTER TABLE [dbo].[tblAlignerActivityFlags] ADD  DEFAULT (getdate()) FOR [CreatedAt]
GO
ALTER TABLE [dbo].[tblAlignerActivityFlags] ADD  DEFAULT ((0)) FOR [IsRead]
GO
ALTER TABLE [dbo].[tblAlignerBatches] ADD  CONSTRAINT [DF_tblAlignerBatches_IsActive]  DEFAULT ((0)) FOR [IsActive]
GO
ALTER TABLE [dbo].[tblAlignerBatches] ADD  DEFAULT ((0)) FOR [IsLast]
GO
ALTER TABLE [dbo].[tblAlignerBatches] ADD  CONSTRAINT [DF_tblAlignerBatches_CreationDate]  DEFAULT (getdate()) FOR [CreationDate]
GO
ALTER TABLE [dbo].[tblAlignerBatches] ADD  CONSTRAINT [DF_tblAlignerBatches_HasUpperTemplate]  DEFAULT ((0)) FOR [HasUpperTemplate]
GO
ALTER TABLE [dbo].[tblAlignerBatches] ADD  CONSTRAINT [DF_tblAlignerBatches_HasLowerTemplate]  DEFAULT ((0)) FOR [HasLowerTemplate]
GO
ALTER TABLE [dbo].[tblAlignerNotes] ADD  DEFAULT (getdate()) FOR [CreatedAt]
GO
ALTER TABLE [dbo].[tblAlignerNotes] ADD  DEFAULT ((0)) FOR [IsEdited]
GO
ALTER TABLE [dbo].[tblAlignerNotes] ADD  DEFAULT ((1)) FOR [IsRead]
GO
ALTER TABLE [dbo].[tblAlignerSets] ADD  CONSTRAINT [DF_tblAlignerSets_IsActive]  DEFAULT ((1)) FOR [IsActive]
GO
ALTER TABLE [dbo].[tblAlignerSets] ADD  DEFAULT ('USD') FOR [Currency]
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
ALTER TABLE [dbo].[tblEmployees] ADD  DEFAULT ((999)) FOR [SortOrder]
GO
ALTER TABLE [dbo].[tblEstimatedCostPresets] ADD  DEFAULT ((0)) FOR [DisplayOrder]
GO
ALTER TABLE [dbo].[tblholidays] ADD  DEFAULT ('Holiday') FOR [HolidayName]
GO
ALTER TABLE [dbo].[tblInvoice] ADD  CONSTRAINT [DF_SysStart]  DEFAULT (sysutcdatetime()) FOR [SysStartTime]
GO
ALTER TABLE [dbo].[tblInvoice] ADD  CONSTRAINT [DF_SysEnd]  DEFAULT (CONVERT([datetime2],'9999-12-31 23:59:59.9999999')) FOR [SysEndTime]
GO
ALTER TABLE [dbo].[tblInvoice] ADD  DEFAULT ((0)) FOR [USDReceived]
GO
ALTER TABLE [dbo].[tblInvoice] ADD  DEFAULT ((0)) FOR [IQDReceived]
GO
ALTER TABLE [dbo].[tblMessageStatusHistory] ADD  DEFAULT (getdate()) FOR [Timestamp]
GO
ALTER TABLE [dbo].[tblnumbers] ADD  DEFAULT ((0)) FOR [Mynumber]
GO
ALTER TABLE [dbo].[tblPatientPortalAuth] ADD  DEFAULT ((1)) FOR [Enabled]
GO
ALTER TABLE [dbo].[tblPatientPortalAuth] ADD  DEFAULT ((0)) FOR [FailedAttempts]
GO
ALTER TABLE [dbo].[tblPatientPortalAuth] ADD  DEFAULT (sysutcdatetime()) FOR [CreatedAt]
GO
ALTER TABLE [dbo].[tblPatientPortalAuth] ADD  DEFAULT (sysutcdatetime()) FOR [UpdatedAt]
GO
ALTER TABLE [dbo].[tblpatients] ADD  CONSTRAINT [DF__tblpatien__DateA__0A9D95DB]  DEFAULT (getdate()) FOR [DateAdded]
GO
ALTER TABLE [dbo].[tblpatients] ADD  CONSTRAINT [DF_tblpatients_Language]  DEFAULT ((0)) FOR [Language]
GO
ALTER TABLE [dbo].[tblPrivatePhotos] ADD  DEFAULT (sysutcdatetime()) FOR [MarkedAt]
GO
ALTER TABLE [dbo].[tblscrews] ADD  DEFAULT ((0)) FOR [WorkID]
GO
ALTER TABLE [dbo].[tblscrews] ADD  DEFAULT ((0)) FOR [PersonID]
GO
ALTER TABLE [dbo].[tblsms] ADD  CONSTRAINT [DF_tblsms_smssent]  DEFAULT ((0)) FOR [smssent]
GO
ALTER TABLE [dbo].[tblsms] ADD  CONSTRAINT [DF_tblsms_emailsent]  DEFAULT ((0)) FOR [emailsent]
GO
ALTER TABLE [dbo].[tblStandCategories] ADD  DEFAULT ((1)) FOR [IsActive]
GO
ALTER TABLE [dbo].[tblStandItems] ADD  DEFAULT ((0)) FOR [CurrentStock]
GO
ALTER TABLE [dbo].[tblStandItems] ADD  DEFAULT ((5)) FOR [ReorderLevel]
GO
ALTER TABLE [dbo].[tblStandItems] ADD  DEFAULT ((1)) FOR [IsActive]
GO
ALTER TABLE [dbo].[tblStandItems] ADD  DEFAULT (sysdatetime()) FOR [DateAdded]
GO
ALTER TABLE [dbo].[tblStandSales] ADD  DEFAULT (sysdatetime()) FOR [SaleDate]
GO
ALTER TABLE [dbo].[tblStandSales] ADD  DEFAULT ((0)) FOR [Change]
GO
ALTER TABLE [dbo].[tblStandSales] ADD  DEFAULT ('cash') FOR [PaymentMethod]
GO
ALTER TABLE [dbo].[tblStandStockMovements] ADD  DEFAULT (sysdatetime()) FOR [MovementDate]
GO
ALTER TABLE [dbo].[tblToothNumber] ADD  DEFAULT ((1)) FOR [IsPermanent]
GO
ALTER TABLE [dbo].[tblUsers] ADD  DEFAULT ('user') FOR [Role]
GO
ALTER TABLE [dbo].[tblUsers] ADD  DEFAULT ((1)) FOR [IsActive]
GO
ALTER TABLE [dbo].[tblUsers] ADD  DEFAULT (getdate()) FOR [CreatedAt]
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
ALTER TABLE [dbo].[tblwork] ADD  CONSTRAINT [DF__tblwork__Additio__10566F31]  DEFAULT (getdate()) FOR [AdditionDate]
GO
ALTER TABLE [dbo].[tblwork] ADD  DEFAULT ((1)) FOR [Status]
GO
ALTER TABLE [dbo].[DocumentTemplates]  WITH CHECK ADD  CONSTRAINT [FK_DocumentTemplates_Parent] FOREIGN KEY([parent_template_id])
REFERENCES [dbo].[DocumentTemplates] ([template_id])
GO
ALTER TABLE [dbo].[DocumentTemplates] CHECK CONSTRAINT [FK_DocumentTemplates_Parent]
GO
ALTER TABLE [dbo].[DocumentTemplates]  WITH CHECK ADD  CONSTRAINT [FK_DocumentTemplates_Type] FOREIGN KEY([document_type_id])
REFERENCES [dbo].[DocumentTypes] ([type_id])
GO
ALTER TABLE [dbo].[DocumentTemplates] CHECK CONSTRAINT [FK_DocumentTemplates_Type]
GO
ALTER TABLE [dbo].[tblAddress]  WITH NOCHECK ADD  CONSTRAINT [tblAddress$tbCitiestblAddress] FOREIGN KEY([CityID])
REFERENCES [dbo].[tbCities] ([ID])
ON UPDATE CASCADE
GO
ALTER TABLE [dbo].[tblAddress] CHECK CONSTRAINT [tblAddress$tbCitiestblAddress]
GO
ALTER TABLE [dbo].[tblAlerts]  WITH CHECK ADD  CONSTRAINT [FK_Alerts_AlertType] FOREIGN KEY([AlertTypeID])
REFERENCES [dbo].[tblAlertTypes] ([AlertTypeID])
GO
ALTER TABLE [dbo].[tblAlerts] CHECK CONSTRAINT [FK_Alerts_AlertType]
GO
ALTER TABLE [dbo].[tblAlerts]  WITH CHECK ADD  CONSTRAINT [FK_Alerts_Patient] FOREIGN KEY([PersonID])
REFERENCES [dbo].[tblpatients] ([PersonID])
ON DELETE CASCADE
GO
ALTER TABLE [dbo].[tblAlerts] CHECK CONSTRAINT [FK_Alerts_Patient]
GO
ALTER TABLE [dbo].[tblAlignerActivityFlags]  WITH CHECK ADD  CONSTRAINT [FK_ActivityFlags_AlignerSet] FOREIGN KEY([AlignerSetID])
REFERENCES [dbo].[tblAlignerSets] ([AlignerSetID])
ON DELETE CASCADE
GO
ALTER TABLE [dbo].[tblAlignerActivityFlags] CHECK CONSTRAINT [FK_ActivityFlags_AlignerSet]
GO
ALTER TABLE [dbo].[tblAlignerBatches]  WITH CHECK ADD  CONSTRAINT [FK_tblAlignerBatches_AlignerSet] FOREIGN KEY([AlignerSetID])
REFERENCES [dbo].[tblAlignerSets] ([AlignerSetID])
ON DELETE CASCADE
GO
ALTER TABLE [dbo].[tblAlignerBatches] CHECK CONSTRAINT [FK_tblAlignerBatches_AlignerSet]
GO
ALTER TABLE [dbo].[tblAlignerNotes]  WITH CHECK ADD FOREIGN KEY([AlignerSetID])
REFERENCES [dbo].[tblAlignerSets] ([AlignerSetID])
ON DELETE CASCADE
GO
ALTER TABLE [dbo].[tblAlignerSets]  WITH CHECK ADD  CONSTRAINT [FK_tblAlignerSets_AlignerDoctors] FOREIGN KEY([AlignerDrID])
REFERENCES [dbo].[AlignerDoctors] ([DrID])
GO
ALTER TABLE [dbo].[tblAlignerSets] CHECK CONSTRAINT [FK_tblAlignerSets_AlignerDoctors]
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
ALTER TABLE [dbo].[tblExpenses]  WITH CHECK ADD  CONSTRAINT [FK_tblExpenses_tblExpenseCategories] FOREIGN KEY([CategoryID])
REFERENCES [dbo].[tblExpenseCategories] ([CategoryID])
GO
ALTER TABLE [dbo].[tblExpenses] CHECK CONSTRAINT [FK_tblExpenses_tblExpenseCategories]
GO
ALTER TABLE [dbo].[tblExpenses]  WITH CHECK ADD  CONSTRAINT [FK_tblExpenses_tblExpenseSubcategories] FOREIGN KEY([SubcategoryID])
REFERENCES [dbo].[tblExpenseSubcategories] ([SubcategoryID])
GO
ALTER TABLE [dbo].[tblExpenses] CHECK CONSTRAINT [FK_tblExpenses_tblExpenseSubcategories]
GO
ALTER TABLE [dbo].[tblExpenseSubcategories]  WITH CHECK ADD  CONSTRAINT [FK_subcategory_category] FOREIGN KEY([CategoryID])
REFERENCES [dbo].[tblExpenseCategories] ([CategoryID])
GO
ALTER TABLE [dbo].[tblExpenseSubcategories] CHECK CONSTRAINT [FK_subcategory_category]
GO
ALTER TABLE [dbo].[tblImplant]  WITH CHECK ADD  CONSTRAINT [FK_tblImplant_tblwork] FOREIGN KEY([WorkID])
REFERENCES [dbo].[tblwork] ([workid])
ON UPDATE CASCADE
ON DELETE CASCADE
GO
ALTER TABLE [dbo].[tblImplant] CHECK CONSTRAINT [FK_tblImplant_tblwork]
GO
ALTER TABLE [dbo].[tblInvoice]  WITH CHECK ADD  CONSTRAINT [FK_Invoice_AlignerSet] FOREIGN KEY([AlignerSetID])
REFERENCES [dbo].[tblAlignerSets] ([AlignerSetID])
GO
ALTER TABLE [dbo].[tblInvoice] CHECK CONSTRAINT [FK_Invoice_AlignerSet]
GO
ALTER TABLE [dbo].[tblInvoice]  WITH NOCHECK ADD  CONSTRAINT [tblInvoice$tblworktblInvoice] FOREIGN KEY([workid])
REFERENCES [dbo].[tblwork] ([workid])
ON UPDATE CASCADE
ON DELETE CASCADE
GO
ALTER TABLE [dbo].[tblInvoice] CHECK CONSTRAINT [tblInvoice$tblworktblInvoice]
GO
ALTER TABLE [dbo].[tblMessageStatusHistory]  WITH CHECK ADD  CONSTRAINT [FK__tblMessag__Appoi__308412F8] FOREIGN KEY([AppointmentID])
REFERENCES [dbo].[tblappointments] ([appointmentID])
ON DELETE CASCADE
GO
ALTER TABLE [dbo].[tblMessageStatusHistory] CHECK CONSTRAINT [FK__tblMessag__Appoi__308412F8]
GO
ALTER TABLE [dbo].[tblPatientPortalAuth]  WITH CHECK ADD  CONSTRAINT [FK_PortalAuth_Patient] FOREIGN KEY([PersonID])
REFERENCES [dbo].[tblpatients] ([PersonID])
GO
ALTER TABLE [dbo].[tblPatientPortalAuth] CHECK CONSTRAINT [FK_PortalAuth_Patient]
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
ALTER TABLE [dbo].[tblpatients]  WITH CHECK ADD  CONSTRAINT [FK_tblpatients_tblTagOptions] FOREIGN KEY([TagID])
REFERENCES [dbo].[tblTagOptions] ([ID])
GO
ALTER TABLE [dbo].[tblpatients] CHECK CONSTRAINT [FK_tblpatients_tblTagOptions]
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
ALTER TABLE [dbo].[tblPrivatePhotos]  WITH CHECK ADD  CONSTRAINT [FK_PrivatePhotos_Patient] FOREIGN KEY([PersonID])
REFERENCES [dbo].[tblpatients] ([PersonID])
GO
ALTER TABLE [dbo].[tblPrivatePhotos] CHECK CONSTRAINT [FK_PrivatePhotos_Patient]
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
ALTER TABLE [dbo].[tblStandItems]  WITH CHECK ADD FOREIGN KEY([CategoryID])
REFERENCES [dbo].[tblStandCategories] ([CategoryID])
GO
ALTER TABLE [dbo].[tblStandSaleItems]  WITH CHECK ADD FOREIGN KEY([ItemID])
REFERENCES [dbo].[tblStandItems] ([ItemID])
GO
ALTER TABLE [dbo].[tblStandSaleItems]  WITH CHECK ADD FOREIGN KEY([SaleID])
REFERENCES [dbo].[tblStandSales] ([SaleID])
ON DELETE CASCADE
GO
ALTER TABLE [dbo].[tblStandSales]  WITH CHECK ADD FOREIGN KEY([CashierID])
REFERENCES [dbo].[tblUsers] ([UserID])
GO
ALTER TABLE [dbo].[tblStandSales]  WITH CHECK ADD FOREIGN KEY([PersonID])
REFERENCES [dbo].[tblpatients] ([PersonID])
GO
ALTER TABLE [dbo].[tblStandSales]  WITH CHECK ADD FOREIGN KEY([VoidedBy])
REFERENCES [dbo].[tblUsers] ([UserID])
GO
ALTER TABLE [dbo].[tblStandStockMovements]  WITH CHECK ADD FOREIGN KEY([ItemID])
REFERENCES [dbo].[tblStandItems] ([ItemID])
GO
ALTER TABLE [dbo].[tblStandStockMovements]  WITH CHECK ADD FOREIGN KEY([PerformedBy])
REFERENCES [dbo].[tblUsers] ([UserID])
GO
ALTER TABLE [dbo].[tblStandStockMovements]  WITH CHECK ADD FOREIGN KEY([RelatedSaleID])
REFERENCES [dbo].[tblStandSales] ([SaleID])
GO
ALTER TABLE [dbo].[tblvideos]  WITH CHECK ADD  CONSTRAINT [FK_tblvideos_tblVidCat] FOREIGN KEY([Category])
REFERENCES [dbo].[tblVidCat] ([VidCatID])
GO
ALTER TABLE [dbo].[tblvideos] CHECK CONSTRAINT [FK_tblvideos_tblVidCat]
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
ALTER TABLE [dbo].[tblwork]  WITH CHECK ADD  CONSTRAINT [FK_Work_Status] FOREIGN KEY([Status])
REFERENCES [dbo].[tblWorkStatus] ([StatusID])
GO
ALTER TABLE [dbo].[tblwork] CHECK CONSTRAINT [FK_Work_Status]
GO
ALTER TABLE [dbo].[tblWorkItems]  WITH CHECK ADD  CONSTRAINT [FK_WorkItems_Work] FOREIGN KEY([WorkID])
REFERENCES [dbo].[tblwork] ([workid])
GO
ALTER TABLE [dbo].[tblWorkItems] CHECK CONSTRAINT [FK_WorkItems_Work]
GO
ALTER TABLE [dbo].[tblWorkItemTeeth]  WITH CHECK ADD  CONSTRAINT [FK_WorkItemTeeth_Tooth] FOREIGN KEY([ToothID])
REFERENCES [dbo].[tblToothNumber] ([ID])
GO
ALTER TABLE [dbo].[tblWorkItemTeeth] CHECK CONSTRAINT [FK_WorkItemTeeth_Tooth]
GO
ALTER TABLE [dbo].[tblWorkItemTeeth]  WITH CHECK ADD  CONSTRAINT [FK_WorkItemTeeth_WorkItem] FOREIGN KEY([WorkItemID])
REFERENCES [dbo].[tblWorkItems] ([ID])
ON DELETE CASCADE
GO
ALTER TABLE [dbo].[tblWorkItemTeeth] CHECK CONSTRAINT [FK_WorkItemTeeth_WorkItem]
GO
ALTER TABLE [dbo].[SyncQueue]  WITH CHECK ADD CHECK  (([Operation]='DELETE' OR [Operation]='UPDATE' OR [Operation]='INSERT'))
GO
ALTER TABLE [dbo].[SyncQueue]  WITH CHECK ADD CHECK  (([Status]='Failed' OR [Status]='Synced' OR [Status]='Pending'))
GO
ALTER TABLE [dbo].[tblAlerts]  WITH CHECK ADD  CONSTRAINT [CHK_AlertSeverity] CHECK  (([AlertSeverity]=(3) OR [AlertSeverity]=(2) OR [AlertSeverity]=(1)))
GO
ALTER TABLE [dbo].[tblAlerts] CHECK CONSTRAINT [CHK_AlertSeverity]
GO
ALTER TABLE [dbo].[tblAlignerActivityFlags]  WITH CHECK ADD  CONSTRAINT [CK_ActivityType] CHECK  (([ActivityType]='DaysChanged' OR [ActivityType]='DoctorNote'))
GO
ALTER TABLE [dbo].[tblAlignerActivityFlags] CHECK CONSTRAINT [CK_ActivityType]
GO
ALTER TABLE [dbo].[tblAlignerBatches]  WITH CHECK ADD  CONSTRAINT [CK_AlignerBatches_Active_Requires_Delivery] CHECK  (([IsActive]=(0) OR [DeliveredToPatientDate] IS NOT NULL))
GO
ALTER TABLE [dbo].[tblAlignerBatches] CHECK CONSTRAINT [CK_AlignerBatches_Active_Requires_Delivery]
GO
ALTER TABLE [dbo].[tblInvoice]  WITH CHECK ADD  CONSTRAINT [CHK_Invoice_AmountPaidPositive] CHECK  (([Amountpaid]>(0)))
GO
ALTER TABLE [dbo].[tblInvoice] CHECK CONSTRAINT [CHK_Invoice_AmountPaidPositive]
GO
ALTER TABLE [dbo].[tblInvoice]  WITH CHECK ADD  CONSTRAINT [CHK_Invoice_ChangeNonNegative] CHECK  (([Change]>=(0) OR [Change] IS NULL))
GO
ALTER TABLE [dbo].[tblInvoice] CHECK CONSTRAINT [CHK_Invoice_ChangeNonNegative]
GO
ALTER TABLE [dbo].[tblInvoice]  WITH CHECK ADD  CONSTRAINT [CHK_Invoice_IQDNonNegative] CHECK  (([IQDReceived]>=(0)))
GO
ALTER TABLE [dbo].[tblInvoice] CHECK CONSTRAINT [CHK_Invoice_IQDNonNegative]
GO
ALTER TABLE [dbo].[tblInvoice]  WITH CHECK ADD  CONSTRAINT [CHK_Invoice_MustReceiveCash] CHECK  (([USDReceived]>(0) OR [IQDReceived]>(0)))
GO
ALTER TABLE [dbo].[tblInvoice] CHECK CONSTRAINT [CHK_Invoice_MustReceiveCash]
GO
ALTER TABLE [dbo].[tblInvoice]  WITH CHECK ADD  CONSTRAINT [CHK_Invoice_USDNonNegative] CHECK  (([USDReceived]>=(0)))
GO
ALTER TABLE [dbo].[tblInvoice] CHECK CONSTRAINT [CHK_Invoice_USDNonNegative]
GO
ALTER TABLE [dbo].[tblInvoice]  WITH CHECK ADD  CONSTRAINT [CK_MoreThanTotal] CHECK  (([dbo].[functotalpaid]([workid])=(1)))
GO
ALTER TABLE [dbo].[tblInvoice] CHECK CONSTRAINT [CK_MoreThanTotal]
GO
ALTER TABLE [dbo].[tblpatients]  WITH NOCHECK ADD  CONSTRAINT [SSMA_CC$tblpatients$DateofBirth$validation_rule] CHECK  (([DateofBirth]<CONVERT([datetime],CONVERT([varchar],getdate(),(1)),(1))))
GO
ALTER TABLE [dbo].[tblpatients] CHECK CONSTRAINT [SSMA_CC$tblpatients$DateofBirth$validation_rule]
GO
ALTER TABLE [dbo].[tblpatients]  WITH CHECK ADD  CONSTRAINT [SSMA_CC$tblpatients$Gender$validation_rule] CHECK  (([Gender] IS NULL OR [Gender]=(1) OR [Gender]=(2)))
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
ALTER TABLE [dbo].[tblStandItems]  WITH CHECK ADD  CONSTRAINT [CK_StandItems_CostPrice] CHECK  (([CostPrice]>=(0)))
GO
ALTER TABLE [dbo].[tblStandItems] CHECK CONSTRAINT [CK_StandItems_CostPrice]
GO
ALTER TABLE [dbo].[tblStandItems]  WITH CHECK ADD  CONSTRAINT [CK_StandItems_CurrentStock] CHECK  (([CurrentStock]>=(0)))
GO
ALTER TABLE [dbo].[tblStandItems] CHECK CONSTRAINT [CK_StandItems_CurrentStock]
GO
ALTER TABLE [dbo].[tblStandItems]  WITH CHECK ADD  CONSTRAINT [CK_StandItems_ReorderLevel] CHECK  (([ReorderLevel]>=(0)))
GO
ALTER TABLE [dbo].[tblStandItems] CHECK CONSTRAINT [CK_StandItems_ReorderLevel]
GO
ALTER TABLE [dbo].[tblStandItems]  WITH CHECK ADD  CONSTRAINT [CK_StandItems_SellPrice] CHECK  (([SellPrice]>=(0)))
GO
ALTER TABLE [dbo].[tblStandItems] CHECK CONSTRAINT [CK_StandItems_SellPrice]
GO
ALTER TABLE [dbo].[tblStandSaleItems]  WITH CHECK ADD  CONSTRAINT [CK_StandSaleItems_Quantity] CHECK  (([Quantity]>(0)))
GO
ALTER TABLE [dbo].[tblStandSaleItems] CHECK CONSTRAINT [CK_StandSaleItems_Quantity]
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
/****** Object:  StoredProcedure [dbo].[AddDolph]    Script Date: 5/27/2026 7:11:45 PM ******/
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
/****** Object:  StoredProcedure [dbo].[AddTimePoint]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROCEDURE [dbo].[AddTimePoint]
@ID VarChar(50), @TPName Varchar(50), @TPDate DateTime
AS
BEGIN
SET NOCOUNT ON;

DECLARE @PatID UniqueIdentifier, @Pos int

SET @PatID = (SELECT P.PatID FROM DolphinPlatform.dbo.Patients P WHERE P.patOtherID = @ID)
SET @Pos = ISNULL((SELECT (MAX(CAST(tpcode as int))+1) FROM DolphinPlatform.dbo.TimePoints as T WHERE T.PatID = @PatID),0)
    
    BEGIN TRANSACTION
    
    INSERT INTO DolphinPlatform.dbo.TimePoints
    ([tpCode],[tpDescription],[patID],[tpDateTime])
    VALUES
    (CAST(@Pos as Varchar(12)),@TPName,@PatID,@TPDate)

    IF @TPName = 'Initial'
    BEGIN
        DECLARE @IPD as date
        SET @IPD = (SELECT W.IPhotoDate FROM ShwanNew.dbo.tblwork W WHERE W.PersonID = @ID AND Status = 1)
        
        IF @IPD IS NULL
        BEGIN
            UPDATE ShwanNew.dbo.tblwork 
            SET IPhotoDate = @TPDate
            WHERE PersonID = @ID AND Status = 1
        END
        ELSE IF @IPD IS NOT NULL AND @IPD <> @TPDate 
        BEGIN
            ROLLBACK TRANSACTION;
            THROW 51000, '_There is a conflict. Please correct initial photos date.', 1;
        END  
    END

    IF @TPName = 'Final'
    BEGIN
        DECLARE @FPD as date
        SET @FPD = (SELECT W.FPhotoDate FROM ShwanNew.dbo.tblwork W WHERE W.PersonID = @ID AND Status = 1)
        
        IF @FPD IS NULL
        BEGIN
            UPDATE ShwanNew.dbo.tblwork 
            SET FPhotoDate = @TPDate
            WHERE PersonID = @ID AND Status = 1 
        END
        ELSE IF @FPD IS NOT NULL AND @FPD <> @TPDate 
        BEGIN
            ROLLBACK TRANSACTION;
            THROW 51000, '_There is a conflict. Please correct final photos date.', 1;
        END  
    END

    SELECT @Pos as MyTP
    COMMIT TRANSACTION
END
GO
/****** Object:  StoredProcedure [dbo].[ApposforOne]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE PROCEDURE [dbo].[ApposforOne] @ID int AS SELECT CAST(dbo.tblappointments.AppDate AS date) AS AppDate FROM dbo.tblappointments WHERE PersonID = @ID ORDER BY AppDate DESC
GO
/****** Object:  StoredProcedure [dbo].[CheckDate]    Script Date: 5/27/2026 7:11:45 PM ******/
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
/****** Object:  StoredProcedure [dbo].[CheckDolphin]    Script Date: 5/27/2026 7:11:45 PM ******/
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
/****** Object:  StoredProcedure [dbo].[ChkTimePoint]    Script Date: 5/27/2026 7:11:45 PM ******/
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
/****** Object:  StoredProcedure [dbo].[Daily]    Script Date: 5/27/2026 7:11:45 PM ******/
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
/****** Object:  StoredProcedure [dbo].[FillCalender]    Script Date: 5/27/2026 7:11:45 PM ******/
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
/****** Object:  StoredProcedure [dbo].[GetDailyAppointmentsOptimized]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

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
        IsOrthoVisit BIT,
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
    ),
    ActiveWork AS (
        SELECT
            w.PersonID,
            CASE 
                WHEN w.Typeofwork IN (1, 2, 11, 19, 20) THEN 1 
                ELSE 0 
            END AS IsOrthoVisit
        FROM dbo.tblwork w
        WHERE w.Status = 1
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
        ISNULL(aw.IsOrthoVisit, 0) AS IsOrthoVisit,
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
    LEFT OUTER JOIN ActiveWork aw ON a.PersonID = aw.PersonID
    LEFT OUTER JOIN VisitCheck v ON a.PersonID = v.PersonID
        AND CAST(a.AppDate AS DATE) = v.VisitDate
    WHERE CAST(a.AppDate AS DATE) = @AppsDate;

    SELECT
        appointmentID, PersonID, AppDetail, AppDate,
        PatientType, PatientName, hasActiveAlert, apptime
    FROM #BaseAppointments
    WHERE Present IS NULL
    ORDER BY
        CASE WHEN CAST(AppDate AS TIME) = '00:00:00' THEN 1 ELSE 0 END,
        AppDate;

    SELECT
        appointmentID, PersonID, AppDetail, PresentTime, SeatedTime,
        DismissedTime, AppDate, AppCost, apptime, PatientType,
        PatientName, hasActiveAlert, HasVisit, IsOrthoVisit
    FROM #BaseAppointments
    WHERE Present IS NOT NULL
    ORDER BY PresentTime;

    SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN Present IS NOT NULL THEN 1 ELSE 0 END) AS checkedIn,
        SUM(CASE WHEN Present IS NULL THEN 1 ELSE 0 END) AS absent,
        SUM(CASE WHEN Present IS NOT NULL AND Seated IS NULL AND Dismissed IS NULL THEN 1 ELSE 0 END) AS waiting
    FROM #BaseAppointments;

    DROP TABLE #BaseAppointments;
END

GO
/****** Object:  StoredProcedure [dbo].[GetMessageStatusByDate]    Script Date: 5/27/2026 7:11:45 PM ******/
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
/****** Object:  StoredProcedure [dbo].[GetNewAppointmentMessage]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

  CREATE PROCEDURE [dbo].[GetNewAppointmentMessage]
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
                            N'" is your appointment with Dr. Shwan orthodontic clinic at ' +
  FORMAT(@AppDateTime, 'h:mm tt');
          ELSE IF @DD = 2
              SET @Message = N'Hello ' + COALESCE(@FirstName, @PatientName) +
                            N'. The day after tomorrow "' + @EnglishDayName +
                            N'" is your appointment with Dr. Shwan orthodontic clinic at ' +
  FORMAT(@AppDateTime, 'h:mm tt');
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
                            N' موعدك مع عيادة د.شوان لتقويم الاسنان الساعة ' + FORMAT(@AppDateTime,
  'h:mm');
          ELSE IF @DD = 2
              SET @Message = N'السلام عليك ' + @PatientName +
                            N'. بعد غد ' + @ArabicDayName +
                            N' موعدك مع عيادة د.شوان لتقويم الاسنان الساعة ' + FORMAT(@AppDateTime,
  'h:mm');
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
/****** Object:  StoredProcedure [dbo].[GetWhatsAppMessagesToSend]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

  CREATE PROCEDURE [dbo].[GetWhatsAppMessagesToSend]
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
          SET @E_Mes = N'Tomorrow "' + @EnglishDayName + N'" is your appointment with Dr. Shwan 
  orthodontic clinic at';
      END
      ELSE -- @DD = 2
      BEGIN
          SET @A_Mes = N'بعد غد ' + @ArabicDayName + N' موعدك مع عيادة د.شوان لتقويم الاسنان الساعة';
          SET @E_Mes = N'The day after tomorrow "' + @EnglishDayName + N'" is your appointment with Dr. 
  Shwan orthodontic clinic at';
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
                  N'Hello ' + COALESCE(p.FirstName, p.PatientName) + N'. ' + @E_Mes + N' ' +
  format(a.AppDate, 'h:mm')
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
/****** Object:  StoredProcedure [dbo].[ListDolphTimePoints]    Script Date: 5/27/2026 7:11:45 PM ******/
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
/****** Object:  StoredProcedure [dbo].[ListTimePointImgs]    Script Date: 5/27/2026 7:11:45 PM ******/
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
/****** Object:  StoredProcedure [dbo].[proAddVisit]    Script Date: 5/27/2026 7:11:45 PM ******/
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
/****** Object:  StoredProcedure [dbo].[ProAppsPhones]    Script Date: 5/27/2026 7:11:45 PM ******/
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
/****** Object:  StoredProcedure [dbo].[ProcCalendarStatsOptimized]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

  -- 3. Create CALENDAR-FOCUSED stats procedure
  CREATE PROCEDURE [dbo].[ProcCalendarStatsOptimized]
      @StartDate DATE,
      @EndDate DATE
  AS
  BEGIN
      SET NOCOUNT ON;

      -- Use existing tblcalender for statistics calculation - FIXED for multiple appointments
      SELECT
          @StartDate AS WeekStart,
          @EndDate AS WeekEnd,
          COUNT(*) AS TotalSlots,
          SUM(CASE WHEN SlotStatus = 'available' THEN 1 ELSE 0 END) AS AvailableSlots,
          SUM(CASE WHEN SlotStatus = 'booked' THEN 1 ELSE 0 END) AS BookedSlots,
          SUM(CASE WHEN SlotStatus = 'past' THEN 1 ELSE 0 END) AS PastSlots,
          CASE
              WHEN COUNT(*) > 0 THEN
                  CAST(SUM(CASE WHEN SlotStatus = 'booked' THEN 1.0 ELSE 0 END) /
  COUNT(*) * 100 AS DECIMAL(5,2))
              ELSE 0
          END AS UtilizationPercent,
          -- NEW: Total appointment count across all slots
          SUM(CASE WHEN SlotStatus = 'booked' THEN AppointmentCount ELSE 0 END) AS
  TotalAppointments
      FROM (
          SELECT
              CASE
                  WHEN EXISTS (SELECT 1 FROM tblappointments ta_check WHERE
  ta_check.AppDate = tc.AppDate) THEN 'booked'
                  WHEN tc.AppDate < GETDATE() THEN 'past'
                  ELSE 'available'
              END AS SlotStatus,
              -- Count appointments per slot
              (SELECT COUNT(*) FROM tblappointments ta_count WHERE ta_count.AppDate =
  tc.AppDate) AS AppointmentCount
          FROM tblcalender tc
          WHERE CAST(tc.AppDate AS DATE) BETWEEN @StartDate AND @EndDate
              AND DATEPART(WEEKDAY, tc.AppDate) != 6  -- Exclude Friday
      ) stats;
  END

GO
/****** Object:  StoredProcedure [dbo].[ProcDay]    Script Date: 5/27/2026 7:11:45 PM ******/
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
/****** Object:  StoredProcedure [dbo].[ProcEnsureCalendarRange]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

  -- 4. Create simple calendar maintenance check
  CREATE PROCEDURE [dbo].[ProcEnsureCalendarRange]
      @DaysAhead INT = 60
  AS
  BEGIN
      SET NOCOUNT ON;

      DECLARE @FutureDate DATE = DATEADD(DAY, @DaysAhead, GETDATE());
      DECLARE @MaxCalendarDate DATE;

      -- Check current maximum date in calendar
      SELECT @MaxCalendarDate = MAX(CAST(AppDate AS DATE))
      FROM tblcalender;

      -- Return status for calendar maintenance
      SELECT
          CASE
              WHEN @MaxCalendarDate IS NULL OR @MaxCalendarDate < @FutureDate
              THEN 'Calendar needs updating'
              ELSE 'Calendar is current'
          END AS Status,
          @MaxCalendarDate AS MaxCalendarDate,
          @FutureDate AS TargetDate;
  END

GO
/****** Object:  StoredProcedure [dbo].[ProcFetch]    Script Date: 5/27/2026 7:11:45 PM ******/
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
	Select A.appointmentID, coalesce( P.CountryCode,'964') + P.Phone + '@c.us' ,A.WaMessageID
	From dbo.tblpatients P INNER JOIN
         dbo.tblappointments A ON P.PersonID = A.PersonID
		 Where  (A.AppDay = @ADate) and (A.SentWa = 1)
	

END

GO
/****** Object:  StoredProcedure [dbo].[Procgetsids]    Script Date: 5/27/2026 7:11:45 PM ******/
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
/****** Object:  StoredProcedure [dbo].[ProcGrandTotal]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER OFF
GO
-- Migration: Fix ProcGrandTotal with CORRECT Qasa calculation
-- Date: 2025-11-10
-- Description: Calculate daily cash box correctly accounting for:
--              - IQD and USD received
--              - Change given (in any currency)
--              - Expenses paid out
--              Result = Physical cash in box at end of day

CREATE PROCEDURE [dbo].[ProcGrandTotal]
    @month INT,
    @year INT,
    @Ex INT
AS
BEGIN
    DECLARE @Start AS DATETIME
    DECLARE @End AS DATETIME
    DECLARE @Startd AS DATE
    DECLARE @Endd AS DATE

    -- Calculate date range for the given month/year
    SELECT @start = DATEFROMPARTS(@year, @month, 1)

    IF @month = 12
        SELECT @End = DATEFROMPARTS(@year + 1, 1, 1)
    ELSE
        SELECT @End = DATEFROMPARTS(@year, @month + 1, 1)

    SELECT @Startd = @start
    SELECT @Endd = @End

    -- Main query with correct daily cash box calculations
    SELECT
        ISNULL(dbo.VWIQD.Day, dbo.VWUSD.Day) AS 'Day',
        dbo.VWIQD.SumIQD,
        dbo.VWIQD.SumExQ AS 'ExpensesIQD',
        dbo.VWIQD.FinalIQDSum,
        dbo.VWUSD.SumUSD,
        dbo.VWUSD.SumEx$ AS 'ExpensesUSD',
        dbo.VWUSD.FinalUSDSum,

        -- Grand Total in USD (convert IQD to USD using DAILY exchange rate and add USD)
        CAST(
            (ISNULL(dbo.VWIQD.FinalIQDSum, 0) / CAST(ISNULL(s.ExchangeRate, @ex) AS FLOAT))
            + ISNULL(dbo.VWUSD.FinalUSDSum, 0)
            AS DECIMAL(9,2)
        ) AS GrandTotal,

        -- Grand Total in IQD (add IQD and convert USD to IQD using DAILY exchange rate)
        (
            ISNULL(dbo.VWIQD.FinalIQDSum, 0)
            + ISNULL((dbo.VWUSD.FinalUSDSum * ISNULL(s.ExchangeRate, @Ex)), 0)
        ) AS GrandTotalIQD,

        -- CORRECT Qasa IQD Calculation:
        -- = Total IQD received that day
        -- - IQD expenses paid out
        -- - IQD change given back to patients
        (
            ISNULL(DailyIQD.TotalIQDReceived, 0)     -- All IQD received
            + ISNULL(dbo.VWIQD.SumExQ, 0)            -- Subtract expenses (already negative)
            - ISNULL(DailyIQD.TotalChangeGiven, 0)   -- Subtract change given
        ) AS QasaIQD,

        -- CORRECT Qasa USD Calculation:
        -- = Total USD received that day
        -- - USD expenses paid out
        -- (Change is always given in IQD in Iraq)
        (
            ISNULL(DailyUSD.TotalUSDReceived, 0)     -- All USD received
            + ISNULL(dbo.VWUSD.SumEx$, 0)            -- Subtract expenses (already negative)
        ) AS QasaUSD

    FROM dbo.VWIQD
    FULL OUTER JOIN dbo.VWUSD
        ON dbo.VWIQD.Day = dbo.VWUSD.Day
    LEFT JOIN dbo.tblsms s
        ON ISNULL(dbo.VWIQD.Day, dbo.VWUSD.Day) = s.[date]

    -- Join with daily IQD totals (received and change)
    LEFT JOIN (
        SELECT
            Dateofpayment,
            SUM(ISNULL(IQDReceived, 0)) AS TotalIQDReceived,
            SUM(ISNULL(Change, 0)) AS TotalChangeGiven
        FROM dbo.tblInvoice
        GROUP BY Dateofpayment
    ) DailyIQD ON ISNULL(dbo.VWIQD.Day, dbo.VWUSD.Day) = DailyIQD.Dateofpayment

    -- Join with daily USD totals (received)
    LEFT JOIN (
        SELECT
            Dateofpayment,
            SUM(ISNULL(USDReceived, 0)) AS TotalUSDReceived
        FROM dbo.tblInvoice
        GROUP BY Dateofpayment
    ) DailyUSD ON ISNULL(dbo.VWIQD.Day, dbo.VWUSD.Day) = DailyUSD.Dateofpayment

    WHERE ISNULL(dbo.VWIQD.Day, dbo.VWUSD.Day) >= @Startd
        AND ISNULL(dbo.VWIQD.Day, dbo.VWUSD.Day) < @Endd
    ORDER BY Day
END

GO
/****** Object:  StoredProcedure [dbo].[ProcSMS]    Script Date: 5/27/2026 7:11:45 PM ******/
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
/****** Object:  StoredProcedure [dbo].[ProcUpdatesms1]    Script Date: 5/27/2026 7:11:45 PM ******/
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
/****** Object:  StoredProcedure [dbo].[ProcUpdatesms2]    Script Date: 5/27/2026 7:11:45 PM ******/
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
/****** Object:  StoredProcedure [dbo].[ProcWeeklyCalendarOptimized]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROCEDURE [dbo].[ProcWeeklyCalendarOptimized]
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

GO
/****** Object:  StoredProcedure [dbo].[ProcYearlyMonthlyTotals]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROCEDURE [dbo].[ProcYearlyMonthlyTotals]
    @startMonth INT,
    @startYear INT,
    @Ex INT
AS
BEGIN
    SET NOCOUNT ON;
    
    -- Calculate 12-month period from start month/year
    DECLARE @StartDate DATE = DATEFROMPARTS(@startYear, @startMonth, 1);
    DECLARE @EndDate DATE = DATEADD(MONTH, 12, @StartDate);

    SELECT 
        YEAR(ISNULL(dbo.VWIQD.Day, dbo.VWUSD.Day)) AS [Year],
        MONTH(ISNULL(dbo.VWIQD.Day, dbo.VWUSD.Day)) AS [Month],
        
        SUM(ISNULL(dbo.VWIQD.SumIQD, 0)) AS SumIQD,
        SUM(ISNULL(dbo.VWIQD.SumExQ, 0)) AS ExpensesIQD,
        SUM(ISNULL(dbo.VWIQD.FinalIQDSum, 0)) AS FinalIQDSum,
        
        SUM(ISNULL(dbo.VWUSD.SumUSD, 0)) AS SumUSD,
        SUM(ISNULL(dbo.VWUSD.SumEx$, 0)) AS ExpensesUSD,
        SUM(ISNULL(dbo.VWUSD.FinalUSDSum, 0)) AS FinalUSDSum,
        
        CAST(
            SUM(ISNULL(dbo.VWIQD.FinalIQDSum, 0)) / CAST(@Ex AS FLOAT)
            + SUM(ISNULL(dbo.VWUSD.FinalUSDSum, 0))
            AS DECIMAL(12,2)
        ) AS GrandTotal

    FROM dbo.VWIQD
    FULL OUTER JOIN dbo.VWUSD 
        ON dbo.VWIQD.Day = dbo.VWUSD.Day
    
    WHERE ISNULL(dbo.VWIQD.Day, dbo.VWUSD.Day) >= @StartDate
        AND ISNULL(dbo.VWIQD.Day, dbo.VWUSD.Day) < @EndDate
    
    GROUP BY 
        YEAR(ISNULL(dbo.VWIQD.Day, dbo.VWUSD.Day)),
        MONTH(ISNULL(dbo.VWIQD.Day, dbo.VWUSD.Day))
    ORDER BY [Year], [Month]
END

GO
/****** Object:  StoredProcedure [dbo].[ProDailyInvoices]    Script Date: 5/27/2026 7:11:45 PM ******/
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
    SELECT p.PatientName, i.invoiceID, FORMAT(i.Amountpaid, '#,##0') AS Amountpaid, 
           i.Dateofpayment, i.workid, i.SysStartTime, i.SysEndTime, i.ActualAmount, 
           i.ActualCur, i.Change, w.currency, w.DrID 
    FROM [tblInvoice] i 
    INNER JOIN tblwork w ON w.workid = i.workid 
    INNER JOIN tblpatients p ON w.PersonID = p.PersonID 
    WHERE i.Dateofpayment = @iDate
END

GO
/****** Object:  StoredProcedure [dbo].[proGetLatestWire]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE PROCEDURE proGetLatestWire
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
/****** Object:  StoredProcedure [dbo].[proGetVisitSum]    Script Date: 5/27/2026 7:11:45 PM ******/
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
/****** Object:  StoredProcedure [dbo].[ProlatestVisitSum]    Script Date: 5/27/2026 7:11:45 PM ******/
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
/****** Object:  StoredProcedure [dbo].[ProVisitSum]    Script Date: 5/27/2026 7:11:45 PM ******/
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
/****** Object:  StoredProcedure [dbo].[PTodayAppsWeb]    Script Date: 5/27/2026 7:11:45 PM ******/
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
/****** Object:  StoredProcedure [dbo].[ResetMessagingForDate]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

  -- =============================================
  -- Stored Procedure: ResetMessagingForDate
  -- Description: Completely resets all WhatsApp and SMS messaging
  --              statuses and related fields for a specific date
  -- Author: System Admin
  -- Created: 2025-05-23
  -- Updated: 2025-05-23 - Added message history cleanup
  -- =============================================

  CREATE PROCEDURE [dbo].[ResetMessagingForDate]
      @ResetDate DATE,
      @ResetWhatsApp BIT = 1,        -- Reset WhatsApp fields (default: yes)
      @ResetSMS BIT = 1,             -- Reset SMS fields (default: yes)
      @ResetNotifications BIT = 1,   -- Reset notification preferences (default: yes)
      @ShowResults BIT = 1           -- Show reset statistics (default: yes)
  AS
  BEGIN
      SET NOCOUNT ON;

      DECLARE @ErrorMessage NVARCHAR(4000);
      DECLARE @ErrorSeverity INT;
      DECLARE @ErrorState INT;
      DECLARE @RowsAffected INT = 0;
      DECLARE @SmsRowsAffected INT = 0;
      DECLARE @HistoryRowsDeleted INT = 0;

      BEGIN TRY
          BEGIN TRANSACTION;

          -- Validate input date
          IF @ResetDate IS NULL
          BEGIN
              RAISERROR('Reset date cannot be NULL', 16, 1);
              RETURN -1;
          END;

          -- CRITICAL FIX: Delete message status history FIRST
          -- This prevents old message statuses from appearing in the frontend
          DELETE FROM dbo.tblMessageStatusHistory
          WHERE AppointmentID IN (
              SELECT appointmentID
              FROM dbo.tblappointments
              WHERE AppDay = @ResetDate
          );
          SET @HistoryRowsDeleted = @@ROWCOUNT;

          -- Reset appointments table based on options
          IF @ResetWhatsApp = 1 AND @ResetSMS = 1 AND @ResetNotifications = 1
          BEGIN
              -- Complete reset (most common case)
              UPDATE [dbo].[tblappointments]
              SET
                  [Notified] = 0,
                  [SentWa] = 0,
                  [DeliveredWa] = NULL,
                  [WantWa] = 1,
                  [WaMessageID] = NULL,
                  [SentTimestamp] = NULL,
                  [LastUpdated] = NULL,
                  [DeliveredTimestamp] = NULL,
                  [ReadTimestamp] = NULL,
                  [WantNotify] = 1
              WHERE AppDay = @ResetDate;

              SET @RowsAffected = @@ROWCOUNT;
          END
          ELSE
          BEGIN
              -- Selective reset - build update dynamically but safely
              DECLARE @SQL NVARCHAR(MAX);
              SET @SQL = 'UPDATE [dbo].[tblappointments] SET ';

              -- WhatsApp fields
              IF @ResetWhatsApp = 1
              BEGIN
                  SET @SQL = @SQL +
                      '[SentWa] = 0, ' +
                      '[DeliveredWa] = NULL, ' +
                      '[WantWa] = 1, ' +
                      '[WaMessageID] = NULL, ' +
                      '[SentTimestamp] = NULL, ' +
                      '[LastUpdated] = NULL, ' +
                      '[DeliveredTimestamp] = NULL, ' +
                      '[ReadTimestamp] = NULL, ';
              END;

              -- Notification fields
              IF @ResetNotifications = 1
              BEGIN
                  SET @SQL = @SQL +
                      '[Notified] = 0, ' +
                      '[WantNotify] = 1, ';
              END;

              -- Remove trailing comma and add WHERE clause
              IF LEN(@SQL) > LEN('UPDATE [dbo].[tblappointments] SET ')
              BEGIN
                  SET @SQL = LEFT(@SQL, LEN(@SQL) - 2); -- Remove last comma and space
                  SET @SQL = @SQL + ' WHERE AppDay = ''' + CAST(@ResetDate AS VARCHAR(10)) + '''';

                  -- Execute the update
                  EXEC (@SQL);
                  SET @RowsAffected = @@ROWCOUNT;
              END;
          END;

          -- Reset SMS table if SMS reset is enabled
          IF @ResetSMS = 1
          BEGIN
              UPDATE [dbo].[tblsms]
              SET [smssent] = 0
              WHERE [date] = @ResetDate;
              SET @SmsRowsAffected = @@ROWCOUNT;
          END;

          COMMIT TRANSACTION;

          -- Log the reset operation
          DECLARE @LogMessage NVARCHAR(500) =
              'Messaging reset completed for ' + CAST(@ResetDate AS NVARCHAR(20)) +
              '. Appointments: ' + CAST(@RowsAffected AS NVARCHAR(10)) +
              '. SMS: ' + CAST(@SmsRowsAffected AS NVARCHAR(10)) +
              '. History deleted: ' + CAST(@HistoryRowsDeleted AS NVARCHAR(10));

          PRINT @LogMessage;

          -- Show results if requested
          IF @ShowResults = 1
          BEGIN
              SELECT
                  @ResetDate as ResetDate,
                  COUNT(*) as TotalAppointments,
                  SUM(CASE WHEN WantWa = 1 THEN 1 ELSE 0 END) as ReadyForWhatsApp,
                  SUM(CASE WHEN WantNotify = 1 THEN 1 ELSE 0 END) as ReadyForSMS,
                  SUM(CASE WHEN SentWa = 1 THEN 1 ELSE 0 END) as AlreadySentWA,
                  SUM(CASE WHEN Notified = 1 THEN 1 ELSE 0 END) as AlreadyNotified,
                  @RowsAffected as AppointmentsReset,
                  @SmsRowsAffected as SmsRecordsReset,
                  @HistoryRowsDeleted as HistoryRecordsDeleted
              FROM [dbo].[tblappointments]
              WHERE AppDay = @ResetDate;
          END;

          RETURN 0; -- Success

      END TRY
      BEGIN CATCH
          IF @@TRANCOUNT > 0
              ROLLBACK TRANSACTION;

          SELECT @ErrorMessage = ERROR_MESSAGE(),
                 @ErrorSeverity = ERROR_SEVERITY(),
                 @ErrorState = ERROR_STATE();

          PRINT 'Error occurred during messaging reset: ' + @ErrorMessage;
          RAISERROR(@ErrorMessage, @ErrorSeverity, @ErrorState);

          RETURN -1; -- Error
      END CATCH;
  END

GO
/****** Object:  StoredProcedure [dbo].[sp_NotifyAppOfSync]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROCEDURE sp_NotifyAppOfSync
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Url NVARCHAR(500) = 'http://localhost:3000/api/sync/queue-notify';
    DECLARE @Object INT;
    DECLARE @ResponseText VARCHAR(8000);
    DECLARE @HR INT;

    -- Create HTTP object
    EXEC @HR = sp_OACreate 'MSXML2.ServerXMLHTTP', @Object OUT;
    IF @HR <> 0 RETURN;

    -- Open connection
    EXEC @HR = sp_OAMethod @Object, 'open', NULL, 'POST', @Url, 'false';
    IF @HR <> 0 GOTO CleanUp;

    -- Set headers
    EXEC @HR = sp_OAMethod @Object, 'setRequestHeader', NULL, 'Content-Type', 'application/json';
    IF @HR <> 0 GOTO CleanUp;

    -- Send request
    EXEC @HR = sp_OAMethod @Object, 'send', NULL, '{"source":"sqlserver"}';
    IF @HR <> 0 GOTO CleanUp;

CleanUp:
    EXEC sp_OADestroy @Object;
END

GO
/****** Object:  StoredProcedure [dbo].[UndoAppointmentState]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROCEDURE [dbo].[UndoAppointmentState]
    @AppointmentID as int,
    @StateField as varchar(100)  -- 'Present', 'Seated', or 'Dismissed'
AS
BEGIN
    SET NOCOUNT ON;

    -- Validate state field to prevent SQL injection
    IF @StateField NOT IN ('Present', 'Seated', 'Dismissed')
    BEGIN
        RAISERROR('Invalid state field. Must be Present, Seated, or Dismissed.', 16, 1)
        RETURN
    END

    -- Get current state of the appointment
    DECLARE @CurrentPresent time
    DECLARE @CurrentSeated time
    DECLARE @CurrentDismissed time

    SELECT
        @CurrentPresent = Present,
        @CurrentSeated = Seated,
        @CurrentDismissed = Dismissed
    FROM tblappointments
    WHERE AppointmentID = @AppointmentID

    -- Validate state transition logic
    -- Rule 1: Cannot undo Present if Seated is set
    IF @StateField = 'Present' AND @CurrentSeated IS NOT NULL
    BEGIN
        RAISERROR('Cannot undo check-in: Patient is already seated', 16, 1)
        RETURN
    END

    -- Rule 2: Cannot undo Seated if Dismissed is set
    IF @StateField = 'Seated' AND @CurrentDismissed IS NOT NULL
    BEGIN
        RAISERROR('Cannot undo seated: Patient visit is already completed', 16, 1)
        RETURN
    END

    -- Validation passed - proceed with undo
    DECLARE @SQL NVARCHAR(MAX)
    SET @SQL = N'UPDATE tblappointments SET [' + @StateField + N'] = NULL WHERE AppointmentID = @AppointmentID'

    EXEC sp_executesql @SQL, N'@AppointmentID int', @AppointmentID

    -- Return success indicator
    SELECT
        @AppointmentID as AppointmentID,
        @StateField as StateCleared,
        1 as Success
END

GO
/****** Object:  StoredProcedure [dbo].[UpdatePresent]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROCEDURE dbo.UpdatePresent
    @Aid INT,
    @state VARCHAR(100),
    @Tim VARCHAR(10)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @startedTran BIT = 0;

    BEGIN TRY
        IF @@TRANCOUNT = 0
        BEGIN
            BEGIN TRANSACTION;
            SET @startedTran = 1;
        END

        DECLARE @TimVal TIME(0) = CAST(@Tim AS TIME(0));
        DECLARE @currPresent TIME(0);
        DECLARE @currSeated TIME(0);
        DECLARE @currDismissed TIME(0);
        DECLARE @rowExists BIT = 0;

        SELECT
            @currPresent = Present,
            @currSeated = Seated,
            @currDismissed = Dismissed,
            @rowExists = 1
        FROM dbo.tblappointments WITH (UPDLOCK, HOLDLOCK)
        WHERE AppointmentID = @Aid;

        IF @rowExists = 0
            THROW 50101, 'Appointment not found', 1;

        IF @state = 'Present'
        BEGIN
            IF @currPresent IS NOT NULL OR @currSeated IS NOT NULL OR @currDismissed IS NOT NULL
                THROW 50102, '[INVALID_STATE_TRANSITION] Cannot check in: patient is already checked in, seated, or dismissed', 1;

            UPDATE dbo.tblappointments
            SET Present = @TimVal,
                LastUpdated = GETDATE()
            WHERE AppointmentID = @Aid;
        END
        ELSE IF @state = 'Seated'
        BEGIN
            IF @currPresent IS NULL
                THROW 50103, '[INVALID_STATE_TRANSITION] Cannot seat: patient is not checked in', 1;
            IF @currSeated IS NOT NULL
                THROW 50104, '[INVALID_STATE_TRANSITION] Cannot seat: patient is already seated', 1;
            IF @currDismissed IS NOT NULL
                THROW 50105, '[INVALID_STATE_TRANSITION] Cannot seat: patient is already dismissed', 1;

            UPDATE dbo.tblappointments
            SET Seated = @TimVal,
                LastUpdated = GETDATE()
            WHERE AppointmentID = @Aid;
        END
        ELSE IF @state = 'Dismissed'
        BEGIN
            IF @currSeated IS NULL
                THROW 50106, '[INVALID_STATE_TRANSITION] Cannot dismiss: patient is not seated', 1;
            IF @currDismissed IS NOT NULL
                THROW 50107, '[INVALID_STATE_TRANSITION] Cannot dismiss: patient is already dismissed', 1;

            UPDATE dbo.tblappointments
            SET Dismissed = @TimVal,
                LastUpdated = GETDATE()
            WHERE AppointmentID = @Aid;
        END
        ELSE
        BEGIN
            THROW 50108, 'Invalid state parameter. Must be Present, Seated, or Dismissed.', 1;
        END

        IF @startedTran = 1
            COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @startedTran = 1 AND @@TRANCOUNT > 0
            ROLLBACK TRANSACTION;
        ;THROW;
    END CATCH
END

GO
/****** Object:  StoredProcedure [dbo].[UpdateSingleMessageStatus]    Script Date: 5/27/2026 7:11:45 PM ******/
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
/****** Object:  StoredProcedure [dbo].[UpdateWhatsAppDeliveryStatus]    Script Date: 5/27/2026 7:11:45 PM ******/
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
/****** Object:  StoredProcedure [dbo].[UpdateWhatsAppStatus]    Script Date: 5/27/2026 7:11:45 PM ******/
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
/****** Object:  StoredProcedure [dbo].[usp_CreateAlignerBatch]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE PROCEDURE dbo.usp_CreateAlignerBatch
    @AlignerSetID INT,
    @UpperAlignerCount INT,
    @LowerAlignerCount INT,
    @ManufactureDate DATE = NULL,
    @DeliveredToPatientDate DATE = NULL,
    @Days INT = NULL,
    @Notes NVARCHAR(255) = NULL,
    @IsActive BIT = 0,
    @IsLast BIT = 0,
    @HasUpperTemplate BIT = 0,
    @HasLowerTemplate BIT = 0,
    @NewBatchID INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @ExistingBatchCount INT;
        SELECT @ExistingBatchCount = COUNT(*)
        FROM dbo.tblAlignerBatches
        WHERE AlignerSetID = @AlignerSetID;

        IF @ExistingBatchCount > 0 AND (@HasUpperTemplate = 1 OR @HasLowerTemplate = 1)
            THROW 50004, 'Template flag can only be set on the first batch in a set', 1;

        IF @HasUpperTemplate = 1 AND @UpperAlignerCount < 1
            THROW 50005, 'HasUpperTemplate = 1 requires UpperAlignerCount >= 1', 1;
        IF @HasLowerTemplate = 1 AND @LowerAlignerCount < 1
            THROW 50006, 'HasLowerTemplate = 1 requires LowerAlignerCount >= 1', 1;

        DECLARE @RemainingUpper INT, @RemainingLower INT;

        SELECT
            @RemainingUpper = RemainingUpperAligners,
            @RemainingLower = RemainingLowerAligners
        FROM dbo.tblAlignerSets WITH (UPDLOCK)
        WHERE AlignerSetID = @AlignerSetID;

        IF @RemainingUpper IS NULL
            THROW 50001, 'AlignerSet not found', 1;

        DECLARE @UpperConsumed INT = @UpperAlignerCount - IIF(@HasUpperTemplate = 1, 1, 0);
        DECLARE @LowerConsumed INT = @LowerAlignerCount - IIF(@HasLowerTemplate = 1, 1, 0);

        IF @UpperConsumed > @RemainingUpper
        BEGIN
            DECLARE @UpperErrorMsg NVARCHAR(200) = 'Cannot add aligner batch: requested upper aligners ('
                + CAST(@UpperConsumed AS NVARCHAR) + ') exceed remaining count ('
                + CAST(@RemainingUpper AS NVARCHAR) + ')';
            THROW 50002, @UpperErrorMsg, 1;
        END

        IF @LowerConsumed > @RemainingLower
        BEGIN
            DECLARE @LowerErrorMsg NVARCHAR(200) = 'Cannot add aligner batch: requested lower aligners ('
                + CAST(@LowerConsumed AS NVARCHAR) + ') exceed remaining count ('
                + CAST(@RemainingLower AS NVARCHAR) + ')';
            THROW 50003, @LowerErrorMsg, 1;
        END

        IF @IsActive = 1
        BEGIN
            UPDATE dbo.tblAlignerBatches
            SET IsActive = 0
            WHERE AlignerSetID = @AlignerSetID AND IsActive = 1;
        END

        DECLARE @UpperStartSeq INT, @LowerStartSeq INT, @BatchSequence INT;
        DECLARE @UpperBase INT = CASE WHEN @HasUpperTemplate = 1 THEN -1 ELSE 0 END;
        DECLARE @LowerBase INT = CASE WHEN @HasLowerTemplate = 1 THEN -1 ELSE 0 END;

        SELECT
            @UpperStartSeq = ISNULL(MAX(UpperAlignerEndSequence), @UpperBase) + 1,
            @LowerStartSeq = ISNULL(MAX(LowerAlignerEndSequence), @LowerBase) + 1,
            @BatchSequence = ISNULL(MAX(BatchSequence), 0) + 1
        FROM dbo.tblAlignerBatches
        WHERE AlignerSetID = @AlignerSetID;

        IF @UpperAlignerCount = 0 SET @UpperStartSeq = NULL;
        IF @LowerAlignerCount = 0 SET @LowerStartSeq = NULL;

        INSERT INTO dbo.tblAlignerBatches (
            AlignerSetID, UpperAlignerCount, LowerAlignerCount,
            ManufactureDate, DeliveredToPatientDate, Days, Notes,
            IsActive, IsLast, BatchSequence,
            UpperAlignerStartSequence, LowerAlignerStartSequence,
            HasUpperTemplate, HasLowerTemplate
        ) VALUES (
            @AlignerSetID, @UpperAlignerCount, @LowerAlignerCount,
            @ManufactureDate, @DeliveredToPatientDate, @Days, @Notes,
            @IsActive, @IsLast, @BatchSequence,
            @UpperStartSeq, @LowerStartSeq,
            @HasUpperTemplate, @HasLowerTemplate
        );

        SET @NewBatchID = SCOPE_IDENTITY();

        UPDATE dbo.tblAlignerSets
        SET
            RemainingUpperAligners = RemainingUpperAligners - @UpperConsumed,
            RemainingLowerAligners = RemainingLowerAligners - @LowerConsumed
        WHERE AlignerSetID = @AlignerSetID;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        DECLARE @ErrorMessage NVARCHAR(4000) = ERROR_MESSAGE();
        DECLARE @ErrorSeverity INT = ERROR_SEVERITY();
        DECLARE @ErrorState INT = ERROR_STATE();
        RAISERROR(@ErrorMessage, @ErrorSeverity, @ErrorState);
    END CATCH
END
GO
/****** Object:  StoredProcedure [dbo].[usp_DeleteAlignerBatch]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROCEDURE dbo.usp_DeleteAlignerBatch
    @AlignerBatchID INT
AS
BEGIN
    SET NOCOUNT ON;

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @AlignerSetID INT,
                @UpperCount INT,
                @LowerCount INT,
                @HasUpperTemplate BIT,
                @HasLowerTemplate BIT;

        SELECT
            @AlignerSetID = AlignerSetID,
            @UpperCount = UpperAlignerCount,
            @LowerCount = LowerAlignerCount,
            @HasUpperTemplate = HasUpperTemplate,
            @HasLowerTemplate = HasLowerTemplate
        FROM dbo.tblAlignerBatches
        WHERE AlignerBatchID = @AlignerBatchID;

        IF @AlignerSetID IS NULL
            THROW 50020, 'Aligner batch not found', 1;

        DELETE FROM dbo.tblAlignerBatches
        WHERE AlignerBatchID = @AlignerBatchID;

        DECLARE @UpperRestored INT = @UpperCount - IIF(@HasUpperTemplate = 1, 1, 0);
        DECLARE @LowerRestored INT = @LowerCount - IIF(@HasLowerTemplate = 1, 1, 0);

        UPDATE dbo.tblAlignerSets
        SET
            RemainingUpperAligners = RemainingUpperAligners + @UpperRestored,
            RemainingLowerAligners = RemainingLowerAligners + @LowerRestored
        WHERE AlignerSetID = @AlignerSetID;

        ;WITH OrderedBatches AS (
            SELECT
                AlignerBatchID,
                ROW_NUMBER() OVER (ORDER BY ManufactureDate, AlignerBatchID) AS NewSequence
            FROM dbo.tblAlignerBatches
            WHERE AlignerSetID = @AlignerSetID
        )
        UPDATE b
        SET BatchSequence = o.NewSequence
        FROM dbo.tblAlignerBatches b
        INNER JOIN OrderedBatches o ON b.AlignerBatchID = o.AlignerBatchID;

        ;WITH Ordered AS (
            SELECT
                AlignerBatchID,
                UpperAlignerCount,
                LowerAlignerCount,
                HasUpperTemplate,
                HasLowerTemplate,
                ROW_NUMBER() OVER (ORDER BY ManufactureDate, AlignerBatchID) AS RowNum
            FROM dbo.tblAlignerBatches
            WHERE AlignerSetID = @AlignerSetID
        ),
        Cumulative AS (
            SELECT
                AlignerBatchID,
                UpperAlignerCount,
                LowerAlignerCount,
                HasUpperTemplate,
                HasLowerTemplate,
                RowNum,
                ISNULL(SUM(UpperAlignerCount) OVER (
                    ORDER BY RowNum
                    ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                ), 0) AS PrevUpperTotal,
                ISNULL(SUM(LowerAlignerCount) OVER (
                    ORDER BY RowNum
                    ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                ), 0) AS PrevLowerTotal,
                FIRST_VALUE(HasUpperTemplate) OVER (ORDER BY RowNum) AS FirstHasUpperTemplate,
                FIRST_VALUE(HasLowerTemplate) OVER (ORDER BY RowNum) AS FirstHasLowerTemplate
            FROM Ordered
        )
        UPDATE b
        SET
            UpperAlignerStartSequence = CASE
                WHEN c.UpperAlignerCount > 0
                THEN c.PrevUpperTotal + CASE WHEN c.FirstHasUpperTemplate = 1 THEN 0 ELSE 1 END
                ELSE NULL
            END,
            LowerAlignerStartSequence = CASE
                WHEN c.LowerAlignerCount > 0
                THEN c.PrevLowerTotal + CASE WHEN c.FirstHasLowerTemplate = 1 THEN 0 ELSE 1 END
                ELSE NULL
            END
        FROM dbo.tblAlignerBatches b
        INNER JOIN Cumulative c ON b.AlignerBatchID = c.AlignerBatchID;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;

        DECLARE @ErrorMessage NVARCHAR(4000) = ERROR_MESSAGE();
        DECLARE @ErrorSeverity INT = ERROR_SEVERITY();
        DECLARE @ErrorState INT = ERROR_STATE();
        RAISERROR(@ErrorMessage, @ErrorSeverity, @ErrorState);
    END CATCH
END

GO
/****** Object:  StoredProcedure [dbo].[usp_UpdateAlignerBatch]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE PROCEDURE dbo.usp_UpdateAlignerBatch
    @AlignerBatchID INT,
    @AlignerSetID INT,
    @UpperAlignerCount INT,
    @LowerAlignerCount INT,
    @Days INT = NULL,
    @Notes NVARCHAR(255) = NULL,
    @IsActive BIT = NULL,
    @IsLast BIT = NULL,
    @HasUpperTemplate BIT = NULL,
    @HasLowerTemplate BIT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET ANSI_WARNINGS ON;
    SET ARITHABORT ON;
    SET CONCAT_NULL_YIELDS_NULL ON;
    SET NUMERIC_ROUNDABORT OFF;

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @OldAlignerSetID INT,
                @OldUpperCount INT,
                @OldLowerCount INT,
                @OldDays INT,
                @OldHasUpperTemplate BIT,
                @OldHasLowerTemplate BIT,
                @CurrentDeliveredToPatientDate DATE,
                @CurrentBatchSequence INT;

        SELECT
            @OldAlignerSetID = AlignerSetID,
            @OldUpperCount = UpperAlignerCount,
            @OldLowerCount = LowerAlignerCount,
            @OldDays = Days,
            @OldHasUpperTemplate = HasUpperTemplate,
            @OldHasLowerTemplate = HasLowerTemplate,
            @CurrentDeliveredToPatientDate = DeliveredToPatientDate,
            @CurrentBatchSequence = BatchSequence
        FROM dbo.tblAlignerBatches
        WHERE AlignerBatchID = @AlignerBatchID;

        IF @OldAlignerSetID IS NULL
            THROW 50010, 'Aligner batch not found', 1;

        IF @AlignerSetID != @OldAlignerSetID
            THROW 50011, 'Cannot change AlignerSetID', 1;

        DECLARE @NewHasUpperTemplate BIT = ISNULL(@HasUpperTemplate, @OldHasUpperTemplate);
        DECLARE @NewHasLowerTemplate BIT = ISNULL(@HasLowerTemplate, @OldHasLowerTemplate);

        IF (@NewHasUpperTemplate = 1 OR @NewHasLowerTemplate = 1)
           AND EXISTS (
               SELECT 1 FROM dbo.tblAlignerBatches
               WHERE AlignerSetID = @AlignerSetID
                 AND AlignerBatchID <> @AlignerBatchID
                 AND BatchSequence < @CurrentBatchSequence
           )
            THROW 50015, 'Template flag can only be set on the first batch in a set', 1;

        IF @NewHasUpperTemplate = 1 AND @UpperAlignerCount < 1
            THROW 50016, 'HasUpperTemplate = 1 requires UpperAlignerCount >= 1', 1;
        IF @NewHasLowerTemplate = 1 AND @LowerAlignerCount < 1
            THROW 50017, 'HasLowerTemplate = 1 requires LowerAlignerCount >= 1', 1;

        DECLARE @RemainingUpper INT, @RemainingLower INT;

        SELECT
            @RemainingUpper = RemainingUpperAligners,
            @RemainingLower = RemainingLowerAligners
        FROM dbo.tblAlignerSets WITH (UPDLOCK)
        WHERE AlignerSetID = @AlignerSetID;

        DECLARE @OldUpperConsumed INT = @OldUpperCount - IIF(@OldHasUpperTemplate = 1, 1, 0);
        DECLARE @OldLowerConsumed INT = @OldLowerCount - IIF(@OldHasLowerTemplate = 1, 1, 0);
        DECLARE @NewUpperConsumed INT = @UpperAlignerCount - IIF(@NewHasUpperTemplate = 1, 1, 0);
        DECLARE @NewLowerConsumed INT = @LowerAlignerCount - IIF(@NewHasLowerTemplate = 1, 1, 0);

        IF @NewUpperConsumed > (@RemainingUpper + @OldUpperConsumed)
        BEGIN
            DECLARE @UpperErrorMsg NVARCHAR(200) = 'Cannot update aligner batch: requested upper aligners ('
                + CAST(@NewUpperConsumed AS NVARCHAR) + ') exceed available count ('
                + CAST(@RemainingUpper + @OldUpperConsumed AS NVARCHAR) + ')';
            THROW 50012, @UpperErrorMsg, 1;
        END

        IF @NewLowerConsumed > (@RemainingLower + @OldLowerConsumed)
        BEGIN
            DECLARE @LowerErrorMsg NVARCHAR(200) = 'Cannot update aligner batch: requested lower aligners ('
                + CAST(@NewLowerConsumed AS NVARCHAR) + ') exceed available count ('
                + CAST(@RemainingLower + @OldLowerConsumed AS NVARCHAR) + ')';
            THROW 50013, @LowerErrorMsg, 1;
        END

        IF @IsLast = 1
        BEGIN
            UPDATE dbo.tblAlignerBatches
            SET IsLast = 0
            WHERE AlignerSetID = @AlignerSetID
              AND AlignerBatchID != @AlignerBatchID
              AND IsLast = 1;
        END

        IF @IsActive = 1
        BEGIN
            IF @CurrentDeliveredToPatientDate IS NULL
                THROW 50014, 'Cannot set IsActive: batch must be delivered first', 1;

            UPDATE dbo.tblAlignerBatches
            SET IsActive = 0
            WHERE AlignerSetID = @AlignerSetID
              AND AlignerBatchID != @AlignerBatchID
              AND IsActive = 1;
        END

        DECLARE @CountsChanged BIT = 0;
        DECLARE @DaysChanged BIT = 0;
        DECLARE @TemplateChanged BIT = 0;

        IF @UpperAlignerCount != @OldUpperCount OR @LowerAlignerCount != @OldLowerCount
            SET @CountsChanged = 1;

        IF @NewHasUpperTemplate != @OldHasUpperTemplate OR @NewHasLowerTemplate != @OldHasLowerTemplate
            SET @TemplateChanged = 1;

        IF (@Days IS NULL AND @OldDays IS NOT NULL)
            OR (@Days IS NOT NULL AND @OldDays IS NULL)
            OR (@Days IS NOT NULL AND @OldDays IS NOT NULL AND @Days != @OldDays)
            SET @DaysChanged = 1;

        UPDATE dbo.tblAlignerBatches
        SET
            UpperAlignerCount = @UpperAlignerCount,
            LowerAlignerCount = @LowerAlignerCount,
            Days = @Days,
            Notes = @Notes,
            IsActive = ISNULL(@IsActive, IsActive),
            IsLast = ISNULL(@IsLast, IsLast),
            HasUpperTemplate = @NewHasUpperTemplate,
            HasLowerTemplate = @NewHasLowerTemplate
        WHERE AlignerBatchID = @AlignerBatchID;

        IF @CountsChanged = 1 OR @TemplateChanged = 1
        BEGIN
            ;WITH OrderedBatches AS (
                SELECT
                    AlignerBatchID,
                    ROW_NUMBER() OVER (ORDER BY ManufactureDate, AlignerBatchID) AS NewSequence
                FROM dbo.tblAlignerBatches
                WHERE AlignerSetID = @AlignerSetID
            )
            UPDATE b
            SET BatchSequence = o.NewSequence
            FROM dbo.tblAlignerBatches b
            INNER JOIN OrderedBatches o ON b.AlignerBatchID = o.AlignerBatchID
            WHERE b.BatchSequence != o.NewSequence;

            ;WITH Ordered AS (
                SELECT
                    AlignerBatchID,
                    UpperAlignerCount,
                    LowerAlignerCount,
                    HasUpperTemplate,
                    HasLowerTemplate,
                    ROW_NUMBER() OVER (ORDER BY ManufactureDate, AlignerBatchID) AS RowNum
                FROM dbo.tblAlignerBatches
                WHERE AlignerSetID = @AlignerSetID
            ),
            Cumulative AS (
                SELECT
                    AlignerBatchID,
                    UpperAlignerCount,
                    LowerAlignerCount,
                    RowNum,
                    ISNULL(SUM(UpperAlignerCount) OVER (
                        ORDER BY RowNum
                        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                    ), 0) AS PrevUpperTotal,
                    ISNULL(SUM(LowerAlignerCount) OVER (
                        ORDER BY RowNum
                        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                    ), 0) AS PrevLowerTotal,
                    FIRST_VALUE(HasUpperTemplate) OVER (ORDER BY RowNum) AS FirstHasUpperTemplate,
                    FIRST_VALUE(HasLowerTemplate) OVER (ORDER BY RowNum) AS FirstHasLowerTemplate
                FROM Ordered
            )
            UPDATE b
            SET
                UpperAlignerStartSequence = CASE
                    WHEN c.UpperAlignerCount > 0
                    THEN c.PrevUpperTotal + CASE WHEN c.FirstHasUpperTemplate = 1 THEN 0 ELSE 1 END
                    ELSE NULL
                END,
                LowerAlignerStartSequence = CASE
                    WHEN c.LowerAlignerCount > 0
                    THEN c.PrevLowerTotal + CASE WHEN c.FirstHasLowerTemplate = 1 THEN 0 ELSE 1 END
                    ELSE NULL
                END
            FROM dbo.tblAlignerBatches b
            INNER JOIN Cumulative c ON b.AlignerBatchID = c.AlignerBatchID;
        END

        DECLARE @UpperDelta INT = @NewUpperConsumed - @OldUpperConsumed;
        DECLARE @LowerDelta INT = @NewLowerConsumed - @OldLowerConsumed;

        IF @UpperDelta != 0 OR @LowerDelta != 0
        BEGIN
            UPDATE dbo.tblAlignerSets
            SET
                RemainingUpperAligners = RemainingUpperAligners - @UpperDelta,
                RemainingLowerAligners = RemainingLowerAligners - @LowerDelta
            WHERE AlignerSetID = @AlignerSetID;
        END

        IF @DaysChanged = 1
        BEGIN
            INSERT INTO dbo.tblAlignerActivityFlags (
                AlignerSetID,
                ActivityType,
                ActivityDescription,
                RelatedRecordID
            ) VALUES (
                @AlignerSetID,
                'DaysChanged',
                'Days changed from ' + ISNULL(CAST(@OldDays AS VARCHAR), 'not set')
                  + ' to ' + ISNULL(CAST(@Days AS VARCHAR), 'not set'),
                @AlignerBatchID
            );
        END

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        DECLARE @ErrorMessage NVARCHAR(4000) = ERROR_MESSAGE();
        DECLARE @ErrorSeverity INT = ERROR_SEVERITY();
        DECLARE @ErrorState INT = ERROR_STATE();
        RAISERROR(@ErrorMessage, @ErrorSeverity, @ErrorState);
    END CATCH
END
GO
/****** Object:  StoredProcedure [dbo].[usp_UpdateBatchStatus]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROCEDURE dbo.usp_UpdateBatchStatus
    @AlignerBatchID INT,
    @Action VARCHAR(20),
    @TargetDate DATETIME = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET ANSI_WARNINGS ON;
    SET ARITHABORT ON;
    SET CONCAT_NULL_YIELDS_NULL ON;
    SET NUMERIC_ROUNDABORT OFF;

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @AlignerSetID INT;
        DECLARE @BatchSequence INT;
        DECLARE @ManufactureDate DATE;
        DECLARE @DeliveredToPatientDate DATE;
        DECLARE @IsCurrentlyActive BIT;
        DECLARE @Message NVARCHAR(200);
        DECLARE @WasActivated BIT = 0;
        DECLARE @PreviouslyActiveBatchSequence INT = NULL;

        SELECT
            @AlignerSetID = AlignerSetID,
            @BatchSequence = BatchSequence,
            @ManufactureDate = ManufactureDate,
            @DeliveredToPatientDate = DeliveredToPatientDate,
            @IsCurrentlyActive = IsActive
        FROM dbo.tblAlignerBatches WITH (UPDLOCK)
        WHERE AlignerBatchID = @AlignerBatchID;

        IF @AlignerSetID IS NULL
        BEGIN
            THROW 50001, 'Aligner batch not found', 1;
        END

        IF @Action = 'MANUFACTURE'
        BEGIN
            IF @ManufactureDate IS NOT NULL AND @TargetDate IS NULL
            BEGIN
                SET @Message = 'Batch already manufactured';
                SELECT @AlignerBatchID AS AlignerBatchID, @BatchSequence AS BatchSequence,
                       @AlignerSetID AS AlignerSetID, @Action AS ActionPerformed,
                       CAST(1 AS BIT) AS Success, @Message AS Message,
                       CAST(0 AS BIT) AS WasActivated, @IsCurrentlyActive AS WasAlreadyActive,
                       CAST(0 AS BIT) AS WasAlreadyDelivered, NULL AS PreviouslyActiveBatchSequence;
                COMMIT TRANSACTION;
                RETURN;
            END

            DECLARE @NewManufactureDate DATE = CAST(ISNULL(@TargetDate, GETDATE()) AS DATE);

            UPDATE dbo.tblAlignerBatches
            SET ManufactureDate = @NewManufactureDate
            WHERE AlignerBatchID = @AlignerBatchID;

            SET @Message = CASE
                WHEN @ManufactureDate IS NOT NULL THEN 'Manufacture date updated'
                ELSE 'Batch marked as manufactured'
            END;
        END

        ELSE IF @Action = 'DELIVER'
        BEGIN
            IF @ManufactureDate IS NULL
            BEGIN
                THROW 50002, 'Cannot deliver: batch not yet manufactured', 1;
            END

            IF @DeliveredToPatientDate IS NOT NULL AND @TargetDate IS NULL
            BEGIN
                SET @Message = 'Batch already delivered';
                SELECT @AlignerBatchID AS AlignerBatchID, @BatchSequence AS BatchSequence,
                       @AlignerSetID AS AlignerSetID, @Action AS ActionPerformed,
                       CAST(1 AS BIT) AS Success, @Message AS Message,
                       CAST(0 AS BIT) AS WasActivated, @IsCurrentlyActive AS WasAlreadyActive,
                       CAST(1 AS BIT) AS WasAlreadyDelivered, NULL AS PreviouslyActiveBatchSequence;
                COMMIT TRANSACTION;
                RETURN;
            END

            DECLARE @NewDeliveryDate DATE = CAST(ISNULL(@TargetDate, GETDATE()) AS DATE);

            UPDATE dbo.tblAlignerBatches
            SET DeliveredToPatientDate = @NewDeliveryDate
            WHERE AlignerBatchID = @AlignerBatchID;

            DECLARE @MaxBatchSequence INT;
            SELECT @MaxBatchSequence = MAX(BatchSequence)
            FROM dbo.tblAlignerBatches
            WHERE AlignerSetID = @AlignerSetID;

            IF @BatchSequence = @MaxBatchSequence AND @IsCurrentlyActive = 0
            BEGIN
                SELECT TOP 1 @PreviouslyActiveBatchSequence = BatchSequence
                FROM dbo.tblAlignerBatches
                WHERE AlignerSetID = @AlignerSetID
                  AND IsActive = 1
                  AND AlignerBatchID != @AlignerBatchID;

                UPDATE dbo.tblAlignerBatches
                SET IsActive = 0
                WHERE AlignerSetID = @AlignerSetID
                  AND AlignerBatchID != @AlignerBatchID
                  AND IsActive = 1;

                UPDATE dbo.tblAlignerBatches
                SET IsActive = 1
                WHERE AlignerBatchID = @AlignerBatchID;

                SET @WasActivated = 1;
            END

            SET @Message = CASE
                WHEN @DeliveredToPatientDate IS NOT NULL THEN 'Delivery date updated'
                ELSE 'Batch marked as delivered'
            END;
        END

        ELSE IF @Action = 'UNDO_MANUFACTURE'
        BEGIN
            IF @DeliveredToPatientDate IS NOT NULL
            BEGIN
                THROW 50003, 'Cannot undo manufacture: batch already delivered. Undo delivery first.', 1;
            END

            UPDATE dbo.tblAlignerBatches
            SET ManufactureDate = NULL
            WHERE AlignerBatchID = @AlignerBatchID;

            SET @Message = 'Manufacture undone';
        END

        ELSE IF @Action = 'UNDO_DELIVERY'
        BEGIN
            -- Must deactivate batch before clearing delivery date
            -- (CHECK constraint requires active batches to have delivery date)
            UPDATE dbo.tblAlignerBatches
            SET DeliveredToPatientDate = NULL,
                IsActive = 0
            WHERE AlignerBatchID = @AlignerBatchID;

            SET @Message = 'Delivery undone (batch deactivated)';
        END

        ELSE
        BEGIN
            THROW 50004, 'Invalid action. Must be MANUFACTURE, DELIVER, UNDO_MANUFACTURE, or UNDO_DELIVERY', 1;
        END

        SELECT @AlignerBatchID AS AlignerBatchID, @BatchSequence AS BatchSequence,
               @AlignerSetID AS AlignerSetID, @Action AS ActionPerformed,
               CAST(1 AS BIT) AS Success, @Message AS Message,
               @WasActivated AS WasActivated, @IsCurrentlyActive AS WasAlreadyActive,
               CAST(0 AS BIT) AS WasAlreadyDelivered, @PreviouslyActiveBatchSequence AS PreviouslyActiveBatchSequence;

        COMMIT TRANSACTION;

    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0
            ROLLBACK TRANSACTION;

        DECLARE @ErrorMessage NVARCHAR(4000) = ERROR_MESSAGE();
        DECLARE @ErrorSeverity INT = ERROR_SEVERITY();
        DECLARE @ErrorState INT = ERROR_STATE();

        RAISERROR(@ErrorMessage, @ErrorSeverity, @ErrorState);
    END CATCH
END

GO
/****** Object:  StoredProcedure [dbo].[VisitsPhotoforOne]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROCEDURE [dbo].[VisitsPhotoforOne]
@ID int
AS
BEGIN
	SET NOCOUNT ON;
	
	SELECT 
		CASE 
			WHEN V.IPhoto = 1 AND v.PPhoto = 0 THEN 'Initial Photos'
			WHEN v.PPhoto = 1 AND V.IPhoto = 0 THEN 'Progress Photos'
			WHEN V.FPhoto = 1 THEN 'Final Photos' 
			WHEN V.IPhoto = 1 AND v.PPhoto = 1 THEN 'Initial and Progress'
		END AS Type,
		v.VisitDate
	FROM ShwanNew.dbo.tblvisits v
	WHERE (v.IPhoto = 1 OR v.FPhoto = 1 OR v.PPhoto = 1) 
		AND v.WorkID = (SELECT workid FROM tblwork w WHERE w.PersonID = @ID AND Status = 1)
END
GO
/****** Object:  Trigger [dbo].[trg_sync_AlignerDoctors]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
-- Create the sync trigger
CREATE TRIGGER trg_sync_AlignerDoctors
ON AlignerDoctors
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    INSERT INTO SyncQueue (TableName, RecordID, Operation, JsonData)
    SELECT
        'aligner_doctors',
        i.DrID,
        CASE WHEN EXISTS(SELECT 1 FROM deleted d WHERE d.DrID = i.DrID)
             THEN 'UPDATE'
             ELSE 'INSERT'
        END,
        (SELECT
            i.DrID as dr_id,
            i.DoctorName as doctor_name,
            i.DoctorEmail as doctor_email,
            i.LogoPath as logo_path
         FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
    FROM inserted i;
END
GO
ALTER TABLE [dbo].[AlignerDoctors] ENABLE TRIGGER [trg_sync_AlignerDoctors]
GO
/****** Object:  Trigger [dbo].[trg_SyncQueue_NotifyApp]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE TRIGGER trg_SyncQueue_NotifyApp
ON SyncQueue
AFTER INSERT
AS
BEGIN
    SET NOCOUNT ON;

    -- Only notify if at least one row was inserted
    IF (SELECT COUNT(*) FROM inserted) > 0
    BEGIN
        -- Call webhook asynchronously (don't wait for response)
        EXEC sp_NotifyAppOfSync;
    END
END

GO
ALTER TABLE [dbo].[SyncQueue] ENABLE TRIGGER [trg_SyncQueue_NotifyApp]
GO
/****** Object:  Trigger [dbo].[trg_sync_tblAlignerBatches]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TRIGGER [dbo].[trg_sync_tblAlignerBatches]
ON [dbo].[tblAlignerBatches]
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    IF EXISTS (SELECT 1 FROM deleted) AND NOT EXISTS (SELECT 1 FROM inserted)
    BEGIN
        INSERT INTO SyncQueue (TableName, RecordID, Operation, Status, CreatedAt)
        SELECT 'aligner_batches', d.AlignerBatchID, 'DELETE', 'pending', GETDATE()
        FROM deleted d;
        RETURN;
    END

    IF NOT EXISTS (
        SELECT 1 FROM inserted i
        LEFT JOIN deleted d ON i.AlignerBatchID = d.AlignerBatchID
        WHERE d.AlignerBatchID IS NULL
           OR (
               ISNULL(i.Days, -1) <> ISNULL(d.Days, -1)
               OR ISNULL(i.UpperAlignerCount, -1) <> ISNULL(d.UpperAlignerCount, -1)
               OR ISNULL(i.LowerAlignerCount, -1) <> ISNULL(d.LowerAlignerCount, -1)
               OR ISNULL(i.UpperAlignerStartSequence, -1) <> ISNULL(d.UpperAlignerStartSequence, -1)
               OR ISNULL(i.UpperAlignerEndSequence, -1) <> ISNULL(d.UpperAlignerEndSequence, -1)
               OR ISNULL(i.LowerAlignerStartSequence, -1) <> ISNULL(d.LowerAlignerStartSequence, -1)
               OR ISNULL(i.LowerAlignerEndSequence, -1) <> ISNULL(d.LowerAlignerEndSequence, -1)
               OR ISNULL(CAST(i.ManufactureDate AS VARCHAR), '') <> ISNULL(CAST(d.ManufactureDate AS VARCHAR), '')
               OR ISNULL(CAST(i.DeliveredToPatientDate AS VARCHAR), '') <> ISNULL(CAST(d.DeliveredToPatientDate AS VARCHAR), '')
               OR ISNULL(i.ValidityPeriod, -1) <> ISNULL(d.ValidityPeriod, -1)
               OR ISNULL(CAST(i.BatchExpiryDate AS VARCHAR), '') <> ISNULL(CAST(d.BatchExpiryDate AS VARCHAR), '')
               OR ISNULL(i.Notes, '') <> ISNULL(d.Notes, '')
               OR ISNULL(i.IsActive, 0) <> ISNULL(d.IsActive, 0)
               OR ISNULL(i.IsLast, 0) <> ISNULL(d.IsLast, 0)
               OR ISNULL(CAST(i.CreationDate AS VARCHAR), '') <> ISNULL(CAST(d.CreationDate AS VARCHAR), '')
               OR ISNULL(i.HasUpperTemplate, 0) <> ISNULL(d.HasUpperTemplate, 0)
               OR ISNULL(i.HasLowerTemplate, 0) <> ISNULL(d.HasLowerTemplate, 0)
           )
    )
    RETURN;

    INSERT INTO SyncQueue (TableName, RecordID, Operation, Status, CreatedAt)
    SELECT
        'aligner_batches',
        i.AlignerBatchID,
        CASE WHEN d.AlignerBatchID IS NULL THEN 'INSERT' ELSE 'UPDATE' END,
        'pending',
        GETDATE()
    FROM inserted i
    LEFT JOIN deleted d ON i.AlignerBatchID = d.AlignerBatchID;
END
GO
ALTER TABLE [dbo].[tblAlignerBatches] ENABLE TRIGGER [trg_sync_tblAlignerBatches]
GO
/****** Object:  Trigger [dbo].[trg_AlignerNotes_DoctorActivity]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TRIGGER trg_AlignerNotes_DoctorActivity
ON tblAlignerNotes
AFTER INSERT
AS
BEGIN
    SET NOCOUNT ON;

    INSERT INTO tblAlignerActivityFlags (
        AlignerSetID,
        ActivityType,
        ActivityDescription,
        RelatedRecordID
    )
    SELECT
        i.AlignerSetID,
        'DoctorNote',
        'Dr. ' + ISNULL(d.DoctorName, 'Unknown') + ' added a note',
        i.NoteID
    FROM inserted i
    INNER JOIN tblAlignerSets s ON i.AlignerSetID = s.AlignerSetID
    LEFT JOIN AlignerDoctors d ON s.AlignerDrID = d.DrID
    WHERE i.NoteType = 'Doctor';
END
GO
ALTER TABLE [dbo].[tblAlignerNotes] ENABLE TRIGGER [trg_AlignerNotes_DoctorActivity]
GO
/****** Object:  Trigger [dbo].[trg_sync_tblAlignerNotes]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE TRIGGER trg_sync_tblAlignerNotes
ON tblAlignerNotes
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    -- Only sync Lab notes (Doctor notes come from portal)
    -- For UPDATEs: Only add to queue if data actually changed
    INSERT INTO SyncQueue (TableName, RecordID, Operation, JsonData)
    SELECT
        'aligner_notes',
        i.NoteID,
        CASE WHEN EXISTS(SELECT 1 FROM deleted d WHERE d.NoteID = i.NoteID)
             THEN 'UPDATE'
             ELSE 'INSERT'
        END,
        (SELECT
            i.NoteID as note_id,
            i.AlignerSetID as aligner_set_id,
            i.NoteType as note_type,
            i.NoteText as note_text,
            i.CreatedAt as created_at,
            i.IsEdited as is_edited,
            i.EditedAt as edited_at,
            i.IsRead as is_read
         FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
    FROM inserted i
    LEFT JOIN deleted d ON i.NoteID = d.NoteID
    WHERE i.NoteType = 'Lab' -- Only sync lab notes
    AND (
        -- Always include INSERTs (no matching deleted record)
        d.NoteID IS NULL
        -- For UPDATEs, only include if ANY field actually changed
        OR (
            ISNULL(i.AlignerSetID, -1) <> ISNULL(d.AlignerSetID, -1)
            OR ISNULL(i.NoteType, '') <> ISNULL(d.NoteType, '')
            OR ISNULL(i.NoteText, '') <> ISNULL(d.NoteText, '')
            OR ISNULL(i.IsEdited, 0) <> ISNULL(d.IsEdited, 0)
            OR ISNULL(i.EditedAt, '1900-01-01') <> ISNULL(d.EditedAt, '1900-01-01')
            OR ISNULL(i.IsRead, 0) <> ISNULL(d.IsRead, 0)
        )
    );
END
  
GO
ALTER TABLE [dbo].[tblAlignerNotes] ENABLE TRIGGER [trg_sync_tblAlignerNotes]
GO
/****** Object:  Trigger [dbo].[trg_sync_tblAlignerNotes_Delete]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE TRIGGER trg_sync_tblAlignerNotes_Delete
ON tblAlignerNotes
AFTER DELETE
AS
BEGIN
    SET NOCOUNT ON;

    INSERT INTO SyncQueue (TableName, RecordID, Operation, JsonData)
    SELECT
        'aligner_notes',
        d.NoteID,
        'DELETE',
        (SELECT
            d.NoteID as note_id,
            d.AlignerSetID as aligner_set_id,
            d.NoteType as note_type
         FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
    FROM deleted d;
END
  
GO
ALTER TABLE [dbo].[tblAlignerNotes] ENABLE TRIGGER [trg_sync_tblAlignerNotes_Delete]
GO
/****** Object:  Trigger [dbo].[trg_AlignerSets_ResequenceOnUpdate]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- Create a trigger to handle resequencing when CreationDate changes
CREATE   TRIGGER trg_AlignerSets_ResequenceOnUpdate
ON [dbo].[tblAlignerSets]
AFTER UPDATE
AS
BEGIN
    -- Only run if CreationDate was updated
    IF UPDATE(CreationDate)
    BEGIN
        -- Identify affected WorkIDs
        WITH AffectedWorks AS (
            SELECT DISTINCT WorkID FROM inserted
        ),
        -- Resequence sets based on new CreationDate order
        OrderedSets AS (
            SELECT 
                AlignerSetID,
                ROW_NUMBER() OVER (PARTITION BY WorkID ORDER BY CreationDate, AlignerSetID) AS RowNum
            FROM [dbo].[tblAlignerSets] a
            WHERE EXISTS (SELECT 1 FROM AffectedWorks w WHERE w.WorkID = a.WorkID)
        )
        UPDATE [dbo].[tblAlignerSets]
        SET [SetSequence] = o.RowNum
        FROM [dbo].[tblAlignerSets] a
        JOIN OrderedSets o ON a.AlignerSetID = o.AlignerSetID;
    END
END;

GO
ALTER TABLE [dbo].[tblAlignerSets] ENABLE TRIGGER [trg_AlignerSets_ResequenceOnUpdate]
GO
/****** Object:  Trigger [dbo].[trg_AlignerSets_SetSequence]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE TRIGGER trg_AlignerSets_SetSequence
ON [dbo].[tblAlignerSets]
AFTER INSERT
AS
BEGIN
    -- Only auto-assign SetSequence if it was inserted as NULL
    WITH OrderedSets AS (
        SELECT 
            i.AlignerSetID,
            i.WorkID,
            (SELECT ISNULL(MAX(SetSequence), 0) + 1 
             FROM [dbo].[tblAlignerSets] 
             WHERE WorkID = i.WorkID) AS NextNum
        FROM inserted i
        WHERE i.SetSequence IS NULL
    )
    UPDATE [dbo].[tblAlignerSets]
    SET [SetSequence] = o.NextNum
    FROM [dbo].[tblAlignerSets] a
    INNER JOIN OrderedSets o ON a.AlignerSetID = o.AlignerSetID;
END;

GO
ALTER TABLE [dbo].[tblAlignerSets] ENABLE TRIGGER [trg_AlignerSets_SetSequence]
GO
/****** Object:  Trigger [dbo].[trg_AlignerSets_UpdateBatchDays]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE TRIGGER [dbo].[trg_AlignerSets_UpdateBatchDays]
ON [dbo].[tblAlignerSets]
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT UPDATE(Days)
    BEGIN
        RETURN;
    END

    IF NOT EXISTS (
        SELECT 1
        FROM inserted i
        INNER JOIN deleted d ON i.AlignerSetID = d.AlignerSetID
        WHERE ISNULL(i.Days, 0) <> ISNULL(d.Days, 0)
    )
    BEGIN
        RETURN;
    END

    UPDATE b
    SET b.Days = i.Days
    FROM [dbo].[tblAlignerBatches] b
    INNER JOIN inserted i ON b.AlignerSetID = i.AlignerSetID
    WHERE
        b.DeliveredToPatientDate IS NULL
        OR
        (
            b.DeliveredToPatientDate IS NOT NULL
            AND b.BatchExpiryDate >= CAST(GETDATE() AS DATE)
        )

    DECLARE @UpdatedCount INT = @@ROWCOUNT;

    IF @UpdatedCount > 0
    BEGIN
        PRINT 'Updated Days value for ' + CAST(@UpdatedCount AS VARCHAR(10)) + ' non-expired batch(es)';
    END
END
GO
ALTER TABLE [dbo].[tblAlignerSets] ENABLE TRIGGER [trg_AlignerSets_UpdateBatchDays]
GO
/****** Object:  Trigger [dbo].[trg_AlignerSets_UpdateWorkTotal]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE TRIGGER trg_AlignerSets_UpdateWorkTotal
ON tblAlignerSets
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    -- Only proceed if SetCost or Currency changed, or on INSERT/DELETE
    IF NOT EXISTS (SELECT * FROM inserted) OR NOT EXISTS (SELECT * FROM deleted)
       OR UPDATE(SetCost) OR UPDATE(Currency)
    BEGIN
        -- Handle INSERT and UPDATE (only for Typeofwork = 21)
        IF EXISTS (SELECT * FROM inserted)
        BEGIN
            UPDATE w SET
                TotalRequired = ISNULL((SELECT SUM(SetCost) FROM tblAlignerSets WHERE WorkID = w.workid), 0),
                Currency = ISNULL((SELECT TOP 1 Currency FROM tblAlignerSets WHERE WorkID = w.workid AND Currency IS NOT NULL), w.Currency)
            FROM tblWork w
            WHERE w.workid IN (SELECT DISTINCT WorkID FROM inserted WHERE WorkID IS NOT NULL)
              AND w.Typeofwork = 21;
        END

        -- Handle DELETE (only for Typeofwork = 21)
        IF EXISTS (SELECT * FROM deleted) AND NOT EXISTS (SELECT * FROM inserted)
        BEGIN
            UPDATE w SET
                TotalRequired = ISNULL((SELECT SUM(SetCost) FROM tblAlignerSets WHERE WorkID = w.workid), 0),
                Currency = ISNULL((SELECT TOP 1 Currency FROM tblAlignerSets WHERE WorkID = w.workid AND Currency IS NOT NULL), w.Currency)
            FROM tblWork w
            WHERE w.workid IN (SELECT DISTINCT WorkID FROM deleted WHERE WorkID IS NOT NULL)
              AND w.Typeofwork = 21;
        END
    END
END

GO
ALTER TABLE [dbo].[tblAlignerSets] ENABLE TRIGGER [trg_AlignerSets_UpdateWorkTotal]
GO
/****** Object:  Trigger [dbo].[trg_SetRemainingAlignersOnInsert]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TRIGGER trg_SetRemainingAlignersOnInsert
ON dbo.tblAlignerSets
AFTER INSERT
AS
BEGIN
    UPDATE s
    SET 
        RemainingUpperAligners = i.UpperAlignersCount,
        RemainingLowerAligners = i.LowerAlignersCount
    FROM dbo.tblAlignerSets s
    INNER JOIN inserted i ON s.AlignerSetID = i.AlignerSetID;
END;

GO
ALTER TABLE [dbo].[tblAlignerSets] ENABLE TRIGGER [trg_SetRemainingAlignersOnInsert]
GO
/****** Object:  Trigger [dbo].[trg_sync_tblAlignerSets]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE TRIGGER [dbo].[trg_sync_tblAlignerSets]
ON [dbo].[tblAlignerSets]
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (
        SELECT 1 FROM inserted i
        LEFT JOIN deleted d ON i.AlignerSetID = d.AlignerSetID
        WHERE d.AlignerSetID IS NULL
           OR (
               ISNULL(i.WorkID, -1) <> ISNULL(d.WorkID, -1)
               OR ISNULL(i.AlignerDrID, -1) <> ISNULL(d.AlignerDrID, -1)
               OR ISNULL(i.SetSequence, -1) <> ISNULL(d.SetSequence, -1)
               OR ISNULL(i.Type, '') <> ISNULL(d.Type, '')
               OR ISNULL(i.UpperAlignersCount, -1) <> ISNULL(d.UpperAlignersCount, -1)
               OR ISNULL(i.LowerAlignersCount, -1) <> ISNULL(d.LowerAlignersCount, -1)
               OR ISNULL(i.RemainingUpperAligners, -1) <> ISNULL(d.RemainingUpperAligners, -1)
               OR ISNULL(i.RemainingLowerAligners, -1) <> ISNULL(d.RemainingLowerAligners, -1)
               OR ISNULL(CAST(i.CreationDate AS VARCHAR), '') <> ISNULL(CAST(d.CreationDate AS VARCHAR), '')
               OR ISNULL(i.Days, -1) <> ISNULL(d.Days, -1)
               OR ISNULL(i.IsActive, 0) <> ISNULL(d.IsActive, 0)
               OR ISNULL(i.Notes, '') <> ISNULL(d.Notes, '')
               OR ISNULL(i.FolderPath, '') <> ISNULL(d.FolderPath, '')
               OR ISNULL(i.SetUrl, '') <> ISNULL(d.SetUrl, '')
               OR ISNULL(i.SetPdfUrl, '') <> ISNULL(d.SetPdfUrl, '')
               OR ISNULL(i.SetVideo, '') <> ISNULL(d.SetVideo, '')
               OR ISNULL(i.SetCost, -1) <> ISNULL(d.SetCost, -1)
               OR ISNULL(i.Currency, '') <> ISNULL(d.Currency, '')
               OR ISNULL(CAST(i.PdfUploadedAt AS VARCHAR), '') <> ISNULL(CAST(d.PdfUploadedAt AS VARCHAR), '')
               OR ISNULL(i.PdfUploadedBy, '') <> ISNULL(d.PdfUploadedBy, '')
               OR ISNULL(i.DriveFileId, '') <> ISNULL(d.DriveFileId, '')
           )
    )
    RETURN;

    INSERT INTO SyncQueue (TableName, RecordID, Operation, Status)
    SELECT
        'aligner_sets',
        i.AlignerSetID,
        CASE WHEN d.AlignerSetID IS NULL THEN 'INSERT' ELSE 'UPDATE' END,
        'pending'
    FROM inserted i
    LEFT JOIN deleted d ON i.AlignerSetID = d.AlignerSetID;
END
GO
ALTER TABLE [dbo].[tblAlignerSets] ENABLE TRIGGER [trg_sync_tblAlignerSets]
GO
/****** Object:  Trigger [dbo].[AppoPatientType]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE TRIGGER [dbo].[AppoPatientType]
   ON  [dbo].[tblappointments]
   AFTER insert
AS 
BEGIN
	-- SET NOCOUNT ON added to prevent extra result sets from
	-- interfering with SELECT statements.
	SET NOCOUNT ON;
	Declare @typ as tinyint
    -- Insert statements for trigger here
	Set @typ = (select pt.PatientTypeID from tblpatients pt  inner join inserted i on i.PersonID = pt.PersonID)
	If  @typ = 4
	Begin
	If  (select cast(i.AppDate as time) from inserted i inner join tblappointments p   on i.appointmentID = p.appointmentID) <> '0:0:0'
   -- If (select count(p.appointmentID) from tblappointments p inner join inserted i on p.PersonID = i.PersonID) = 1 
	Begin
	update tblpatients 
		set PatientTypeID = 3
	from  tblpatients pt  inner join inserted i on i.PersonID = pt.PersonID
		End
	End
END

GO
ALTER TABLE [dbo].[tblappointments] ENABLE TRIGGER [AppoPatientType]
GO
/****** Object:  Trigger [dbo].[trg_MessageStatusHistory]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TRIGGER trg_MessageStatusHistory
ON dbo.tblappointments
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    
    -- Only track changes to DeliveredWA
    IF UPDATE(DeliveredWA)
    BEGIN
        INSERT INTO dbo.tblMessageStatusHistory (
            AppointmentID, 
            WaMessageID, 
            StatusCode,
            StatusText,
            Timestamp
        )
        SELECT 
            i.appointmentID,
            i.WaMessageID,
            CASE 
                WHEN i.DeliveredWA = 'ERROR' THEN -1
                WHEN i.DeliveredWA = 'PENDING' THEN 0
                WHEN i.DeliveredWA = 'SERVER' THEN 1
                WHEN i.DeliveredWA = 'DEVICE' THEN 2
                WHEN i.DeliveredWA = 'READ' THEN 3
                WHEN i.DeliveredWA = 'PLAYED' THEN 4
                ELSE 0
            END AS StatusCode,
            i.DeliveredWA,
            GETDATE()
        FROM inserted i
        INNER JOIN deleted d ON i.appointmentID = d.appointmentID
        WHERE i.DeliveredWA <> ISNULL(d.DeliveredWA, '');
    END
END
GO
ALTER TABLE [dbo].[tblappointments] ENABLE TRIGGER [trg_MessageStatusHistory]
GO
/****** Object:  Trigger [dbo].[TrgCheckWire]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE TRIGGER [dbo].[TrgCheckWire]
   ON  [dbo].[tblCarriedWires] 
   After INSERT
AS 
BEGIN
	-- SET NOCOUNT ON added to prevent extra result sets from
	-- interfering with SELECT statements.
	SET NOCOUNT ON;

    if exists( Select i.PersonID from inserted i join dbo.tblCarriedWires W on i.PersonID =  w.PersonID)
	Begin
	if exists(Select i.PersonID from inserted i join dbo.tblCarriedWires W on i.PersonID =  w.PersonID 
	where i.WireBag <> w.WireBag or i.WireSlot <> w.WireSlot)
	
	Begin
	Rollback Transaction
	raiserror ('Patient already has a wire slot', 16, 1)
	End


	End



END

GO
ALTER TABLE [dbo].[tblCarriedWires] ENABLE TRIGGER [TrgCheckWire]
GO
/****** Object:  Trigger [dbo].[trg_DeleteEmployee]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TRIGGER [dbo].[trg_DeleteEmployee]
ON [dbo].[tblEmployees]
AFTER DELETE
AS
BEGIN
    DELETE FROM tblExpenseSubcategories
    WHERE SubcategoryName IN (SELECT employeeName FROM deleted) AND CategoryID = 5; -- CategoryID for Employees
END;

GO
ALTER TABLE [dbo].[tblEmployees] ENABLE TRIGGER [trg_DeleteEmployee]
GO
/****** Object:  Trigger [dbo].[trg_InsertEmployee]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TRIGGER trg_InsertEmployee
ON tblEmployees
AFTER INSERT
AS
BEGIN
    INSERT INTO tblExpenseSubcategories (SubcategoryName, CategoryID)
    SELECT employeeName, 5 -- CategoryID for Employees
    FROM inserted;
END;

GO
ALTER TABLE [dbo].[tblEmployees] ENABLE TRIGGER [trg_InsertEmployee]
GO
/****** Object:  Trigger [dbo].[trg_UpdateEmployee]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TRIGGER [dbo].[trg_UpdateEmployee]
ON [dbo].[tblEmployees]
AFTER UPDATE
AS
BEGIN
    -- Update SubcategoryName in tblExpenseSubcategories where the employeeName has changed
    UPDATE e
    SET e.SubcategoryName = i.employeeName
    FROM tblExpenseSubcategories e
    INNER JOIN deleted d ON e.SubcategoryName = d.employeeName    -- Old employee name
    INNER JOIN inserted i ON i.ID = d.ID          -- New employee name
    WHERE e.CategoryID = 5  -- CategoryID for Employees
      AND d.employeeName <> i.employeeName;  -- Only update if employee name has actually changed
END;


GO
ALTER TABLE [dbo].[tblEmployees] ENABLE TRIGGER [trg_UpdateEmployee]
GO
/****** Object:  Trigger [dbo].[PatientType]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE TRIGGER [dbo].[PatientType]
   ON  [dbo].[tblInvoice]
   AFTER insert
AS 
BEGIN
	-- SET NOCOUNT ON added to prevent extra result sets from
	-- interfering with SELECT statements.
	SET NOCOUNT ON;

    if (select count(v.invoiceID) from tblinvoice v inner join inserted i on v.workid = i.workid) = 1 
	begin

		declare @typ int, @pid int, @Worktype int

		set @pid = (select pt.personid from tblpatients pt inner join tblwork w on pt.PersonID = w.PersonID inner join inserted i 
		on i.workid = w.workid)

		set @typ = (select pt.PatientTypeID from tblpatients pt  where personid = @pid)
		set @Worktype = (select w.Typeofwork from tblwork w inner join inserted i on w.workid = i.workid)
		if  @typ = 4 or @typ = 3 or @typ = 5 or @typ = 6
		begin
			if @worktype = 1 
				begin
				update tblpatients 
				set PatientTypeID = 1
				where personid = @pid 
				End
				else
				begin
				update tblpatients 
				set PatientTypeID = 5
				where personid = @pid 
				end

		end

	end

END

GO
ALTER TABLE [dbo].[tblInvoice] ENABLE TRIGGER [PatientType]
GO
/****** Object:  Trigger [dbo].[trg_sync_tblPatients]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER OFF
GO

CREATE TRIGGER trg_sync_tblPatients
ON tblPatients
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    INSERT INTO SyncQueue (TableName, RecordID, Operation, JsonData)
    SELECT
        'patients',
        i.PersonID,
        CASE WHEN EXISTS(SELECT 1 FROM deleted d WHERE d.PersonID = i.PersonID)
             THEN 'UPDATE'
             ELSE 'INSERT'
        END,
        (SELECT
            i.PersonID as person_id,
            i.PatientName as patient_name,
            i.FirstName as first_name,
            i.LastName as last_name,
            i.Phone as phone
         FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
    FROM inserted i
    WHERE EXISTS (
        SELECT 1 FROM tblWork w
        INNER JOIN tblAlignerSets s ON w.workid = s.WorkID
        WHERE w.PersonID = i.PersonID
    );
END

GO
ALTER TABLE [dbo].[tblpatients] ENABLE TRIGGER [trg_sync_tblPatients]
GO
/****** Object:  Trigger [dbo].[MyTrigger]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE TRIGGER [dbo].[MyTrigger] ON [dbo].[tblvisits]
    AFTER UPDATE
AS 
    SET NOCOUNT ON;

    BEGIN 
        -- Initial Photos
        IF EXISTS (SELECT I.IPhoto FROM Inserted I INNER JOIN Deleted D ON I.ID = D.ID WHERE I.IPhoto = 1 AND D.IPhoto <> I.IPhoto)
        BEGIN
            UPDATE Wk
            SET Wk.IPhotoDate = I.VisitDate
            FROM tblWork Wk 
            INNER JOIN Inserted I ON Wk.WorkID = I.WorkID 
            WHERE I.IPhoto = 1;
        END
        ELSE IF EXISTS (SELECT I.IPhoto FROM Inserted I INNER JOIN Deleted D ON I.ID = D.ID WHERE I.IPhoto = 0 AND D.IPhoto <> I.IPhoto)
        BEGIN
            UPDATE Wk
            SET Wk.IPhotoDate = NULL
            FROM tblWork Wk 
            INNER JOIN Inserted I ON Wk.WorkID = I.WorkID 
            WHERE I.IPhoto = 0;
        END
        
        -- Final Photos
        IF EXISTS (SELECT I.FPhoto FROM Inserted I INNER JOIN Deleted D ON I.ID = D.ID WHERE I.FPhoto = 1 AND D.FPhoto <> I.FPhoto)
        BEGIN
            UPDATE Wk
            SET Wk.FPhotoDate = I.VisitDate, 
                Wk.Status = 2
            FROM tblWork Wk 
            INNER JOIN Inserted I ON Wk.WorkID = I.WorkID 
            WHERE I.FPhoto = 1;
        END
        ELSE IF EXISTS (SELECT I.FPhoto FROM Inserted I INNER JOIN Deleted D ON I.ID = D.ID WHERE I.FPhoto = 0 AND D.FPhoto <> I.FPhoto)
        BEGIN
            UPDATE Wk
            SET Wk.FPhotoDate = NULL, 
                Wk.Status = 1
            FROM tblWork Wk 
            INNER JOIN Inserted I ON Wk.WorkID = I.WorkID 
            WHERE I.FPhoto = 0;
        END
        
        -- Debond (Appliance Removed)
        IF EXISTS (SELECT I.ApplianceRemoved FROM Inserted I INNER JOIN Deleted D ON I.ID = D.ID WHERE I.ApplianceRemoved = 1 AND D.ApplianceRemoved <> I.ApplianceRemoved)
        BEGIN
            UPDATE Wk
            SET Wk.DebondDate = I.VisitDate
            FROM tblWork Wk 
            INNER JOIN Inserted I ON Wk.WorkID = I.WorkID 
            WHERE I.ApplianceRemoved = 1;
        END
        ELSE IF EXISTS (SELECT I.ApplianceRemoved FROM Inserted I INNER JOIN Deleted D ON I.ID = D.ID WHERE I.ApplianceRemoved = 0 AND D.ApplianceRemoved <> I.ApplianceRemoved)
        BEGIN
            UPDATE Wk
            SET Wk.DebondDate = NULL
            FROM tblWork Wk 
            INNER JOIN Inserted I ON Wk.WorkID = I.WorkID 
            WHERE I.ApplianceRemoved = 0;
        END
    END

GO
ALTER TABLE [dbo].[tblvisits] ENABLE TRIGGER [MyTrigger]
GO
/****** Object:  Trigger [dbo].[PhotoDelete]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE TRIGGER [dbo].[PhotoDelete] ON [dbo].[tblvisits]
    AFTER DELETE
AS 
    SET NOCOUNT ON;

    BEGIN 
        -- Initial Photos
        IF EXISTS (SELECT D.IPhoto FROM Deleted D WHERE D.IPhoto = 1)
        BEGIN
            UPDATE Wk 
            SET Wk.IPhotoDate = NULL
            FROM tblwork WK 
            INNER JOIN Deleted D ON Wk.WorkID = D.WorkID AND D.IPhoto = 1;
        END
        
        -- Final Photos
        IF EXISTS (SELECT D.FPhoto FROM Deleted D WHERE D.FPhoto = 1)
        BEGIN
            UPDATE Wk 
            SET Wk.FPhotoDate = NULL, 
                Wk.Status = 1
            FROM tblwork WK 
            INNER JOIN Deleted D ON Wk.WorkID = D.WorkID AND D.FPhoto = 1;
        END
        
        -- Debond (Appliance Removed)
        IF EXISTS (SELECT D.ApplianceRemoved FROM Deleted D WHERE D.ApplianceRemoved = 1)
        BEGIN
            UPDATE Wk 
            SET Wk.DebondDate = NULL
            FROM tblwork WK 
            INNER JOIN Deleted D ON Wk.WorkID = D.WorkID AND D.ApplianceRemoved = 1;
        END
    END

GO
ALTER TABLE [dbo].[tblvisits] ENABLE TRIGGER [PhotoDelete]
GO
/****** Object:  Trigger [dbo].[PhotoInsert]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE TRIGGER [dbo].[PhotoInsert] ON [dbo].[tblvisits]
    AFTER INSERT
AS 
    SET NOCOUNT ON;

    BEGIN 
        -- Initial Photos
        IF EXISTS (SELECT I.IPhoto FROM Inserted I WHERE I.IPhoto = 1)
        BEGIN
            UPDATE Wk 
            SET Wk.IPhotoDate = I.VisitDate
            FROM tblwork WK 
            INNER JOIN Inserted I ON Wk.WorkID = I.WorkID AND I.IPhoto = 1;
        END
        
        -- Final Photos
        IF EXISTS (SELECT I.FPhoto FROM Inserted I WHERE I.FPhoto = 1)
        BEGIN
            UPDATE Wk 
            SET Wk.FPhotoDate = I.VisitDate,
                Wk.Status = 2
            FROM tblwork WK 
            INNER JOIN Inserted I ON Wk.WorkID = I.WorkID AND I.FPhoto = 1;
        END
        
        -- Debond (Appliance Removed)
        IF EXISTS (SELECT I.ApplianceRemoved FROM Inserted I WHERE I.ApplianceRemoved = 1)
        BEGIN
            UPDATE Wk 
            SET Wk.DebondDate = I.VisitDate
            FROM tblwork WK 
            INNER JOIN Inserted I ON Wk.WorkID = I.WorkID AND I.ApplianceRemoved = 1;
        END
    END

GO
ALTER TABLE [dbo].[tblvisits] ENABLE TRIGGER [PhotoInsert]
GO
/****** Object:  Trigger [dbo].[trg_sync_tblWork]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE TRIGGER trg_sync_tblWork
ON tblWork
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    -- Only sync work records that have aligner sets
    INSERT INTO SyncQueue (TableName, RecordID, Operation, JsonData)
    SELECT
        'work',
        i.workid,
        CASE WHEN EXISTS(SELECT 1 FROM deleted d WHERE d.workid = i.workid)
             THEN 'UPDATE'
             ELSE 'INSERT'
        END,
        (SELECT
            i.workid as work_id,
            i.PersonID as person_id,
            i.Typeofwork as type_of_work,
            i.AdditionDate as addition_date
         FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
    FROM inserted i
    WHERE EXISTS (
        SELECT 1 FROM tblAlignerSets
        WHERE WorkID = i.workid
    );
END
GO
ALTER TABLE [dbo].[tblwork] ENABLE TRIGGER [trg_sync_tblWork]
GO
/****** Object:  Trigger [dbo].[trigPTypeandFinished]    Script Date: 5/27/2026 7:11:45 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE TRIGGER [dbo].[trigPTypeandFinished]
   ON  [dbo].[tblwork]
   AFTER update
AS
BEGIN
	SET NOCOUNT ON;

	-- Early exit: Only process if FPhotoDate was changed
	IF NOT UPDATE(FPhotoDate)
		RETURN;

	-- Early exit: Only process single-row updates
	if (select count(*) from inserted) > 1
	begin
		return;
	end;

	-- Early exit: Only process if FPhotoDate was set from NULL to a value
	If NOT EXISTS (
		SELECT 1 FROM inserted i
		INNER JOIN deleted d ON i.workid = d.workid
		WHERE i.FPhotoDate IS NOT NULL AND d.FPhotoDate IS NULL
	)
		RETURN;

	-- Now perform the actual work
	declare @wd int, @pid int
	set @wd = (select workid from inserted)
	set @pid = (select personid from tblwork where workid = @wd)

	-- Set work as Finished (Status = 2)
	Update tblwork
	Set Status = 2 where workid = @wd;

	-- Clean up carried wires
	Delete from dbo.tblCarriedWires where PersonID = @pid;

	-- If this is a specific work type (1), update patient type
	if (select Typeofwork from inserted) = 1
	Begin
		update tblpatients
		set PatientTypeID = 2
		where PersonID = @pid;
	End
END

GO
ALTER TABLE [dbo].[tblwork] ENABLE TRIGGER [trigPTypeandFinished]
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
EXEC sys.sp_addextendedproperty @name=N'MS_Description', @value=N'YouTube URL (unlisted) for case explanation video by Dr. Shwan' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblAlignerSets', @level2type=N'COLUMN',@level2name=N'SetVideo'
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
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'tables.[tblvisits].[UpperWireID]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'tblvisits', @level2type=N'INDEX',@level2name=N'tblvisits$UpperWireID'
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
EXEC sys.sp_addextendedproperty @name=N'MS_SSMA_SOURCE', @value=N'Dr.Shwan_V8.[qrylastvisit]' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_lastvisit'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPane1', @value=N'[0E232FF0-B466-11cf-A24F-00AA00A3EFFF, 1.00]
Begin DesignProperties = 
   Begin PaneConfigurations = 
      Begin PaneConfiguration = 0
         NumPanes = 4
         Configuration = "(H (1[42] 4[10] 2[7] 3) )"
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
               Top = 165
               Left = 57
               Bottom = 286
               Right = 227
            End
            DisplayFlags = 280
            TopColumn = 0
         End
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
         Begin Table = "tblwork"
            Begin Extent = 
               Top = 100
               Left = 1159
               Bottom = 297
               Right = 1410
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
         Width = 1500' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_Report'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPane2', @value=N'
         Width = 1500
      End
   End
   Begin CriteriaPane = 
      Begin ColumnWidths = 11
         Column = 2300
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
EXEC sys.sp_addextendedproperty @name=N'MS_DiagramPaneCount', @value=2 , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'VIEW',@level1name=N'V_Report'
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
