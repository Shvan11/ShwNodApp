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
