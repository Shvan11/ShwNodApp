-- ============================================
-- Audit and Fix Old Invoice Records
-- Author: System Enhancement
-- Date: 2025-01-11
-- Description: Identifies and fixes invoice records that would
--              violate new validation constraints
-- ============================================

USE [YourDatabaseName]; -- Replace with actual database name
GO

PRINT '========================================';
PRINT 'Invoice Data Quality Audit';
PRINT '========================================';
PRINT '';

-- ============================================
-- AUDIT: Find problematic records
-- ============================================

PRINT '1. Checking for invoices with NO cash received (USDReceived = 0 AND IQDReceived = 0)...';
SELECT
    InvoiceID,
    workid,
    Amountpaid,
    Dateofpayment,
    USDReceived,
    IQDReceived,
    Change
FROM dbo.tblInvoice
WHERE USDReceived = 0 AND IQDReceived = 0;

DECLARE @NoCashCount INT = @@ROWCOUNT;
PRINT 'Found: ' + CAST(@NoCashCount AS VARCHAR) + ' records';
PRINT '';

PRINT '2. Checking for invoices with negative USD amounts...';
SELECT
    InvoiceID,
    workid,
    Amountpaid,
    USDReceived
FROM dbo.tblInvoice
WHERE USDReceived < 0;

DECLARE @NegativeUSDCount INT = @@ROWCOUNT;
PRINT 'Found: ' + CAST(@NegativeUSDCount AS VARCHAR) + ' records';
PRINT '';

PRINT '3. Checking for invoices with negative IQD amounts...';
SELECT
    InvoiceID,
    workid,
    Amountpaid,
    IQDReceived
FROM dbo.tblInvoice
WHERE IQDReceived < 0;

DECLARE @NegativeIQDCount INT = @@ROWCOUNT;
PRINT 'Found: ' + CAST(@NegativeIQDCount AS VARCHAR) + ' records';
PRINT '';

PRINT '4. Checking for invoices with negative Change...';
SELECT
    InvoiceID,
    workid,
    Change
FROM dbo.tblInvoice
WHERE Change < 0;

DECLARE @NegativeChangeCount INT = @@ROWCOUNT;
PRINT 'Found: ' + CAST(@NegativeChangeCount AS VARCHAR) + ' records';
PRINT '';

PRINT '5. Checking for invoices with zero or negative AmountPaid...';
SELECT
    InvoiceID,
    workid,
    Amountpaid,
    Dateofpayment
FROM dbo.tblInvoice
WHERE Amountpaid <= 0;

DECLARE @InvalidAmountCount INT = @@ROWCOUNT;
PRINT 'Found: ' + CAST(@InvalidAmountCount AS VARCHAR) + ' records';
PRINT '';

-- ============================================
-- Summary
-- ============================================

PRINT '========================================';
PRINT 'Audit Summary:';
PRINT '========================================';
PRINT 'Total problematic records that need fixing:';
PRINT '  - No cash received: ' + CAST(@NoCashCount AS VARCHAR);
PRINT '  - Negative USD: ' + CAST(@NegativeUSDCount AS VARCHAR);
PRINT '  - Negative IQD: ' + CAST(@NegativeIQDCount AS VARCHAR);
PRINT '  - Negative Change: ' + CAST(@NegativeChangeCount AS VARCHAR);
PRINT '  - Invalid Amount Paid: ' + CAST(@InvalidAmountCount AS VARCHAR);
PRINT '';

-- ============================================
-- FIX OPTIONS (commented out for safety)
-- ============================================

PRINT '========================================';
PRINT 'Fix Options:';
PRINT '========================================';
PRINT 'Review the problematic records above and choose a fix strategy:';
PRINT '';
PRINT 'Option A: DELETE invalid records (if they are data entry errors)';
PRINT 'Option B: FIX by inferring values from AmountPaid';
PRINT 'Option C: MANUAL review and correction';
PRINT '';

-- ============================================
-- OPTION A: Delete invalid records
-- ============================================
-- UNCOMMENT AND RUN ONLY AFTER REVIEW:
/*
PRINT 'Deleting invalid records...';

DELETE FROM dbo.tblInvoice
WHERE USDReceived = 0 AND IQDReceived = 0;

DELETE FROM dbo.tblInvoice
WHERE USDReceived < 0 OR IQDReceived < 0 OR Change < 0 OR Amountpaid <= 0;

PRINT 'Invalid records deleted.';
*/

-- ============================================
-- OPTION B: Auto-fix by inferring from AmountPaid
-- ============================================
-- This assumes old records without USD/IQD values should have
-- the cash received set equal to AmountPaid in IQD
-- UNCOMMENT AND RUN ONLY AFTER REVIEW:
/*
PRINT 'Auto-fixing records with no cash received...';

UPDATE dbo.tblInvoice
SET IQDReceived = Amountpaid,
    USDReceived = 0
WHERE USDReceived = 0 AND IQDReceived = 0;

PRINT 'Records auto-fixed (assumed IQD payments).';
*/

-- ============================================
-- OPTION C: Export for manual review
-- ============================================
-- Export problematic records to review with business logic
PRINT 'To manually review and fix, run this query:';
PRINT '';
PRINT 'SELECT * FROM dbo.tblInvoice';
PRINT 'WHERE (USDReceived = 0 AND IQDReceived = 0)';
PRINT '   OR USDReceived < 0';
PRINT '   OR IQDReceived < 0';
PRINT '   OR Change < 0';
PRINT '   OR Amountpaid <= 0;';
PRINT '';

PRINT '========================================';
PRINT 'IMPORTANT: Review and fix old records BEFORE';
PRINT 'running add-invoice-validation-constraints.sql';
PRINT '========================================';

GO
