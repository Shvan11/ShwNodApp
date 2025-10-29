-- =====================================================
-- Migration: Add USDReceived and IQDReceived columns
-- Date: 2025-10-29
-- Description: Migrate from ActualAmount/ActualCur to
--              explicit USD/IQD tracking for dual-currency
--              payment system with mixed payment support
-- =====================================================

USE [your_database_name]; -- Update with actual database name
GO

BEGIN TRANSACTION;

-- =====================================================
-- STEP 1: Add new columns with default values
-- =====================================================
PRINT 'Step 1: Adding USDReceived and IQDReceived columns...';

ALTER TABLE dbo.tblInvoice ADD
    USDReceived INT NOT NULL DEFAULT 0,
    IQDReceived INT NOT NULL DEFAULT 0;

PRINT '✓ Columns added successfully';
GO

-- =====================================================
-- STEP 2: Migrate existing data
-- =====================================================
PRINT 'Step 2: Migrating data from ActualAmount/ActualCur...';

-- Migrate USD payments (139 records)
UPDATE dbo.tblInvoice
SET USDReceived = ActualAmount
WHERE ActualCur = 'USD' AND ActualAmount IS NOT NULL;

PRINT '✓ Migrated USD payments';

-- Migrate IQD payments (1,990 records)
UPDATE dbo.tblInvoice
SET IQDReceived = ActualAmount
WHERE ActualCur = 'IQD' AND ActualAmount IS NOT NULL;

PRINT '✓ Migrated IQD payments';

-- Records with NULL ActualAmount remain as USDReceived=0, IQDReceived=0
-- This represents historical data where cash tracking wasn't implemented
PRINT '✓ Historical records (27,615) remain with USDReceived=0, IQDReceived=0';

GO

-- =====================================================
-- STEP 3: Verify migration
-- =====================================================
PRINT 'Step 3: Verifying migration...';

DECLARE @TotalRecords INT;
DECLARE @USDMigrated INT;
DECLARE @IQDMigrated INT;
DECLARE @HistoricalRecords INT;
DECLARE @Errors INT;

SELECT @TotalRecords = COUNT(*) FROM dbo.tblInvoice;
SELECT @USDMigrated = COUNT(*) FROM dbo.tblInvoice WHERE USDReceived > 0;
SELECT @IQDMigrated = COUNT(*) FROM dbo.tblInvoice WHERE IQDReceived > 0;
SELECT @HistoricalRecords = COUNT(*) FROM dbo.tblInvoice WHERE USDReceived = 0 AND IQDReceived = 0;

