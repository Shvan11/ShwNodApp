-- ============================================
-- Invoice Payment Validation Constraints
-- Author: System Enhancement
-- Date: 2025-01-11
-- Description: Adds database-level validation for invoice payments
--              to prevent invalid payment data entry
-- ============================================

USE [YourDatabaseName]; -- Replace with actual database name
GO

-- Check if constraints already exist and drop them if needed
IF EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'CHK_Invoice_MustReceiveCash')
    ALTER TABLE dbo.tblInvoice DROP CONSTRAINT CHK_Invoice_MustReceiveCash;
GO

IF EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'CHK_Invoice_USDNonNegative')
    ALTER TABLE dbo.tblInvoice DROP CONSTRAINT CHK_Invoice_USDNonNegative;
GO

IF EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'CHK_Invoice_IQDNonNegative')
    ALTER TABLE dbo.tblInvoice DROP CONSTRAINT CHK_Invoice_IQDNonNegative;
GO

IF EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'CHK_Invoice_ChangeNonNegative')
    ALTER TABLE dbo.tblInvoice DROP CONSTRAINT CHK_Invoice_ChangeNonNegative;
GO

IF EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'CHK_Invoice_AmountPaidPositive')
    ALTER TABLE dbo.tblInvoice DROP CONSTRAINT CHK_Invoice_AmountPaidPositive;
GO

-- ============================================
-- Add Constraints
-- ============================================

-- 1. CRITICAL: Must receive cash in at least one currency
-- Prevents: USDReceived = 0 AND IQDReceived = 0
ALTER TABLE dbo.tblInvoice
ADD CONSTRAINT CHK_Invoice_MustReceiveCash
CHECK (USDReceived > 0 OR IQDReceived > 0);
GO

-- 2. Currency amounts cannot be negative
ALTER TABLE dbo.tblInvoice
ADD CONSTRAINT CHK_Invoice_USDNonNegative
CHECK (USDReceived >= 0);
GO

ALTER TABLE dbo.tblInvoice
ADD CONSTRAINT CHK_Invoice_IQDNonNegative
CHECK (IQDReceived >= 0);
GO

-- 3. Change must be non-negative or NULL
-- NULL = no change tracking (same-currency payments)
-- >= 0 = valid change amount (cross-currency payments)
ALTER TABLE dbo.tblInvoice
ADD CONSTRAINT CHK_Invoice_ChangeNonNegative
CHECK (Change >= 0 OR Change IS NULL);
GO

-- 4. Amount paid must be positive
-- Prevents registering zero or negative payments
ALTER TABLE dbo.tblInvoice
ADD CONSTRAINT CHK_Invoice_AmountPaidPositive
CHECK (Amountpaid > 0);
GO

-- ============================================
-- Add Extended Properties (Documentation)
-- ============================================

EXEC sp_addextendedproperty
    @name = N'MS_Description',
    @value = N'Ensures at least one currency (USD or IQD) is received for valid payment. Prevents empty payments.',
    @level0type = N'SCHEMA', @level0name = 'dbo',
    @level1type = N'TABLE',  @level1name = 'tblInvoice',
    @level2type = N'CONSTRAINT', @level2name = 'CHK_Invoice_MustReceiveCash';
GO

EXEC sp_addextendedproperty
    @name = N'MS_Description',
    @value = N'Ensures change is non-negative or NULL. NULL indicates same-currency payment where change tracking is not needed.',
    @level0type = N'SCHEMA', @level0name = 'dbo',
    @level1type = N'TABLE',  @level1name = 'tblInvoice',
    @level2type = N'CONSTRAINT', @level2name = 'CHK_Invoice_ChangeNonNegative';
GO

-- ============================================
-- Verification Query
-- ============================================

-- Verify all constraints were created successfully
SELECT
    name AS ConstraintName,
    type_desc AS ConstraintType,
    definition AS CheckDefinition
FROM sys.check_constraints
WHERE parent_object_id = OBJECT_ID('dbo.tblInvoice')
    AND name LIKE 'CHK_Invoice_%'
ORDER BY name;
GO

PRINT 'Invoice validation constraints added successfully!';
PRINT 'Remember to update the database name at the top of this script before running.';
GO
