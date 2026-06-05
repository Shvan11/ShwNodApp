/**
 * Reports & Statistics Routes
 * Handles financial statistics and daily invoice reports
 */
import { Router, type Request, type Response } from 'express';
import { log } from '../../utils/logger.js';
import { ErrorResponses, sendData } from '../../utils/error-response.js';
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
} from '../../services/database/queries/report-queries.js';

const router = Router();

/**
 * Query parameters for monthly statistics
 */
interface StatisticsQuery {
  month?: string;
  year?: string;
  exchangeRate?: string;
}

/**
 * Query parameters for yearly statistics
 */
interface YearlyStatisticsQuery {
  startMonth?: string;
  startYear?: string;
  exchangeRate?: string;
}

/**
 * Query parameters for multi-year statistics
 */
interface MultiYearStatisticsQuery {
  startYear?: string;
  endYear?: string;
  exchangeRate?: string;
}

/**
 * Query parameters for daily invoices
 */
interface DailyInvoicesQuery {
  date?: string;
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