-- Check for migration errors (records that should have been migrated but weren't)
SELECT @Errors = COUNT(*)
FROM dbo.tblInvoice
WHERE ActualAmount IS NOT NULL
  AND ActualAmount > 0
  AND USDReceived = 0
  AND IQDReceived = 0;

PRINT '=== Migration Verification Report ===';
PRINT 'Total invoice records: ' + CAST(@TotalRecords AS VARCHAR);
PRINT 'USD payments migrated: ' + CAST(@USDMigrated AS VARCHAR);
PRINT 'IQD payments migrated: ' + CAST(@IQDMigrated AS VARCHAR);
PRINT 'Historical records (no cash data): ' + CAST(@HistoricalRecords AS VARCHAR);
PRINT 'Migration errors: ' + CAST(@Errors AS VARCHAR);

IF @Errors > 0
BEGIN
    PRINT 'ERROR: Found records that should have been migrated but were not!';
    PRINT 'Rolling back transaction...';

    -- Show problematic records
    SELECT TOP 10
        invoiceID,
        ActualAmount,
        ActualCur,
        USDReceived,
        IQDReceived,
        Dateofpayment
    FROM dbo.tblInvoice
    WHERE ActualAmount IS NOT NULL
      AND ActualAmount > 0
      AND USDReceived = 0
      AND IQDReceived = 0;

    ROLLBACK TRANSACTION;
    RETURN;
END

PRINT '✓ Migration verification passed!';

-- =====================================================
-- STEP 4: Create validation constraints (optional)
-- =====================================================
PRINT 'Step 4: Adding validation constraints...';

-- Ensure at least one currency is received (or both are 0 for historical records)
ALTER TABLE dbo.tblInvoice
ADD CONSTRAINT CHK_Invoice_CashReceived
CHECK (USDReceived >= 0 AND IQDReceived >= 0);

PRINT '✓ Validation constraints added';

GO

-- =====================================================
-- STEP 5: Create helpful views for analytics
-- =====================================================
PRINT 'Step 5: Creating analytics views...';

-- View: Daily cash flow summary
IF OBJECT_ID('dbo.vw_DailyCashFlow', 'V') IS NOT NULL
    DROP VIEW dbo.vw_DailyCashFlow;
GO

CREATE VIEW dbo.vw_DailyCashFlow AS
SELECT
    Dateofpayment,
    SUM(USDReceived) as USD_Received,
    SUM(IQDReceived) as IQD_Received,
    SUM(CASE WHEN Change IS NOT NULL THEN Change ELSE 0 END) as IQD_Change_Given,
    SUM(IQDReceived) - SUM(CASE WHEN Change IS NOT NULL THEN Change ELSE 0 END) as Net_IQD_Flow,
    COUNT(*) as Total_Payments
FROM dbo.tblInvoice
WHERE USDReceived > 0 OR IQDReceived > 0  -- Exclude historical records without cash data
GROUP BY Dateofpayment;
GO

PRINT '✓ Analytics view created: vw_DailyCashFlow';

-- View: Mixed payments
IF OBJECT_ID('dbo.vw_MixedPayments', 'V') IS NOT NULL
    DROP VIEW dbo.vw_MixedPayments;
GO

CREATE VIEW dbo.vw_MixedPayments AS
SELECT
    i.invoiceID,
    i.workid,
    i.Dateofpayment,
    i.USDReceived,
    i.IQDReceived,
    i.Change,
    i.Amountpaid,
    w.PersonID,
    w.Currency as AccountCurrency
FROM dbo.tblInvoice i
INNER JOIN dbo.tblwork w ON i.workid = w.workid
WHERE i.USDReceived > 0 AND i.IQDReceived > 0;  -- Both currencies received
GO

PRINT '✓ Analytics view created: vw_MixedPayments';

GO

-- =====================================================
-- COMMIT TRANSACTION
-- =====================================================
PRINT '=== Migration Complete ===';
PRINT 'Committing transaction...';
COMMIT TRANSACTION;
PRINT '✓ Transaction committed successfully!';
PRINT '';
PRINT 'NEXT STEPS:';
PRINT '1. Update application code to use USDReceived/IQDReceived';
PRINT '2. Test thoroughly with new payment modal';
PRINT '3. After verification, run drop_old_columns.sql to remove ActualAmount/ActualCur';
GO

-- =====================================================
-- Sample queries for testing
-- =====================================================
PRINT '=== Sample Test Queries ===';
PRINT '';
PRINT '-- View recent payments with new structure:';
PRINT 'SELECT TOP 10 invoiceID, Dateofpayment, USDReceived, IQDReceived, Change, Amountpaid';
PRINT 'FROM dbo.tblInvoice';
PRINT 'WHERE USDReceived > 0 OR IQDReceived > 0';
PRINT 'ORDER BY Dateofpayment DESC;';
PRINT '';
PRINT '-- View daily cash flow:';
PRINT 'SELECT * FROM dbo.vw_DailyCashFlow';
PRINT 'WHERE Dateofpayment >= DATEADD(day, -7, GETDATE())';
PRINT 'ORDER BY Dateofpayment DESC;';
PRINT '';
PRINT '-- View mixed payments:';
PRINT 'SELECT * FROM dbo.vw_MixedPayments;';
GO
