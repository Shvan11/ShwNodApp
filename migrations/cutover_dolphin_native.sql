/* ============================================================================
   Dolphin-native cutover: drop the cross-DB stored procs (ShwanNew side only)

   After app code was switched to read/write the LOCAL clone tables
   (dbo.tblTimePoints / dbo.tblTimePointImages / dbo.tblImageTypes), these six
   ShwanNew procedures — the only objects that still cross-database into
   DolphinPlatform — are no longer called. Dropping them removes the app DB's
   last reference to DolphinPlatform.

   IMPORTANT: these procedures live in ShwanNew / ShwanNew_Test, NOT in
   DolphinPlatform. This script touches ShwanNew_Test only; the DolphinPlatform
   database is left completely intact.

   Idempotent. Run AFTER the code cutover is deployed and verified:
     sqlcmd -S "Clinic\DOLPHIN" -U Staff -P ortho2000 -d ShwanNew_Test -i migrations/cutover_dolphin_native.sql
   ============================================================================ */

SET NOCOUNT ON;
GO

IF OBJECT_ID('dbo.ListDolphTimePoints', 'P') IS NOT NULL DROP PROCEDURE dbo.ListDolphTimePoints;
IF OBJECT_ID('dbo.ListTimePointImgs',  'P') IS NOT NULL DROP PROCEDURE dbo.ListTimePointImgs;
IF OBJECT_ID('dbo.CheckDolphin',       'P') IS NOT NULL DROP PROCEDURE dbo.CheckDolphin;
IF OBJECT_ID('dbo.AddDolph',           'P') IS NOT NULL DROP PROCEDURE dbo.AddDolph;
IF OBJECT_ID('dbo.ChkTimePoint',       'P') IS NOT NULL DROP PROCEDURE dbo.ChkTimePoint;
IF OBJECT_ID('dbo.AddTimePoint',       'P') IS NOT NULL DROP PROCEDURE dbo.AddTimePoint;
GO

/* Verification: expect ZERO rows — no remaining object references DolphinPlatform. */
SELECT o.type_desc AS [type], o.name AS [object]
FROM sys.sql_modules m
JOIN sys.objects o ON m.object_id = o.object_id
WHERE m.definition LIKE '%DolphinPlatform%'
ORDER BY o.type_desc, o.name;
GO
