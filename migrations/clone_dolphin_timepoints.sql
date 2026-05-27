/* ============================================================================
   Clone Dolphin reference data into ShwanNew  (tables + data only)

   Creates app-native copies of DolphinPlatform.dbo.TimePoints + TimePointImages
   (re-keyed on PersonID, the redundant Patients shim dropped) plus the
   ImageTypes code->label dictionary. Reads DolphinPlatform READ-ONLY (SELECT
   only); all writes target the local ShwanNew tables. NO procs / triggers /
   app code are changed here, and DolphinPlatform is never modified.

   Idempotent: re-running inserts 0 timepoint rows (guarded on the Dolphin*
   provenance GUIDs) and re-upserts the dictionary. Run with:
     sqlcmd -S "Clinic\DOLPHIN" -U Staff -P ortho2000 -d ShwanNew_Test -i migrations/clone_dolphin_timepoints.sql
   ============================================================================ */

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;   -- required for ShwanNew (see CLAUDE.md / tblwork)
SET NOCOUNT ON;
GO

/* ---------------------------------------------------------------------------
   1. Schema
   --------------------------------------------------------------------------- */
IF OBJECT_ID('dbo.tblTimePoints', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.tblTimePoints (
        TimePointID    int IDENTITY(1,1) NOT NULL CONSTRAINT PK_tblTimePoints PRIMARY KEY,
        PersonID       int           NOT NULL,           -- was Patients.patOtherID (GUID linkage removed)
        tpCode         int           NOT NULL,           -- sequential per patient (0,1,2,...), authoritative handle
        tpDescription  varchar(50)   NULL,               -- Initial / Progress / Final (+ legacy variants, verbatim)
        tpDateTime     date          NULL,               -- session date, date-only (avoids UTC shift)
        CreatedDate    datetime2(0)  NOT NULL CONSTRAINT DF_tblTimePoints_Created DEFAULT SYSDATETIME(),
        DolphinTpID    uniqueidentifier NULL,            -- provenance: original TimePoints.tpID
        DolphinPatID   uniqueidentifier NULL             -- provenance: original Patients.patID
    );

    CREATE UNIQUE INDEX UX_tblTimePoints_Person_tpCode ON dbo.tblTimePoints(PersonID, tpCode);
    CREATE INDEX IX_tblTimePoints_Person ON dbo.tblTimePoints(PersonID);
    CREATE UNIQUE INDEX UX_tblTimePoints_DolphinTpID ON dbo.tblTimePoints(DolphinTpID) WHERE DolphinTpID IS NOT NULL;

    PRINT 'Created dbo.tblTimePoints';
END
ELSE PRINT 'dbo.tblTimePoints already exists - skipping create';
GO

IF OBJECT_ID('dbo.tblTimePointImages', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.tblTimePointImages (
        TimePointImageID int IDENTITY(1,1) NOT NULL CONSTRAINT PK_tblTimePointImages PRIMARY KEY,
        TimePointID    int           NOT NULL
            CONSTRAINT FK_tblTPImages_TP REFERENCES dbo.tblTimePoints(TimePointID) ON DELETE CASCADE,
        PersonID       int           NOT NULL,           -- denormalized for convenient lookup
        ImageType      char(2)       NULL,               -- view code: 10/12/13/20/21/22/23/24 (+ x-ray slots 50/51...), was tpiImageType
        ImageFile      varchar(50)   NULL,               -- e.g. "155806.I10", was tpiImageFile
        ImageDate      date          NULL,               -- was tpiImageDate
        Title          varchar(50)   NULL,               -- was tpiTitle / tipTitle
        DolphinTpiID   uniqueidentifier NULL             -- provenance: original TimePointImages.tpiID
    );

    CREATE INDEX IX_tblTPImages_TP ON dbo.tblTimePointImages(TimePointID);
    CREATE INDEX IX_tblTPImages_Person ON dbo.tblTimePointImages(PersonID);

    PRINT 'Created dbo.tblTimePointImages';
END
ELSE PRINT 'dbo.tblTimePointImages already exists - skipping create';
GO

IF OBJECT_ID('dbo.tblImageTypes', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.tblImageTypes (
        ImageTypeCode  char(2)          NOT NULL CONSTRAINT PK_tblImageTypes PRIMARY KEY,  -- matches tblTimePointImages.ImageType
        Description    varchar(50)      NULL,             -- human label, e.g. 'IntraOral Center'
        DolphinItypID  uniqueidentifier NULL             -- provenance: original ImageTypes.itypID
    );
    PRINT 'Created dbo.tblImageTypes';
END
ELSE PRINT 'dbo.tblImageTypes already exists - skipping create';
GO

/* ---------------------------------------------------------------------------
   2. Data load (cross-DB, same instance). Transactional + re-runnable.
   --------------------------------------------------------------------------- */
BEGIN TRANSACTION;

-- 2a) TimePoints: resolve PersonID via patOtherID; skip patients with no ShwanNew match
INSERT INTO dbo.tblTimePoints (PersonID, tpCode, tpDescription, tpDateTime, DolphinTpID, DolphinPatID)
SELECT TRY_CAST(P.patOtherID AS int),
       TRY_CAST(T.tpCode AS int),
       T.tpDescription,
       CAST(T.tpDateTime AS date),
       T.tpID,
       T.patID
FROM DolphinPlatform.dbo.TimePoints  T
JOIN DolphinPlatform.dbo.Patients    P  ON P.patID = T.patID
WHERE TRY_CAST(P.patOtherID AS int) IS NOT NULL
  AND TRY_CAST(T.tpCode AS int)     IS NOT NULL
  AND EXISTS (SELECT 1 FROM dbo.tblpatients sp WHERE sp.PersonID = TRY_CAST(P.patOtherID AS int))
  AND NOT EXISTS (SELECT 1 FROM dbo.tblTimePoints x WHERE x.DolphinTpID = T.tpID);

PRINT 'tblTimePoints rows inserted this run: ' + CAST(@@ROWCOUNT AS varchar(12));

-- 2b) TimePointImages: FK wired through the provenance GUID stored above
INSERT INTO dbo.tblTimePointImages (TimePointID, PersonID, ImageType, ImageFile, ImageDate, Title, DolphinTpiID)
SELECT nt.TimePointID,
       nt.PersonID,
       I.tpiImageType,
       I.tpiImageFile,
       CAST(I.tpiImageDate AS date),
       COALESCE(I.tpiTitle, I.tipTitle),
       I.tpiID
FROM DolphinPlatform.dbo.TimePointImages I
JOIN dbo.tblTimePoints nt ON nt.DolphinTpID = I.tpID
WHERE NOT EXISTS (SELECT 1 FROM dbo.tblTimePointImages x WHERE x.DolphinTpiID = I.tpiID);

PRINT 'tblTimePointImages rows inserted this run: ' + CAST(@@ROWCOUNT AS varchar(12));

COMMIT TRANSACTION;
GO

/* ---------------------------------------------------------------------------
   2c. ImageTypes dictionary (read-only SELECT from DolphinPlatform -> local copy).
       MERGE keeps it re-runnable. No FK is enforced from tblTimePointImages.ImageType,
       so codes used in image data but absent from Dolphin's dictionary (e.g. 25/60)
       simply have no description here.
   --------------------------------------------------------------------------- */
MERGE dbo.tblImageTypes AS t
USING (SELECT itypCode, itypDescription, itypID
       FROM DolphinPlatform.dbo.ImageTypes
       WHERE itypCode IS NOT NULL AND LEN(itypCode) <= 2) AS s
   ON t.ImageTypeCode = s.itypCode COLLATE DATABASE_DEFAULT
WHEN MATCHED THEN
    UPDATE SET Description = s.itypDescription, DolphinItypID = s.itypID
WHEN NOT MATCHED BY TARGET THEN
    INSERT (ImageTypeCode, Description, DolphinItypID)
    VALUES (s.itypCode, s.itypDescription, s.itypID);

DECLARE @itypN int = (SELECT COUNT(*) FROM dbo.tblImageTypes);
PRINT 'tblImageTypes total rows: ' + CAST(@itypN AS varchar(12));
GO

/* ---------------------------------------------------------------------------
   3. Validation report
   --------------------------------------------------------------------------- */
SELECT (SELECT COUNT(*) FROM dbo.tblTimePoints)                          AS tp_loaded,
       (SELECT COUNT(*) FROM DolphinPlatform.dbo.TimePoints)             AS tp_source,
       (SELECT COUNT(*) FROM dbo.tblTimePointImages)                     AS img_loaded,
       (SELECT COUNT(*) FROM DolphinPlatform.dbo.TimePointImages)        AS img_source;

-- Source timepoints intentionally skipped (no matching ShwanNew patient / bad code)
SELECT COUNT(*) AS tp_skipped
FROM DolphinPlatform.dbo.TimePoints T
JOIN DolphinPlatform.dbo.Patients   P ON P.patID = T.patID
WHERE NOT EXISTS (SELECT 1 FROM dbo.tblTimePoints x WHERE x.DolphinTpID = T.tpID);

-- Referential sanity: any loaded timepoint whose PersonID is not a real patient (expect 0)
SELECT COUNT(*) AS tp_orphan_personid
FROM dbo.tblTimePoints tp
WHERE NOT EXISTS (SELECT 1 FROM dbo.tblpatients sp WHERE sp.PersonID = tp.PersonID);
GO
