/**
 * Financial report aggregations (PostgreSQL / Kysely `sql` tag).
 *
 * Phase 5 reimplementation of the reporting stored procs ProcGrandTotal /
 * ProcYearlyMonthlyTotals / ProDailyInvoices. Each proc read a chain of SQL Server views
 * (VIQD / VUSD / V_EIQ / V_EI$ / VWIQD / VWUSD) that no longer exist in PG; those views are
 * inlined here as CTEs. The dual-currency cash-box ("Expected Cash") math is preserved verbatim.
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
    SELECT "date_of_payment" AS day, SUM("iqd_received") AS sumiqd
    FROM "invoices" WHERE "iqd_received" > 0 GROUP BY "date_of_payment"
  ),
  vusd AS (
    SELECT "date_of_payment" AS day, SUM("usd_received") AS sumusd
    FROM "invoices" WHERE "usd_received" > 0 GROUP BY "date_of_payment"
  ),
  veiq AS (
    SELECT "expense_date" AS day, -SUM("amount") AS sumexq
    FROM "expenses" WHERE "currency" = 'IQD' GROUP BY "expense_date"
  ),
  veiq_daily AS (
    -- daily-only IQD expenses (monthly excluded) — feeds Expected Cash formula only
    SELECT "expense_date" AS day, -SUM("amount") AS sumexq_daily
    FROM "expenses" WHERE "currency" = 'IQD' AND NOT "is_monthly" GROUP BY "expense_date"
  ),
  veiusd AS (
    SELECT "expense_date" AS day, -SUM("amount") AS sumexusd
    FROM "expenses" WHERE "currency" = 'USD' GROUP BY "expense_date"
  ),
  veiusd_daily AS (
    -- daily-only USD expenses (monthly excluded) — feeds Expected Cash formula only
    SELECT "expense_date" AS day, -SUM("amount") AS sumexusd_daily
    FROM "expenses" WHERE "currency" = 'USD' AND NOT "is_monthly" GROUP BY "expense_date"
  ),
  vwiqd AS (
    SELECT COALESCE(v.day, e.day) AS day, v.sumiqd, e.sumexq,
           COALESCE(v.sumiqd, 0) + COALESCE(e.sumexq, 0) AS finaliqdsum,
           ed.sumexq_daily,
           -- daily-only net (monthly expenses excluded) — the per-day breakdown reads this
           COALESCE(v.sumiqd, 0) + COALESCE(ed.sumexq_daily, 0) AS finaliqdsum_daily
    FROM viqd v FULL OUTER JOIN veiq e ON v.day = e.day
    LEFT JOIN veiq_daily ed ON COALESCE(v.day, e.day) = ed.day
  ),
  vwusd AS (
    SELECT COALESCE(v.day, e.day) AS day, v.sumusd, e.sumexusd,
           COALESCE(v.sumusd, 0) + COALESCE(e.sumexusd, 0) AS finalusdsum,
           ed.sumexusd_daily,
           -- daily-only net (monthly expenses excluded) — the per-day breakdown reads this
           COALESCE(v.sumusd, 0) + COALESCE(ed.sumexusd_daily, 0) AS finalusdsum_daily
    FROM vusd v FULL OUTER JOIN veiusd e ON v.day = e.day
    LEFT JOIN veiusd_daily ed ON COALESCE(v.day, e.day) = ed.day
  )
`;

/**
 * Daily cash-box totals for one month (was: ProcGrandTotal). The IQD↔USD conversion uses each
 * day's exchange rate from tblsms when present, else the supplied @Ex fallback.
 *
 * Every per-day figure here is DAILY-ONLY: monthly expenses (rent/utilities/subscriptions,
 * `expenses.is_monthly = true`) are excluded from the per-day Expenses, Net (Final*Sum),
 * Grand Total and Expected Cash. They'd otherwise dump a whole month's fixed cost onto the
 * single day they were logged and distort the front desk's daily cash reconciliation + the
 * daily-invoices modal. Monthly expenses still land in the month rollup via
 * getMonthlyExpenseTotals (Statistics summary cards) and getYearlyMonthlyTotals (Monthly/Yearly
 * tabs) — they're a month-level cost, just not a per-day one.
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
      SELECT "date_of_payment" AS day,
             SUM(COALESCE("iqd_received", 0)) AS totaliqd,
             SUM(COALESCE("change", 0))      AS totalchange
      FROM "invoices" GROUP BY "date_of_payment"
    ),
    dailyusd AS (
      SELECT "date_of_payment" AS day, SUM(COALESCE("usd_received", 0)) AS totalusd
      FROM "invoices" GROUP BY "date_of_payment"
    )
    SELECT
      COALESCE(wq.day, wu.day)                                       AS "Day",
      wq.sumiqd                                                      AS "SumIQD",
      wq.sumexq_daily                                                AS "ExpensesIQD",
      wq.finaliqdsum_daily                                           AS "FinalIQDSum",
      wu.sumusd                                                      AS "SumUSD",
      wu.sumexusd_daily                                              AS "ExpensesUSD",
      wu.finalusdsum_daily                                           AS "FinalUSDSum",
      CAST(
        (COALESCE(wq.finaliqdsum_daily, 0) / CAST(COALESCE(s."exchange_rate", ${ex}::int) AS float))
        + COALESCE(wu.finalusdsum_daily, 0) AS decimal(9, 2)
      )                                                              AS "GrandTotal",
      (COALESCE(wq.finaliqdsum_daily, 0)
        + COALESCE(wu.finalusdsum_daily * COALESCE(s."exchange_rate", ${ex}::int), 0)) AS "GrandTotalIQD",
      (COALESCE(dq.totaliqd, 0) + COALESCE(wq.sumexq_daily, 0) - COALESCE(dq.totalchange, 0)) AS "ExpectedCashIQD",
      (COALESCE(du.totalusd, 0) + COALESCE(wu.sumexusd_daily, 0))          AS "ExpectedCashUSD"
    FROM vwiqd wq
    FULL OUTER JOIN vwusd wu ON wq.day = wu.day
    LEFT JOIN "sms" s ON COALESCE(wq.day, wu.day) = s."date"
    LEFT JOIN dailyiqd dq ON COALESCE(wq.day, wu.day) = dq.day
    LEFT JOIN dailyusd du ON COALESCE(wq.day, wu.day) = du.day
    WHERE COALESCE(wq.day, wu.day) >= ${start}::date
      AND COALESCE(wq.day, wu.day) <  ${end}::date
    ORDER BY "Day"
  `.execute(getKysely());

  return rows;
}

/** A month's total expenses, split by currency (positive amounts; ALL expenses). */
export interface MonthlyExpenseTotals {
  IQD: number;
  USD: number;
}

