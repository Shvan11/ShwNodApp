-- =====================================================
-- Migration: Drop ActualAmount and ActualCur columns
-- Date: 2025-10-29
-- Description: Remove old columns after verifying new
--              USDReceived/IQDReceived system works correctly
--
-- WARNING: This is IRREVERSIBLE! Only run after:
-- 1. Migration completed successfully
-- 2. Application updated to use new columns
-- 3. Thorough testing completed
-- 4. Backup created
-- =====================================================

USE [your_database_name]; -- Update with actual database name
GO

-- Safety check: Verify new columns exist
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'tblInvoice' AND COLUMN_NAME = 'USDReceived'
)
BEGIN
    PRINT 'ERROR: USDReceived column does not exist!';
    PRINT 'Run add_usd_iqd_received_columns.sql first';
    RETURN;
END

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'tblInvoice' AND COLUMN_NAME = 'IQDReceived'
)
BEGIN
    PRINT 'ERROR: IQDReceived column does not exist!';
    PRINT 'Run add_usd_iqd_received_columns.sql first';
    RETURN;
END

-- Final verification before dropping
DECLARE @Verification VARCHAR(MAX);

PRINT '=== FINAL VERIFICATION BEFORE DROPPING OLD COLUMNS ===';
PRINT '';

-- Check for any data inconsistencies
DECLARE @Inconsistencies INT;

SELECT @Inconsistencies = COUNT(*)
FROM dbo.tblInvoice
WHERE
    -- Records with ActualAmount but no corresponding USD/IQD value
    (ActualCur = 'USD' AND ActualAmount IS NOT NULL AND USDReceived = 0)
    OR (ActualCur = 'IQD' AND ActualAmount IS NOT NULL AND IQDReceived = 0)
    -- Records with USD/IQD but no ActualAmount (this is OK for new records)
    -- OR ((USDReceived > 0 OR IQDReceived > 0) AND ActualAmount IS NULL);

PRINT 'Inconsistencies found: ' + CAST(@Inconsistencies AS VARCHAR);

IF @Inconsistencies > 0
BEGIN
    PRINT '';
    PRINT 'WARNING: Found data inconsistencies!';
    PRINT 'Showing first 10 problematic records:';

    SELECT TOP 10
        invoiceID,
        ActualAmount,
        ActualCur,
        USDReceived,
        IQDReceived,
        Dateofpayment
    FROM dbo.tblInvoice
    WHERE
        (ActualCur = 'USD' AND ActualAmount IS NOT NULL AND USDReceived = 0)
        OR (ActualCur = 'IQD' AND ActualAmount IS NOT NULL AND IQDReceived = 0);

    PRINT '';
    PRINT 'Please fix inconsistencies before dropping old columns!';
    RETURN;
END

PRINT '✓ No data inconsistencies found';
PRINT '';

-- Show summary before dropping
PRINT '=== Summary of data to be preserved ===';
SELECT
    COUNT(*) as TotalRecords,
    SUM(CASE WHEN USDReceived > 0 THEN 1 ELSE 0 END) as RecordsWithUSD,
    SUM(CASE WHEN IQDReceived > 0 THEN 1 ELSE 0 END) as RecordsWithIQD,
    SUM(CASE WHEN USDReceived > 0 AND IQDReceived > 0 THEN 1 ELSE 0 END) as MixedPayments,
    SUM(CASE WHEN USDReceived = 0 AND IQDReceived = 0 THEN 1 ELSE 0 END) as HistoricalRecords
FROM dbo.tblInvoice;

PRINT '';
PRINT '=== PROCEEDING WITH COLUMN DROP ===';
PRINT 'This action is IRREVERSIBLE!';
PRINT '';

BEGIN TRANSACTION;

-- Drop the old columns
PRINT 'Dropping ActualAmount column...';
ALTER TABLE dbo.tblInvoice DROP COLUMN ActualAmount;
PRINT '✓ ActualAmount dropped';

PRINT 'Dropping ActualCur column...';
ALTER TABLE dbo.tblInvoice DROP COLUMN ActualCur;
PRINT '✓ ActualCur dropped';

COMMIT TRANSACTION;

PRINT '';
PRINT '=== MIGRATION COMPLETE ===';
PRINT '✓ Old columns removed successfully';
PRINT '✓ System now exclusively uses USDReceived/IQDReceived';
PRINT '';
PRINT 'Final schema:';
PRINT '  - USDReceived: Exact USD received from patient';
PRINT '  - IQDReceived: Exact IQD received from patient';
PRINT '  - Change: IQD given back to patient (always IQD)';
PRINT '  - Amountpaid: Amount registered to account (in account currency)';

GO
