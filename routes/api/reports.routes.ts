/**
 * Reports & Statistics Routes
 * Handles financial statistics and daily invoice reports
 */
import { Router, type Request, type Response } from 'express';
import { log } from '../../utils/logger.js';
import { ErrorResponses, sendData } from '../../utils/error-response.js';
import { validate } from '../../middleware/validate.js';
import { authorize } from '../../middleware/auth.js';
import { ADMIN_ROLES, FINANCE_ROLES } from '../../shared/auth/roles.js';
import * as reports from '../../shared/contracts/reports.contract.js';
import {
  calculateMonthlyStatistics,
  validateMonthYear,
  validateDate,
} from '../../services/business/FinancialReportService.js';
import {
  getMonthlyGrandTotals,
  getMonthlyExpenseTotals,
  getYearlyMonthlyTotals,
  getDailyInvoices,
  getDoctorCommissions,
  getRevenueByWorkType,
  getRevenueByDoctor,
  getDoctorPayments,
  DOCTOR_PAYMENTS_LIMIT,
  type RevenueBreakdownRow,
} from '../../services/database/queries/report-queries.js';
import {
  getLatestExchangeRate,
  getExchangeRateAsOf,
} from '../../services/database/queries/payment-queries.js';

const router = Router();

/**
 * Query parameters for monthly statistics
 */
// Statistics/daily-invoices query shapes are contracted in reports.contract.ts (type-only).
type StatisticsQuery = reports.StatisticsQuery;
type YearlyStatisticsQuery = reports.YearlyStatisticsQuery;
type MultiYearStatisticsQuery = reports.MultiYearStatisticsQuery;
type DailyInvoicesQuery = reports.DailyInvoicesQuery;
type CommissionsQuery = reports.CommissionsQuery;
type RevenueBreakdownQuery = reports.RevenueBreakdownQuery;
type DoctorPaymentsParams = reports.DoctorPaymentsParams;
type DoctorPaymentsQuery = reports.DoctorPaymentsQuery;