/**
 * Total expenses for one month, split by currency — ALL expenses, including monthly
 * (is_monthly) ones. Feeds the Statistics summary cards / MONTH TOTAL footer, where a
 * month's fixed costs (rent/utilities) DO belong, even though getMonthlyGrandTotals now
 * excludes them from the per-day rows. Amounts are returned positive (expenses.amount is
 * stored positive); the report layer treats expenses as a positive total it subtracts.
 */
export async function getMonthlyExpenseTotals(
  month: number,
  year: number
): Promise<MonthlyExpenseTotals> {
  const start = `${year}-${pad2(month)}-01`;
  const end = month === 12 ? `${year + 1}-01-01` : `${year}-${pad2(month + 1)}-01`;

  const { rows } = await sql<MonthlyExpenseTotals>`
    SELECT
      COALESCE(SUM("amount") FILTER (WHERE "currency" = 'IQD'), 0) AS "IQD",
      COALESCE(SUM("amount") FILTER (WHERE "currency" = 'USD'), 0) AS "USD"
    FROM "expenses"
    WHERE "expense_date" >= ${start}::date
      AND "expense_date" <  ${end}::date
  `.execute(getKysely());

  return rows[0] ?? { IQD: 0, USD: 0 };
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
 * - amount_paid is a thousands-grouped string (the proc used FORMAT(..,'#,##0')).
 * - sys_start_time is emitted as a UTC '…Z' ISO string (column stores UTC wall-clock); the
 *   frontend converts to local. SysEndTime was dropped from the PG schema (unused).
 */
export async function getDailyInvoices(date: string): Promise<BaseInvoice[]> {
  const { rows } = await sql<BaseInvoice>`
    SELECT
      p."patient_name"                                              AS "patient_name",
      i."invoice_id"                                                AS "invoice_id",
      to_char(i."amount_paid", 'FM999,999,999,990')                 AS "amount_paid",
      i."date_of_payment"                                            AS "date_of_payment",
      i."work_id"                                                   AS "work_id",
      to_char(i."sys_start_time", 'YYYY-MM-DD"T"HH24:MI:SS"Z"')      AS "sys_start_time",
      i."change"                                                   AS "change",
      w."currency"                                                 AS "currency"
    FROM "invoices" i
    INNER JOIN "works" w ON w."work_id" = i."work_id"
    INNER JOIN "patients" p ON w."person_id" = p."person_id"
    WHERE i."date_of_payment" = ${date}::date
  `.execute(getKysely());

  return rows;
}

/** One commission-eligible doctor's money COLLECTED in a period, split by currency. */
export interface DoctorCommissionPaid {
  doctor_id: number;
  doctor_name: string;
  commission_percentage: number;
  paid_iqd: number;
  paid_usd: number;
}

/**
 * Per commission-enabled doctor, the money COLLECTED on their works within
 * [startDate, endDate] — sum of invoices.amount_paid keyed on date_of_payment, split
 * by works.currency. Doctors are matched via works.dr_id = employees.id (a NOT NULL
 * real FK) and filtered to `percentage = true AND commission_percentage IS NOT NULL`
 * — there is NO is_active filter, so a doctor who has since quit still reports for
 * periods they were working. Only doctors with ≥1 payment in the window appear (inner
 * joins + HAVING). amount_paid is the value applied to the work in works.currency (the
 * iqd_received/usd_received cash-box columns are deliberately NOT used). The commission
 * itself (× rate / 100, rounded) is computed in the route — this stays pure aggregation.
 * Index path: employees(percentage) → works(ix_works_dr_id) → invoices(ix_wid_date_sum).
 */
export async function getDoctorCommissions(
  startDate: string,
  endDate: string
): Promise<DoctorCommissionPaid[]> {
  const { rows } = await sql<DoctorCommissionPaid>`
    SELECT
      e."id"                    AS doctor_id,
      e."employee_name"         AS doctor_name,
      e."commission_percentage" AS commission_percentage,
      COALESCE(SUM(i."amount_paid") FILTER (WHERE w."currency" = 'IQD'), 0) AS paid_iqd,
      COALESCE(SUM(i."amount_paid") FILTER (WHERE w."currency" = 'USD'), 0) AS paid_usd
    FROM "employees" e
    JOIN "works" w    ON w."dr_id"   = e."id"
    JOIN "invoices" i ON i."work_id" = w."work_id"
    WHERE e."percentage" = true
      AND e."commission_percentage" IS NOT NULL
      AND i."date_of_payment" >= ${startDate}::date
      AND i."date_of_payment" <= ${endDate}::date
    GROUP BY e."id", e."employee_name", e."commission_percentage"
    HAVING SUM(i."amount_paid") > 0
    ORDER BY e."employee_name"
  `.execute(getKysely());

  return rows;
}

/**
 * One revenue-breakdown row — money COLLECTED on a category's works in a period, split
 * by currency. `id`/`name` are generic across both breakdown dimensions (work type or
 * doctor) so a single row shape + table component serves both. `usd_equivalent` (and the
 * "most money" ranking) is computed in the route, not here — this stays pure aggregation.
 */
export interface RevenueBreakdownRow {
  id: number;
  name: string;
  paid_iqd: number;
  paid_usd: number;
  work_count: number;
}

/**
 * Revenue COLLECTED per WORK TYPE within [startDate, endDate] — sum of invoices.amount_paid
 * keyed on date_of_payment, split by works.currency, grouped by work_types. Same revenue
 * definition + currency-split idiom as getDoctorCommissions (citext currency compares
 * case-insensitively; a NULL-currency work lands in neither bucket). Only types with ≥1
 * payment in the window appear (inner joins + HAVING). work_count = distinct paying works.
 */
export async function getRevenueByWorkType(
  startDate: string,
  endDate: string
): Promise<RevenueBreakdownRow[]> {
  const { rows } = await sql<RevenueBreakdownRow>`
    SELECT
      wt."id"           AS id,
      wt."work_type"    AS name,
      COALESCE(SUM(i."amount_paid") FILTER (WHERE w."currency" = 'IQD'), 0) AS paid_iqd,
      COALESCE(SUM(i."amount_paid") FILTER (WHERE w."currency" = 'USD'), 0) AS paid_usd,
      COUNT(DISTINCT w."work_id")                                           AS work_count
    FROM "invoices" i
    JOIN "works" w        ON w."work_id"      = i."work_id"
    JOIN "work_types" wt  ON wt."id"          = w."type_of_work"
    WHERE i."date_of_payment" >= ${startDate}::date
      AND i."date_of_payment" <= ${endDate}::date
    GROUP BY wt."id", wt."work_type"
    HAVING SUM(i."amount_paid") > 0
  `.execute(getKysely());

  return rows;
}

/**
 * Revenue COLLECTED per DOCTOR within [startDate, endDate] — as getRevenueByWorkType but
 * grouped by employees on works.dr_id (a NOT NULL real FK). Unlike getDoctorCommissions
 * there is NO percentage/is_active filter: every doctor with paid works appears, quit or
 * not, commission-enabled or not.
 */
export async function getRevenueByDoctor(
  startDate: string,
  endDate: string
): Promise<RevenueBreakdownRow[]> {
  const { rows } = await sql<RevenueBreakdownRow>`
    SELECT
      e."id"            AS id,
      e."employee_name" AS name,
      COALESCE(SUM(i."amount_paid") FILTER (WHERE w."currency" = 'IQD'), 0) AS paid_iqd,
      COALESCE(SUM(i."amount_paid") FILTER (WHERE w."currency" = 'USD'), 0) AS paid_usd,
      COUNT(DISTINCT w."work_id")                                           AS work_count
    FROM "invoices" i
    JOIN "works" w      ON w."work_id" = i."work_id"
    JOIN "employees" e  ON e."id"      = w."dr_id"
    WHERE i."date_of_payment" >= ${startDate}::date
      AND i."date_of_payment" <= ${endDate}::date
    GROUP BY e."id", e."employee_name"
    HAVING SUM(i."amount_paid") > 0
  `.execute(getKysely());

  return rows;
}
