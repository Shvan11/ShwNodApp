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

-- Create new V_ActualIQD view (fixing column name issues)
-- This tracks actual currency received for IQD treatments
CREATE VIEW dbo.V_ActualIQD
AS
SELECT
    Dateofpayment,
    SUM(USDReceived) AS ActualUSD,
    SUM(CASE WHEN ActualAmount IS NOT NULL THEN IQDReceived - ActualAmount ELSE 0 END) AS SumIQDNotGained,
    SUM(ISNULL(Change, 0)) AS SUMChangeIQD,
    MONTH(Dateofpayment) AS month,
    YEAR(Dateofpayment) AS Year
FROM dbo.tblInvoice
INNER JOIN dbo.tblwork ON dbo.tblInvoice.workid = dbo.tblwork.workid
WHERE dbo.tblwork.Currency = 'IQD' AND (IQDReceived > 0 OR USDReceived > 0)
GROUP BY Dateofpayment;
GO

-- Create new V_ActualUSD view (fixing column name issues)
-- This tracks actual currency received for USD treatments
CREATE VIEW dbo.V_ActualUSD
AS
SELECT
    Dateofpayment,
    SUM(IQDReceived) AS ActualIQD,
    SUM(CASE WHEN ActualAmount IS NOT NULL THEN USDReceived - ActualAmount ELSE 0 END) AS SumUSDNotGained,
    SUM(ISNULL(Change, 0)) AS SUMChangeUSD,
    MONTH(Dateofpayment) AS month,
    YEAR(Dateofpayment) AS Year
FROM dbo.tblInvoice
INNER JOIN dbo.tblwork ON dbo.tblInvoice.workid = dbo.tblwork.workid
WHERE dbo.tblwork.Currency = 'USD' AND (IQDReceived > 0 OR USDReceived > 0)
GROUP BY Dateofpayment;
GO