/** ISO date of the last day of a 1-based month. UTC math, so no timezone shift. */
function monthEnd(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/**
 * The IQD-per-USD rate a report period converts at, or null if there isn't one.
 *
 * The per-day rows (getMonthlyGrandTotals / getYearlyMonthlyTotals) each use that day's
 * own `sms.exchange_rate`; this is the fallback for days that have none, and the rate the
 * month-level figures (monthly-only expenses) are converted at. It is resolved AS OF the
 * period's last day — a 2024 report must not be converted at today's rate.
 *
 * There is deliberately NO house rate behind this. These endpoints used to fall back to a
 * hardcoded 1450 — a magic number no operator could see or change, which by mid-2026 ran
 * 3–7% below the real rate (1497–1549), disagreed with the per-day rows in the same
 * response, and on a brand-new deployment (empty `sms`) silently converted a clinic's
 * entire books at another country's April-2023 rate. Returning null instead makes every
 * converted figure null, so the UI reports "no rate recorded" rather than a confident
 * wrong number. Un-converted IQD/USD figures are exact and unaffected.
 *
 * An explicit `?exchangeRate=` still wins — it's a documented what-if override — but no
 * caller supplies one by default any more.
 */
async function resolveReferenceRate(
  override: string | undefined,
  asOf: string
): Promise<number | null> {
  const explicit = override ? parseInt(override, 10) : NaN;
  if (Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }

  const recorded = await getExchangeRateAsOf(asOf);
  return recorded?.exchangeRate ?? null;
}

/**
 * Attach usd_equivalent (paid_usd + paid_iqd / rate, rounded to 2dp) to each breakdown
 * row and sort descending — the "which earns most money" ranking. IQD/USD stay separate
 * in the payload; the USD-equivalent is only a ranking + headline figure.
 */
function rankByUsdEquivalent(
  rows: RevenueBreakdownRow[],
  rate: number | null
): reports.RevenueRow[] {
  // No rate on record → no honest cross-currency ranking exists. Report the equivalent
  // as null and fall back to a deterministic single-currency order (IQD collected, then
  // USD) rather than ranking by a made-up conversion.
  if (rate === null) {
    return rows
      .map((r) => ({ ...r, usd_equivalent: null }))
      .sort((a, b) => b.paid_iqd - a.paid_iqd || b.paid_usd - a.paid_usd);
  }

  return rows
    .map((r) => ({
      ...r,
      usd_equivalent: Math.round((r.paid_usd + r.paid_iqd / rate) * 100) / 100,
    }))
    .sort((a, b) => (b.usd_equivalent ?? 0) - (a.usd_equivalent ?? 0));
}

/**
 * currency totals structure
 */
interface CurrencyTotals {
  IQD: number;
  USD: number;
}

/**
 * Summary structure for statistics
 */
interface StatisticsSummary {
  totalRevenue: CurrencyTotals;
  totalExpenses: CurrencyTotals;
  netProfit: CurrencyTotals;
  /** null when no exchange rate exists to convert the period with. */
  grandTotal: number | null;
}

/**
 * Year total structure
 */
interface YearTotal {
  Year: number;
  SumIQD: number;
  SumUSD: number;
  ExpensesIQD: number;
  ExpensesUSD: number;
  FinalIQDSum: number;
  FinalUSDSum: number;
  /** null when no exchange rate exists to convert the year with. */
  GrandTotal: number | null;
}

/**
 * GET /statistics
 * Get monthly financial statistics
 * Query params: month, year, exchangeRate (optional)
 *
 * FINANCE_ROLES, not open: the payload is the clinic's books — per-day revenue, expenses,
 * net profit and the cash-box balance. Front desk is included deliberately (they run the
 * daily cash box and hand the drawer over), clinical staff are not. The month-level
 * summary is additionally hidden client-side from non-admins.
 */
router.get('/statistics', authorize(FINANCE_ROLES), async (req: Request<object, object, object, StatisticsQuery>, res: Response): Promise<void> => {
  try {
    const { month, year, exchangeRate } = req.query;

    // Validate required parameters
    if (!month || !year) {
      ErrorResponses.badRequest(res, 'Missing required parameters: month and year are required');
      return;
    }

    // Delegate validation to service layer
    const { month: monthNum, year: yearNum } = validateMonthYear(month, year);
    const exRate = await resolveReferenceRate(exchangeRate, monthEnd(yearNum, monthNum));

    // Daily cash-box totals for the month (Day arrives as a 'YYYY-MM-DD' string from PG).
    // Per-day rows are daily-only — monthly expenses excluded so they don't distort the
    // per-day breakdown + daily-invoices modal. The month's full expense total (incl.
    // monthly) is fetched separately for the summary cards / net profit.
    const [dailyData, monthlyExpenses] = await Promise.all([
      getMonthlyGrandTotals(monthNum, yearNum, exRate),
      getMonthlyExpenseTotals(monthNum, yearNum),
    ]);

    // Delegate calculation to service layer
    const summary = calculateMonthlyStatistics(dailyData, exRate, monthlyExpenses);

    sendData(res, reports.statistics.response, {
      month: monthNum,
      year: yearNum,
      exchangeRate: exRate,
      dailyData: dailyData,
      summary: summary
    });

  } catch (error) {
    log.error('Error fetching statistics:', error);

    const err = error as Error;
    // Handle validation errors from service layer
    if (err.message.includes('Month') || err.message.includes('Year')) {
      ErrorResponses.badRequest(res, err.message);
      return;
    }

    ErrorResponses.internalError(res, 'Failed to fetch statistics', err);
  }
});

/**
 * GET /statistics/yearly
 * Get monthly totals for a 12-month period starting from specified month/year
 * Query params: startMonth, startYear, exchangeRate (optional)
 *
 * ADMIN_ROLES — a multi-period revenue rollup, same tier as Commissions/Breakdown
 * (the client already hides the Monthly tab from non-admins).
 */
router.get('/statistics/yearly', authorize(ADMIN_ROLES), async (req: Request<object, object, object, YearlyStatisticsQuery>, res: Response): Promise<void> => {
  try {
    const { startMonth, startYear, exchangeRate } = req.query;

    // Validate required parameters
    if (!startMonth || !startYear) {
      ErrorResponses.badRequest(res, 'Missing required parameters: startMonth and startYear are required');
      return;
    }

    const { month: monthNum, year: yearNum } = validateMonthYear(startMonth, startYear);
    // The window is [start, start + 12 months) → its last day is the end of the month
    // BEFORE startMonth, one year on.
    const exRate = await resolveReferenceRate(exchangeRate, monthEnd(yearNum + 1, monthNum - 1));

    // Per-month totals across the 12-month period.
    const monthlyData = await getYearlyMonthlyTotals(monthNum, yearNum, exRate);

    // Calculate period summary
    const summary = monthlyData.reduce<StatisticsSummary>((acc, month) => ({
      totalRevenue: {
        IQD: acc.totalRevenue.IQD + (month.SumIQD || 0),
        USD: acc.totalRevenue.USD + (month.SumUSD || 0)
      },
      totalExpenses: {
        IQD: acc.totalExpenses.IQD + Math.abs(month.ExpensesIQD || 0),
        USD: acc.totalExpenses.USD + Math.abs(month.ExpensesUSD || 0)
      },
      netProfit: {
        IQD: acc.netProfit.IQD + (month.FinalIQDSum || 0),
        USD: acc.netProfit.USD + (month.FinalUSDSum || 0)
      },
      // Stays null with no rate to convert by — `|| 0` here would quietly turn
      // "unknown" into a total that looks real.
      grandTotal: acc.grandTotal === null ? null : acc.grandTotal + (month.GrandTotal || 0)
    }), {
      totalRevenue: { IQD: 0, USD: 0 },
      totalExpenses: { IQD: 0, USD: 0 },
      netProfit: { IQD: 0, USD: 0 },
      grandTotal: exRate === null ? null : 0
    });

    sendData(res, reports.yearlyStatistics.response, {
      startMonth: monthNum,
      startYear: yearNum,
      exchangeRate: exRate,
      monthlyData: monthlyData,
      summary: summary
    });

  } catch (error) {
    log.error('Error fetching yearly statistics:', error);

    const err = error as Error;
    if (err.message.includes('Month') || err.message.includes('Year')) {
      ErrorResponses.badRequest(res, err.message);
      return;
    }

    ErrorResponses.internalError(res, 'Failed to fetch yearly statistics', err);
  }
});

/**
 * GET /statistics/multi-year
 * Get yearly totals for a range of years
 * Query params: startYear, endYear, exchangeRate (optional)
 * Returns aggregated totals for each full year in the range
 *
 * ADMIN_ROLES — see /statistics/yearly (the client hides the Yearly tab from non-admins).
 */
router.get('/statistics/multi-year', authorize(ADMIN_ROLES), async (req: Request<object, object, object, MultiYearStatisticsQuery>, res: Response): Promise<void> => {
  try {
    const { startYear, endYear, exchangeRate } = req.query;

    // Validate required parameters
    if (!startYear || !endYear) {
      ErrorResponses.badRequest(res, 'Missing required parameters: startYear and endYear are required');
      return;
    }

    const startYearNum = parseInt(startYear, 10);
    const endYearNum = parseInt(endYear, 10);

    // Validate year range
    if (isNaN(startYearNum) || startYearNum < 2000 || startYearNum > 2100) {
      ErrorResponses.badRequest(res, 'Invalid startYear: must be between 2000 and 2100');
      return;
    }
    if (isNaN(endYearNum) || endYearNum < 2000 || endYearNum > 2100) {
      ErrorResponses.badRequest(res, 'Invalid endYear: must be between 2000 and 2100');
      return;
    }
    if (startYearNum > endYearNum) {
      ErrorResponses.badRequest(res, 'startYear must be less than or equal to endYear');
      return;
    }
    if (endYearNum - startYearNum > 10) {
      ErrorResponses.badRequest(res, 'Year range cannot exceed 10 years');
      return;
    }

    // Resolved after validation so a bad year can't reach the rate lookup.
    const exRate = await resolveReferenceRate(exchangeRate, monthEnd(endYearNum, 12));

    // Fetch each year independently, in parallel — ProcYearlyMonthlyTotals for
    // one year doesn't depend on any other, so collapse the serial round-trips
    // (up to 10) into a single wave. Promise.all preserves the year order.
    const years: number[] = [];
    for (let year = startYearNum; year <= endYearNum; year++) {
      years.push(year);
    }

    const yearlyData: YearTotal[] = await Promise.all(
      years.map(async (year) => {
        // Get 12 months of data starting from January of this year
        const monthlyData = await getYearlyMonthlyTotals(1, year, exRate);

        // No filter: getYearlyMonthlyTotals(1, year, …) returns exactly this
        // year's twelve months, so the old `m.Year === year` pass was a no-op.
        return monthlyData.reduce<YearTotal>((acc, month) => ({
          Year: year,
          SumIQD: acc.SumIQD + (month.SumIQD || 0),
          SumUSD: acc.SumUSD + (month.SumUSD || 0),
          ExpensesIQD: acc.ExpensesIQD + (month.ExpensesIQD || 0),
          ExpensesUSD: acc.ExpensesUSD + (month.ExpensesUSD || 0),
          FinalIQDSum: acc.FinalIQDSum + (month.FinalIQDSum || 0),
          FinalUSDSum: acc.FinalUSDSum + (month.FinalUSDSum || 0),
          GrandTotal: acc.GrandTotal === null ? null : acc.GrandTotal + (month.GrandTotal || 0)
        }), {
          Year: year,
          SumIQD: 0,
          SumUSD: 0,
          ExpensesIQD: 0,
          ExpensesUSD: 0,
          FinalIQDSum: 0,
          FinalUSDSum: 0,
          GrandTotal: exRate === null ? null : 0
        });
      })
    );

    // Calculate overall summary
    const summary = yearlyData.reduce<StatisticsSummary>((acc, year) => ({
      totalRevenue: {
        IQD: acc.totalRevenue.IQD + year.SumIQD,
        USD: acc.totalRevenue.USD + year.SumUSD
      },
      totalExpenses: {
        IQD: acc.totalExpenses.IQD + Math.abs(year.ExpensesIQD),
        USD: acc.totalExpenses.USD + Math.abs(year.ExpensesUSD)
      },
      netProfit: {
        IQD: acc.netProfit.IQD + year.FinalIQDSum,
        USD: acc.netProfit.USD + year.FinalUSDSum
      },
      grandTotal:
        acc.grandTotal === null || year.GrandTotal === null
          ? null
          : acc.grandTotal + year.GrandTotal
    }), {
      totalRevenue: { IQD: 0, USD: 0 },
      totalExpenses: { IQD: 0, USD: 0 },
      netProfit: { IQD: 0, USD: 0 },
      grandTotal: exRate === null ? null : 0
    });

    sendData(res, reports.multiYearStatistics.response, {
      startYear: startYearNum,
      endYear: endYearNum,
      exchangeRate: exRate,
      yearlyData: yearlyData,
      summary: summary
    });

  } catch (error) {
    log.error('Error fetching multi-year statistics:', error);
    ErrorResponses.internalError(res, 'Failed to fetch multi-year statistics', error as Error);
  }
});

/**
 * GET /statistics/commissions
 * Per-doctor commission over a date range (the Statistics "Commissions" tab; the
 * client defaults the range to the current month). For each commission-enabled
 * doctor, commission = money collected on their works in [startDate, endDate]
 * × their rate / 100, computed separately for IQD and USD (no conversion). Quit
 * doctors are included for periods they were working.
 * Query params: startDate, endDate (YYYY-MM-DD — validated by the contract).
 */
router.get(
  '/statistics/commissions',
  authorize(ADMIN_ROLES), // per-doctor earnings — admin-only (mirrors the hidden Statistics tab)
  validate({ query: reports.commissions.query }),
  async (req: Request<object, object, object, CommissionsQuery>, res: Response): Promise<void> => {
    try {
      const { startDate, endDate } = req.query;

      // YYYY-MM-DD compares lexicographically == chronologically.
      if (startDate > endDate) {
        ErrorResponses.badRequest(res, 'startDate must be on or before endDate');
        return;
      }

      // Money collected per doctor, split by currency (pure aggregation in SQL).
      const paid = await getDoctorCommissions(startDate, endDate);

      // Commission = collected × rate / 100, rounded, per currency.
      const rows = paid.map((d) => ({
        ...d,
        commission_iqd: Math.round((d.paid_iqd * d.commission_percentage) / 100),
        commission_usd: Math.round((d.paid_usd * d.commission_percentage) / 100),
      }));

      sendData(res, reports.commissions.response, { rows, startDate, endDate });
    } catch (error) {
      log.error('Error fetching doctor commissions:', error);
      ErrorResponses.internalError(res, 'Failed to fetch doctor commissions', error as Error);
    }
  }
);

/**
 * GET /statistics/revenue-breakdown
 * Revenue collected in [startDate, endDate] broken down by work type AND by doctor
 * (the Statistics "Breakdown" tab; client defaults the range to the current month).
 * Money = invoices.amount_paid keyed on date_of_payment, split by works.currency. Each
 * list is ranked by a USD-equivalent total (paid_usd + paid_iqd / rate) using the most
 * recent real exchange rate from `sms` (NOT the hardcoded statistics fallback); the rate
 * used is echoed back so the UI can show it.
 * Query params: startDate, endDate (YYYY-MM-DD — validated by the contract).
 */
router.get(
  '/statistics/revenue-breakdown',
  authorize(ADMIN_ROLES), // revenue by doctor/work type — admin-only (mirrors the hidden Statistics tab)
  validate({ query: reports.revenueBreakdown.query }),
  async (req: Request<object, object, object, RevenueBreakdownQuery>, res: Response): Promise<void> => {
    try {
      const { startDate, endDate } = req.query;

      // YYYY-MM-DD compares lexicographically == chronologically.
      if (startDate > endDate) {
        ErrorResponses.badRequest(res, 'startDate must be on or before endDate');
        return;
      }

      // Independent reads — fan out in one wave.
      const [latestRate, byWorkTypeRaw, byDoctorRaw] = await Promise.all([
        getLatestExchangeRate(),
        getRevenueByWorkType(startDate, endDate),
        getRevenueByDoctor(startDate, endDate),
      ]);

      // null when `sms` has never held a rate — no house rate stands in for it.
      const exchangeRate = latestRate;

      sendData(res, reports.revenueBreakdown.response, {
        byWorkType: rankByUsdEquivalent(byWorkTypeRaw, exchangeRate),
        byDoctor: rankByUsdEquivalent(byDoctorRaw, exchangeRate),
        exchangeRate,
        startDate,
        endDate,
      });
    } catch (error) {
      log.error('Error fetching revenue breakdown:', error);
      ErrorResponses.internalError(res, 'Failed to fetch revenue breakdown', error as Error);
    }
  }
);

/**
 * GET /statistics/doctor-payments/:doctorId
 * The per-payment DETAIL behind one doctor's aggregate row on the Statistics "Breakdown"
 * and "Commissions" tabs: every invoice on that doctor's works in [startDate, endDate],
 * with patient name, work type, date and amount. Same revenue definition as the two
 * aggregates it drills into, so the list reconciles against the row it was opened from.
 *
 * Capped at DOCTOR_PAYMENTS_LIMIT rows (only reachable on a multi-year range) with a
 * `truncated` flag — the client shows its headline totals from the already-loaded
 * aggregate row, never by summing these, so a partial list can't understate the money.
 * Query params: startDate, endDate (YYYY-MM-DD — validated by the contract).
 */
router.get(
  '/statistics/doctor-payments/:doctorId',
  authorize(ADMIN_ROLES), // per-doctor earnings — same gate as the tabs this drills into
  validate({ params: reports.doctorPayments.params, query: reports.doctorPayments.query }),
  async (
    req: Request<DoctorPaymentsParams, object, object, DoctorPaymentsQuery>,
    res: Response
  ): Promise<void> => {
    try {
      const doctorId = Number(req.params.doctorId); // regex-validated as digits by the contract
      const { startDate, endDate } = req.query;

      // YYYY-MM-DD compares lexicographically == chronologically.
      if (startDate > endDate) {
        ErrorResponses.badRequest(res, 'startDate must be on or before endDate');
        return;
      }

      // The query fetches LIMIT+1 so one extra row is the truncation signal.
      const fetched = await getDoctorPayments(doctorId, startDate, endDate);
      const truncated = fetched.length > DOCTOR_PAYMENTS_LIMIT;

      sendData(res, reports.doctorPayments.response, {
        rows: truncated ? fetched.slice(0, DOCTOR_PAYMENTS_LIMIT) : fetched,
        truncated,
        doctorId,
        startDate,
        endDate,
      });
    } catch (error) {
      log.error('Error fetching doctor payments:', error);
      ErrorResponses.internalError(res, 'Failed to fetch doctor payments', error as Error);
    }
  }
);

/**
 * GET /daily-invoices
 * Get daily invoices for a specific date
 * Query params: date (YYYY-MM-DD format)
 *
 * FINANCE_ROLES — every payment taken that day, by patient, with the cash split. Same
 * tier as /statistics: front desk reconciles the drawer from this, clinical staff don't.
 */
router.get('/daily-invoices', authorize(FINANCE_ROLES), async (req: Request<object, object, object, DailyInvoicesQuery>, res: Response): Promise<void> => {
  try {
    const { date } = req.query;

    // Validate required parameter
    if (!date) {
      ErrorResponses.missingParameter(res, 'date');
      return;
    }

    // Delegate validation to service layer
    validateDate(date);

    // Invoices paid on this date, cash-received splits included (sys_start_time already a
    // UTC '…Z' ISO string from the query). ONE query — the per-invoice enrichment pass
    // this used to make was fetching two columns that were already on the row.
    const invoices = await getDailyInvoices(date);

    sendData(res, reports.dailyInvoices.response, {
      date: date,
      count: invoices.length,
      invoices: invoices
    });

  } catch (error) {
    log.error('Error fetching daily invoices:', error);

    const err = error as Error;
    // Handle validation errors from service layer
    if (err.message === 'Invalid date format') {
      ErrorResponses.invalidParameter(res, 'date', { message: err.message });
      return;
    }

    ErrorResponses.internalError(res, 'Failed to fetch daily invoices', err);
  }
});

export default router;
