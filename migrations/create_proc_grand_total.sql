-- Migration: Create new ProcGrandTotal stored procedure
-- Date: 2025-11-10
-- Description: Updated procedure using new views with proper currency handling

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

    -- Main query combining all financial data
    SELECT
        ISNULL(dbo.VWIQD.Day, dbo.VWUSD.Day) AS 'Day',
        dbo.VWIQD.SumIQD,
        dbo.VWIQD.SumExQ AS 'ExpensesIQD',
        dbo.VWIQD.FinalIQDSum,
        dbo.VWUSD.SumUSD,
        dbo.VWUSD.SumEx$ AS 'ExpensesUSD',
        dbo.VWUSD.FinalUSDSum,

        -- Grand Total in USD (convert IQD to USD and add USD)
        CAST(
            (ISNULL(dbo.VWIQD.FinalIQDSum, 0) / CAST(ISNULL(s.ExchangeRate, @ex) AS FLOAT))
            + ISNULL(dbo.VWUSD.FinalUSDSum, 0)
            AS DECIMAL(9,2)
        ) AS GrandTotal,

        -- Grand Total in IQD (add IQD and convert USD to IQD)
        (
            ISNULL(dbo.VWIQD.FinalIQDSum, 0)
            + ISNULL((dbo.VWUSD.FinalUSDSum * ISNULL(s.ExchangeRate, @Ex)), 0)
        ) AS GrandTotalIQD,

        -- Cash Box IQD (actual IQD in hand, accounting for changes and cross-currency payments)
        (
            ISNULL(dbo.VWIQD.FinalIQDSum, 0)
            + ISNULL(aUS.ActualIQD, 0)  -- IQD received for USD treatments
            - ISNULL(aUS.SUMChangeUSD, 0)  -- Change given for USD treatments
            - ISNULL(aIQ.SUMChangeIQD, 0)  -- Change given for IQD treatments
            - ISNULL(aIQ.SumIQDNotGained, 0)  -- IQD not gained due to payment method
        ) AS QasaIQD,

        -- Cash Box USD (actual USD in hand, accounting for cross-currency payments)
        (
            ISNULL(dbo.VWUSD.FinalUSDSum, 0)
            + ISNULL(aIQ.ActualUSD, 0)  -- USD received for IQD treatments
            - ISNULL(aUS.SumUSDNotGained, 0)  -- USD not gained due to payment method
        ) AS QasaUSD

    FROM dbo.VWIQD
    FULL OUTER JOIN dbo.VWUSD
        ON dbo.VWIQD.Day = dbo.VWUSD.Day
    LEFT JOIN dbo.tblsms s
        ON VWIQD.Day = s.[date] OR VWUSD.Day = s.[date]
    LEFT JOIN dbo.V_ActualIQD aIQ
        ON aIQ.Dateofpayment = VWIQD.Day OR aIQ.Dateofpayment = VWUSD.Day
    LEFT JOIN dbo.V_ActualUSD aUS
        ON aUS.Dateofpayment = VWIQD.Day OR aUS.Dateofpayment = VWUSD.Day
    WHERE ISNULL(dbo.VWIQD.Day, dbo.VWUSD.Day) >= @Startd
        AND ISNULL(dbo.VWIQD.Day, dbo.VWUSD.Day) < @Endd
    ORDER BY Day
END
GO
