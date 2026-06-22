/**
 * Reports & Statistics Routes
 * Handles financial statistics and daily invoice reports
 */
import { Router, type Request, type Response } from 'express';
import { log } from '../../utils/logger.js';
import { ErrorResponses, sendData } from '../../utils/error-response.js';
import { validate } from '../../middleware/validate.js';
import { authorize } from '../../middleware/auth.js';
import * as reports from '../../shared/contracts/reports.contract.js';
import {
  calculateMonthlyStatistics,
  enrichInvoicesWithDetails,
  validateMonthYear,
  validateDate,
} from '../../services/business/FinancialReportService.js';
import {
  getMonthlyGrandTotals,
  getYearlyMonthlyTotals,
  getDailyInvoices,
  getDoctorCommissions,
  getRevenueByWorkType,
  getRevenueByDoctor,
  type RevenueBreakdownRow,
} from '../../services/database/queries/report-queries.js';
import { getLatestExchangeRate } from '../../services/database/queries/payment-queries.js';

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

/** Default IQD-per-USD rate used only if the `sms` table has no rate at all. */
const FALLBACK_EXCHANGE_RATE = 1450;

/**
 * Attach usd_equivalent (paid_usd + paid_iqd / rate, rounded to 2dp) to each breakdown
 * row and sort descending — the "which earns most money" ranking. IQD/USD stay separate
 * in the payload; the USD-equivalent is only a ranking + headline figure.
 */
function rankByUsdEquivalent(rows: RevenueBreakdownRow[], rate: number): reports.RevenueRow[] {
  return rows
    .map((r) => ({
      ...r,
      usd_equivalent: Math.round((r.paid_usd + r.paid_iqd / rate) * 100) / 100,
    }))
    .sort((a, b) => b.usd_equivalent - a.usd_equivalent);
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
  grandTotal: number;
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
  GrandTotal: number;
}

/**
 * GET /statistics
 * Get monthly financial statistics
 * Query params: month, year, exchangeRate (optional)
 */
router.get('/statistics', async (req: Request<object, object, object, StatisticsQuery>, res: Response): Promise<void> => {
  try {
    const { month, year, exchangeRate } = req.query;

    // Validate required parameters
    if (!month || !year) {
      ErrorResponses.badRequest(res, 'Missing required parameters: month and year are required');
      return;
    }

    // Delegate validation to service layer
    const { month: monthNum, year: yearNum } = validateMonthYear(month, year);
    const exRate = exchangeRate ? parseInt(exchangeRate) : 1450; // Default exchange rate

    // Daily cash-box totals for the month (Day arrives as a 'YYYY-MM-DD' string from PG).
    const dailyData = await getMonthlyGrandTotals(monthNum, yearNum, exRate);

    // Delegate calculation to service layer
    const summary = calculateMonthlyStatistics(dailyData, exRate);

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
 */
router.get('/statistics/yearly', async (req: Request<object, object, object, YearlyStatisticsQuery>, res: Response): Promise<void> => {
  try {
    const { startMonth, startYear, exchangeRate } = req.query;

    // Validate required parameters
    if (!startMonth || !startYear) {
      ErrorResponses.badRequest(res, 'Missing required parameters: startMonth and startYear are required');
      return;
    }

    const { month: monthNum, year: yearNum } = validateMonthYear(startMonth, startYear);
    const exRate = exchangeRate ? parseInt(exchangeRate) : 1450;

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
      grandTotal: acc.grandTotal + (month.GrandTotal || 0)
    }), {
      totalRevenue: { IQD: 0, USD: 0 },
      totalExpenses: { IQD: 0, USD: 0 },
      netProfit: { IQD: 0, USD: 0 },
      grandTotal: 0
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
 */
router.get('/statistics/multi-year', async (req: Request<object, object, object, MultiYearStatisticsQuery>, res: Response): Promise<void> => {
  try {
    const { startYear, endYear, exchangeRate } = req.query;

    // Validate required parameters
    if (!startYear || !endYear) {
      ErrorResponses.badRequest(res, 'Missing required parameters: startYear and endYear are required');
      return;
    }

    const startYearNum = parseInt(startYear);
    const endYearNum = parseInt(endYear);
    const exRate = exchangeRate ? parseInt(exchangeRate) : 1450;

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

        // Filter to only include months from this year and aggregate
        const yearMonths = monthlyData.filter(m => m.Year === year);
        return yearMonths.reduce<YearTotal>((acc, month) => ({
          Year: year,
          SumIQD: acc.SumIQD + (month.SumIQD || 0),
          SumUSD: acc.SumUSD + (month.SumUSD || 0),
          ExpensesIQD: acc.ExpensesIQD + (month.ExpensesIQD || 0),
          ExpensesUSD: acc.ExpensesUSD + (month.ExpensesUSD || 0),
          FinalIQDSum: acc.FinalIQDSum + (month.FinalIQDSum || 0),
          FinalUSDSum: acc.FinalUSDSum + (month.FinalUSDSum || 0),
          GrandTotal: acc.GrandTotal + (month.GrandTotal || 0)
        }), {
          Year: year,
          SumIQD: 0,
          SumUSD: 0,
          ExpensesIQD: 0,
          ExpensesUSD: 0,
          FinalIQDSum: 0,
          FinalUSDSum: 0,
          GrandTotal: 0
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
      grandTotal: acc.grandTotal + year.GrandTotal
    }), {
      totalRevenue: { IQD: 0, USD: 0 },
      totalExpenses: { IQD: 0, USD: 0 },
      netProfit: { IQD: 0, USD: 0 },
      grandTotal: 0
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
  authorize(['admin']), // per-doctor earnings — admin-only (mirrors the hidden Statistics tab)
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
  authorize(['admin']), // revenue by doctor/work type — admin-only (mirrors the hidden Statistics tab)
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

      const exchangeRate = latestRate ?? FALLBACK_EXCHANGE_RATE;

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
 * GET /daily-invoices
 * Get daily invoices for a specific date
 * Query params: date (YYYY-MM-DD format)
 */
router.get('/daily-invoices', async (req: Request<object, object, object, DailyInvoicesQuery>, res: Response): Promise<void> => {
  try {
    const { date } = req.query;

    // Validate required parameter
    if (!date) {
      ErrorResponses.missingParameter(res, 'date');
      return;
    }

    // Delegate validation to service layer
    validateDate(date);

    // Invoices paid on this date (sys_start_time already a UTC '…Z' ISO string from the query).
    const baseInvoices = await getDailyInvoices(date);

    // Delegate enrichment to service layer
    const enrichedInvoices = await enrichInvoicesWithDetails(baseInvoices);

    sendData(res, reports.dailyInvoices.response, {
      date: date,
      count: enrichedInvoices.length,
      invoices: enrichedInvoices
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
