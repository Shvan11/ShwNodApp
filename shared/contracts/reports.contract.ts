/**
 * API contract — reports / statistics endpoints (`/api/statistics*`,
 * `/api/daily-invoices`).
 *
 * Single source of truth for each endpoint's response shapes, imported by BOTH
 * the Express routes (relative `.js`) and the React app (`@shared` alias). See
 * docs/shared-contract-progress.md.
 *
 * Phase 13 (Wave 2). Group B — response-only. Phase 3 Group 5 (revisited): the
 * computed aggregates are now MODELED — the rows/summaries are fixed interfaces in
 * routes/api/reports.routes.ts (StatisticsSummary / YearTotal) and the
 * FinancialReportService (DailyData / MonthlyStatistics / EnrichedInvoice) +
 * report-queries (MonthlyTotalRow). Rows are closed `z.object` schemas mirroring
 * those interfaces (closed → the interfaces stay assignable to `sendData` without a
 * flip); the CONTAINERS stay `z.looseObject` so the per-endpoint top-level metadata
 * (`month`/`year`/`exchangeRate`/`startYear`/`date`, …) survives. `date_of_payment`
 * /`sys_start_time` are `timestampString` (Date in / ISO string out).
 */
import { z } from 'zod';
import { timestampString } from '../validation.js';

// ── Shared money + summary shapes ──────────────────────────────────────────────
const currencyAmounts = z.object({ IQD: z.number(), USD: z.number() });

// Monthly `summary` = MonthlyStatistics (grandTotal + cashBox are money pairs).
const monthlyStatisticsSummary = z.object({
  totalRevenue: currencyAmounts,
  totalExpenses: currencyAmounts,
  netProfit: currencyAmounts,
  grandTotal: currencyAmounts,
  cashBox: currencyAmounts,
});

// Yearly / multi-year `summary` = the route's StatisticsSummary (grandTotal scalar).
const periodStatisticsSummary = z.object({
  totalRevenue: currencyAmounts,
  totalExpenses: currencyAmounts,
  netProfit: currencyAmounts,
  grandTotal: z.number(),
});

// ── Row shapes (mirror the service / route / query interfaces) ─────────────────
// DailyData (FinancialReportService). The Sum*/Final* columns come straight off a
// FULL OUTER JOIN in getMonthlyGrandTotals (NOT coalesced), so a day present on only
// one currency side yields NULL — hence `.nullable()`, not just optional. The client
// reads them with `|| 0`, so null is harmless there.
const dailyDataRow = z.object({
  Day: z.string().optional(),
  SumIQD: z.number().nullable().optional(),
  SumUSD: z.number().nullable().optional(),
  ExpensesIQD: z.number().nullable().optional(),
  ExpensesUSD: z.number().nullable().optional(),
  QasaIQD: z.number().nullable().optional(),
  QasaUSD: z.number().nullable().optional(),
  GrandTotal: z.number().nullable().optional(),
  GrandTotalIQD: z.number().nullable().optional(),
  FinalIQDSum: z.number().nullable().optional(),
  FinalUSDSum: z.number().nullable().optional(),
});

// MonthlyTotalRow (report-queries) — per-month totals across a 12-month window.
const monthlyTotalRow = z.object({
  Year: z.number(),
  Month: z.number(),
  SumIQD: z.number(),
  ExpensesIQD: z.number(),
  FinalIQDSum: z.number(),
  SumUSD: z.number(),
  ExpensesUSD: z.number(),
  FinalUSDSum: z.number(),
  GrandTotal: z.number(),
});

// YearTotal (reports.routes) — one aggregated year in the multi-year range.
const yearTotalRow = z.object({
  Year: z.number(),
  SumIQD: z.number(),
  SumUSD: z.number(),
  ExpensesIQD: z.number(),
  ExpensesUSD: z.number(),
  FinalIQDSum: z.number(),
  FinalUSDSum: z.number(),
  GrandTotal: z.number(),
});

// EnrichedInvoice (FinancialReportService) = the getDailyInvoices row + received
// splits. Modeled to RUNTIME reality, which diverges from the BaseInvoice interface:
// `amount_paid` is a `to_char`-formatted STRING (the interface mistypes it number),
// and `change`/`currency`/`patient_name` can be null off the join. iqd/usd_received
// are `?? 0` in enrichInvoice, so non-null.
const enrichedInvoiceRow = z.object({
  invoice_id: z.number(),
  workid: z.number().optional(),
  amount_paid: z.union([z.string(), z.number()]).optional(),
  date_of_payment: timestampString.optional(),
  patient_name: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  sys_start_time: timestampString.optional(),
  currency: z.string().nullable().optional(),
  change: z.number().nullable().optional(),
  iqd_received: z.number(),
  usd_received: z.number(),
});

