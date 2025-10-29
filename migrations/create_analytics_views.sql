-- =====================================================
-- Create Analytics Views
-- Date: 2025-10-29
-- =====================================================

USE ShwanNew;
GO

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
WHERE USDReceived > 0 OR IQDReceived > 0
GROUP BY Dateofpayment;
GO

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
WHERE i.USDReceived > 0 AND i.IQDReceived > 0;
GO

PRINT 'Analytics views created successfully';
