/**
 * Financial report aggregations (PostgreSQL / Kysely `sql` tag).
 *
 * Phase 5 reimplementation of the reporting stored procs ProcGrandTotal /
 * ProcYearlyMonthlyTotals / ProDailyInvoices. Each proc read a chain of SQL Server views
 * (VIQD / VUSD / V_EIQ / V_EI$ / VWIQD / VWUSD) that no longer exist in PG; those views are
 * inlined here as CTEs. The dual-currency cash-box ("Qasa") math is preserved verbatim.
 *
 * Consumed by routes/api/reports.routes.ts (math/aggregation stays in FinancialReportService).
 */
import { sql } from 'kysely';
import { getKysely } from '../kysely.js';
import type { DailyData, BaseInvoice } from '../../business/FinancialReportService.js';

/** One aggregated month from ProcYearlyMonthlyTotals. */
export interface MonthlyTotalRow {
  Year: number;
  Month: number;
  SumIQD: number;
  ExpensesIQD: number;
  FinalIQDSum: number;
  SumUSD: number;
  ExpensesUSD: number;
  FinalUSDSum: number;
  GrandTotal: number;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// The VIQD/VUSD/V_EIQ/V_EI$/VWIQD/VWUSD view chain, inlined. SUM over integer columns yields
// bigint in PG (→ number via the kysely.ts type parser); `date` days arrive as 'YYYY-MM-DD'.
const VW_CTES = sql`
  viqd AS (
    SELECT "Dateofpayment" AS day, SUM("IQDReceived") AS sumiqd
    FROM "tblInvoice" WHERE "IQDReceived" > 0 GROUP BY "Dateofpayment"
  ),
  vusd AS (
    SELECT "Dateofpayment" AS day, SUM("USDReceived") AS sumusd
    FROM "tblInvoice" WHERE "USDReceived" > 0 GROUP BY "Dateofpayment"
  ),
  veiq AS (
    SELECT "expenseDate" AS day, -SUM("Amount") AS sumexq
    FROM "tblExpenses" WHERE "Currency" = 'IQD' GROUP BY "expenseDate"
  ),
  veiusd AS (
    SELECT "expenseDate" AS day, -SUM("Amount") AS sumexusd
    FROM "tblExpenses" WHERE "Currency" = 'USD' GROUP BY "expenseDate"
  ),
  vwiqd AS (
    SELECT COALESCE(v.day, e.day) AS day, v.sumiqd, e.sumexq,
           COALESCE(v.sumiqd, 0) + COALESCE(e.sumexq, 0) AS finaliqdsum
    FROM viqd v FULL OUTER JOIN veiq e ON v.day = e.day
  ),
  vwusd AS (
    SELECT COALESCE(v.day, e.day) AS day, v.sumusd, e.sumexusd,
           COALESCE(v.sumusd, 0) + COALESCE(e.sumexusd, 0) AS finalusdsum
    FROM vusd v FULL OUTER JOIN veiusd e ON v.day = e.day
  )
`;

/**
 * Daily cash-box totals for one month (was: ProcGrandTotal). The IQD↔USD conversion uses each
 * day's exchange rate from tblsms when present, else the supplied @Ex fallback.
 */
export async function getMonthlyGrandTotals(
  month: number,
  year: number,
  ex: number
): Promise<DailyData[]> {
  const start = `${year}-${pad2(month)}-01`;
  const end = month === 12 ? `${year + 1}-01-01` : `${year}-${pad2(month + 1)}-01`;

  const { rows } = await sql<DailyData>`
    WITH ${VW_CTES},
    dailyiqd AS (
      SELECT "Dateofpayment" AS day,
             SUM(COALESCE("IQDReceived", 0)) AS totaliqd,
             SUM(COALESCE("Change", 0))      AS totalchange
      FROM "tblInvoice" GROUP BY "Dateofpayment"
    ),
    dailyusd AS (
      SELECT "Dateofpayment" AS day, SUM(COALESCE("USDReceived", 0)) AS totalusd
      FROM "tblInvoice" GROUP BY "Dateofpayment"
    )
    SELECT
      COALESCE(wq.day, wu.day)                                       AS "Day",
      wq.sumiqd                                                      AS "SumIQD",
      wq.sumexq                                                      AS "ExpensesIQD",
      wq.finaliqdsum                                                 AS "FinalIQDSum",
      wu.sumusd                                                      AS "SumUSD",
      wu.sumexusd                                                    AS "ExpensesUSD",
      wu.finalusdsum                                                 AS "FinalUSDSum",
      CAST(
        (COALESCE(wq.finaliqdsum, 0) / CAST(COALESCE(s."ExchangeRate", ${ex}::int) AS float))
        + COALESCE(wu.finalusdsum, 0) AS decimal(9, 2)
      )                                                              AS "GrandTotal",
      (COALESCE(wq.finaliqdsum, 0)
        + COALESCE(wu.finalusdsum * COALESCE(s."ExchangeRate", ${ex}::int), 0)) AS "GrandTotalIQD",
      (COALESCE(dq.totaliqd, 0) + COALESCE(wq.sumexq, 0) - COALESCE(dq.totalchange, 0)) AS "QasaIQD",
      (COALESCE(du.totalusd, 0) + COALESCE(wu.sumexusd, 0))          AS "QasaUSD"
    FROM vwiqd wq
    FULL OUTER JOIN vwusd wu ON wq.day = wu.day
    LEFT JOIN "tblsms" s ON COALESCE(wq.day, wu.day) = s."date"
    LEFT JOIN dailyiqd dq ON COALESCE(wq.day, wu.day) = dq.day
    LEFT JOIN dailyusd du ON COALESCE(wq.day, wu.day) = du.day
    WHERE COALESCE(wq.day, wu.day) >= ${start}::date
      AND COALESCE(wq.day, wu.day) <  ${end}::date
    ORDER BY "Day"
  `.execute(getKysely());

  return rows;
}

/**
 * Per-month totals across a 12-month window starting at startMonth/startYear (was:
 * ProcYearlyMonthlyTotals). Uses the supplied @Ex as a flat conversion rate (no per-day rate).
 */
export async function getYearlyMonthlyTotals(
  startMonth: number,
  startYear: number,
  ex: number
): Promise<MonthlyTotalRow[]> {
  const start = `${startYear}-${pad2(startMonth)}-01`;
  const end = `${startYear + 1}-${pad2(startMonth)}-01`; // DATEADD(MONTH, 12, start)

  const { rows } = await sql<MonthlyTotalRow>`
    WITH ${VW_CTES}
    SELECT
      EXTRACT(YEAR  FROM COALESCE(wq.day, wu.day))::int AS "Year",
      EXTRACT(MONTH FROM COALESCE(wq.day, wu.day))::int AS "Month",
      SUM(COALESCE(wq.sumiqd, 0))      AS "SumIQD",
      SUM(COALESCE(wq.sumexq, 0))      AS "ExpensesIQD",
      SUM(COALESCE(wq.finaliqdsum, 0)) AS "FinalIQDSum",
      SUM(COALESCE(wu.sumusd, 0))      AS "SumUSD",
      SUM(COALESCE(wu.sumexusd, 0))    AS "ExpensesUSD",
      SUM(COALESCE(wu.finalusdsum, 0)) AS "FinalUSDSum",
      CAST(
        SUM(COALESCE(wq.finaliqdsum, 0)) / CAST(${ex}::int AS float)
        + SUM(COALESCE(wu.finalusdsum, 0)) AS decimal(12, 2)
      ) AS "GrandTotal"
    FROM vwiqd wq
    FULL OUTER JOIN vwusd wu ON wq.day = wu.day
    WHERE COALESCE(wq.day, wu.day) >= ${start}::date
      AND COALESCE(wq.day, wu.day) <  ${end}::date
    GROUP BY EXTRACT(YEAR FROM COALESCE(wq.day, wu.day)), EXTRACT(MONTH FROM COALESCE(wq.day, wu.day))
    ORDER BY "Year", "Month"
  `.execute(getKysely());

  return rows;
}

/**
 * All invoices paid on a given date, with patient + work context (was: ProDailyInvoices).
 * - Amountpaid is a thousands-grouped string (the proc used FORMAT(..,'#,##0')).
 * - SysStartTime is emitted as a UTC '…Z' ISO string (column stores UTC wall-clock); the
 *   frontend converts to local. SysEndTime was dropped from the PG schema (unused).
 */
export async function getDailyInvoices(date: string): Promise<BaseInvoice[]> {
  const { rows } = await sql<BaseInvoice>`
    SELECT
      p."PatientName"                                              AS "PatientName",
      i."invoiceID"                                                AS "invoiceID",
      to_char(i."Amountpaid", 'FM999,999,999,990')                 AS "Amountpaid",
      i."Dateofpayment"                                            AS "Dateofpayment",
      i."workid"                                                   AS "workid",
      to_char(i."SysStartTime", 'YYYY-MM-DD"T"HH24:MI:SS"Z"')      AS "SysStartTime",
      i."Change"                                                   AS "Change",
      w."Currency"                                                 AS "currency"
    FROM "tblInvoice" i
    INNER JOIN "tblwork" w ON w."workid" = i."workid"
    INNER JOIN "tblpatients" p ON w."PersonID" = p."PersonID"
    WHERE i."Dateofpayment" = ${date}::date
  `.execute(getKysely());

  return rows;
}