// GET /api/statistics → { month, year, exchangeRate, dailyData, summary }.
export const statistics = {
  response: z.looseObject({ dailyData: z.array(dailyDataRow), summary: monthlyStatisticsSummary }),
} as const;

// GET /api/statistics/yearly → { startMonth, startYear, …, monthlyData, summary }.
export const yearlyStatistics = {
  response: z.looseObject({ monthlyData: z.array(monthlyTotalRow), summary: periodStatisticsSummary }),
} as const;

// GET /api/statistics/multi-year → { startYear, endYear, …, yearlyData, summary }.
export const multiYearStatistics = {
  response: z.looseObject({ yearlyData: z.array(yearTotalRow), summary: periodStatisticsSummary }),
} as const;

// GET /api/daily-invoices → { date, count, invoices }.
export const dailyInvoices = {
  query: z.object({ date: z.string().optional() }),
  response: z.looseObject({ invoices: z.array(enrichedInvoiceRow), count: z.number() }),
} as const;
export type DailyInvoicesQuery = z.infer<typeof dailyInvoices.query>;

// ── Doctor commissions (GET /api/statistics/commissions?startDate=&endDate=) ─────
// Per commission-enabled doctor (employees.percentage = true): the money COLLECTED
// on their works (sum of invoices.amount_paid, by date_of_payment in the period) split
// by works.currency, and commission = collected × rate / 100. IQD and USD stay separate
// (no conversion). CLOSED `z.object` containers — fully modeled, no long-tail metadata,
// so NOT a D2 loose-response marker (no baseline bump). Money columns are PG integers
// → JS numbers; commission_* are rounded in the route.
const commissionRow = z.object({
  doctor_id: z.number(),
  doctor_name: z.string(),
  commission_percentage: z.number(),
  paid_iqd: z.number(),
  paid_usd: z.number(),
  commission_iqd: z.number(),
  commission_usd: z.number(),
});
export type CommissionRow = z.infer<typeof commissionRow>;

export const commissions = {
  query: z.object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD'),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD'),
  }),
  response: z.object({
    rows: z.array(commissionRow),
    startDate: z.string(),
    endDate: z.string(),
  }),
} as const;
export type CommissionsQuery = z.infer<typeof commissions.query>;

// ── Revenue breakdown (GET /api/statistics/revenue-breakdown?startDate=&endDate=) ─
// Money COLLECTED on works in the period (sum of invoices.amount_paid by date_of_payment),
// split by works.currency, grouped two ways: by work type and by doctor. `id`/`name` are
// generic so one row schema + one table serves both dimensions. `usd_equivalent` =
// paid_usd + paid_iqd / exchangeRate (computed + rounded in the route, used as the "most
// money" ranking key); `exchangeRate` is the most recent real rate from `sms` (NOT a
// hardcoded 1450). CLOSED `z.object` containers — fully modeled, so NOT a D2 loose-response
// marker (no baseline bump), same as the commissions schema. Money columns are PG integers.
const revenueRow = z.object({
  id: z.number(),
  name: z.string(),
  paid_iqd: z.number(),
  paid_usd: z.number(),
  work_count: z.number(),
  usd_equivalent: z.number(),
});
export type RevenueRow = z.infer<typeof revenueRow>;

export const revenueBreakdown = {
  query: z.object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD'),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD'),
  }),
  response: z.object({
    byWorkType: z.array(revenueRow),
    byDoctor: z.array(revenueRow),
    exchangeRate: z.number(),
    startDate: z.string(),
    endDate: z.string(),
  }),
} as const;
export type RevenueBreakdownQuery = z.infer<typeof revenueBreakdown.query>;

// GET statistics query shapes (type-only — handlers parse the strings manually).
export const statisticsQuery = z.object({
  month: z.string().optional(),
  year: z.string().optional(),
  exchangeRate: z.string().optional(),
});
export type StatisticsQuery = z.infer<typeof statisticsQuery>;

export const yearlyStatisticsQuery = z.object({
  startMonth: z.string().optional(),
  startYear: z.string().optional(),
  exchangeRate: z.string().optional(),
});
export type YearlyStatisticsQuery = z.infer<typeof yearlyStatisticsQuery>;

export const multiYearStatisticsQuery = z.object({
  startYear: z.string().optional(),
  endYear: z.string().optional(),
  exchangeRate: z.string().optional(),
});
export type MultiYearStatisticsQuery = z.infer<typeof multiYearStatisticsQuery>;
