-- ============================================
-- Migration: Add Cost Tracking to Aligner Sets
-- Description: Adds SetCost to tblAlignerSets and keeps tblWork.TotalRequired in sync
-- Date: 2025-01-20
-- ============================================

-- Step 1: Add cost fields to tblAlignerSets
-- ============================================
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('tblAlignerSets') AND name = 'SetCost')
BEGIN
    ALTER TABLE tblAlignerSets
    ADD SetCost DECIMAL(10,2) NULL;

    PRINT 'Added SetCost column to tblAlignerSets';
END
ELSE
BEGIN
    PRINT 'SetCost column already exists in tblAlignerSets';
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('tblAlignerSets') AND name = 'Currency')
BEGIN
    ALTER TABLE tblAlignerSets
    ADD Currency NVARCHAR(3) DEFAULT 'USD';

    PRINT 'Added Currency column to tblAlignerSets';
END
ELSE
BEGIN
    PRINT 'Currency column already exists in tblAlignerSets';
END
GO

-- Step 2: Add optional AlignerSetID to tblInvoice for set-specific payments
-- ============================================
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('tblInvoice') AND name = 'AlignerSetID')
BEGIN
    ALTER TABLE tblInvoice
    ADD AlignerSetID INT NULL;

    PRINT 'Added AlignerSetID column to tblInvoice';

    -- Add foreign key constraint
    ALTER TABLE tblInvoice
    ADD CONSTRAINT FK_Invoice_AlignerSet
    FOREIGN KEY (AlignerSetID) REFERENCES tblAlignerSets(AlignerSetID);

    PRINT 'Added foreign key constraint FK_Invoice_AlignerSet';
END
ELSE
BEGIN
    PRINT 'AlignerSetID column already exists in tblInvoice';
END
GO

-- Step 3: Create trigger to keep tblWork.TotalRequired in sync
-- ============================================
IF EXISTS (SELECT * FROM sys.triggers WHERE name = 'trg_AlignerSets_UpdateWorkTotal')
BEGIN
    DROP TRIGGER trg_AlignerSets_UpdateWorkTotal;
    PRINT 'Dropped existing trigger trg_AlignerSets_UpdateWorkTotal';
END
GO

CREATE TRIGGER trg_AlignerSets_UpdateWorkTotal
ON tblAlignerSets
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    -- Handle INSERT and UPDATE
    IF EXISTS (SELECT * FROM inserted)
    BEGIN
        UPDATE w
        SET
            TotalRequired = ISNULL((
                SELECT SUM(SetCost)
                FROM tblAlignerSets
                WHERE WorkID = w.workid
            ), 0),
            Currency = ISNULL((
                SELECT TOP 1 Currency
                FROM tblAlignerSets
                WHERE WorkID = w.workid AND Currency IS NOT NULL
            ), w.Currency)
        FROM tblWork w
        WHERE w.workid IN (SELECT DISTINCT WorkID FROM inserted WHERE WorkID IS NOT NULL);
    END

    -- Handle DELETE
    IF EXISTS (SELECT * FROM deleted) AND NOT EXISTS (SELECT * FROM inserted)
    BEGIN
        UPDATE w
        SET
            TotalRequired = ISNULL((
                SELECT SUM(SetCost)
                FROM tblAlignerSets
                WHERE WorkID = w.workid
            ), 0),
            Currency = ISNULL((
                SELECT TOP 1 Currency
                FROM tblAlignerSets
                WHERE WorkID = w.workid AND Currency IS NOT NULL
            ), w.Currency)
        FROM tblWork w
        WHERE w.workid IN (SELECT DISTINCT WorkID FROM deleted WHERE WorkID IS NOT NULL);
    END
END
GO

PRINT 'Created trigger trg_AlignerSets_UpdateWorkTotal';
GO

-- Step 4: Create view for payment tracking per set
-- ============================================
IF EXISTS (SELECT * FROM sys.views WHERE name = 'vw_AlignerSetPayments')
BEGIN
    DROP VIEW vw_AlignerSetPayments;
    PRINT 'Dropped existing view vw_AlignerSetPayments';
END
GO

CREATE VIEW vw_AlignerSetPayments AS
SELECT
    s.AlignerSetID,
    s.WorkID,
    s.SetSequence,
    s.Type,
    s.SetCost,
    s.Currency,
    ISNULL(SUM(i.Amountpaid), 0) as TotalPaid,
    s.SetCost - ISNULL(SUM(i.Amountpaid), 0) as Balance,
    CASE
        WHEN s.SetCost IS NULL THEN 'No Cost Set'
        WHEN ISNULL(SUM(i.Amountpaid), 0) = 0 THEN 'Unpaid'
        WHEN ISNULL(SUM(i.Amountpaid), 0) < s.SetCost THEN 'Partial'
        WHEN ISNULL(SUM(i.Amountpaid), 0) >= s.SetCost THEN 'Paid'
        ELSE 'Unknown'
    END as PaymentStatus
FROM tblAlignerSets s
LEFT JOIN tblInvoice i ON s.AlignerSetID = i.AlignerSetID
GROUP BY
    s.AlignerSetID,
    s.WorkID,
    s.SetSequence,
    s.Type,
    s.SetCost,
    s.Currency;
GO

PRINT 'Created view vw_AlignerSetPayments';
GO

PRINT '';
PRINT '============================================';
PRINT 'Migration completed successfully!';
PRINT '============================================';
PRINT '';
PRINT 'Next Steps:';
PRINT '1. Manually set SetCost for each aligner set';
PRINT '2. The trigger will automatically update tblWork.TotalRequired';
PRINT '3. Link invoices to specific sets using AlignerSetID (optional)';
PRINT '4. Use vw_AlignerSetPayments to track payment status per set';
PRINT '';
