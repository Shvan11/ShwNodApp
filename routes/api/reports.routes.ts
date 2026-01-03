/**
 * Reports & Statistics Routes
 * Handles financial statistics and daily invoice reports
 */
import { Router, type Request, type Response } from 'express';
import { log } from '../../utils/logger.js';
import * as database from '../../services/database/index.js';
import { ErrorResponses } from '../../utils/error-response.js';
import {
  calculateMonthlyStatistics,
  enrichInvoicesWithDetails,
  validateMonthYear,
  validateDate,
  type DailyData,
  type BaseInvoice
} from '../../services/business/FinancialReportService.js';

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
 * Invoice row from ProDailyInvoices stored procedure
 * Used for daily invoice listing, extended from BaseInvoice
 */
interface InvoiceRow extends BaseInvoice {
  [key: string]: string | number | Date | null | undefined;
}

/**
 * Monthly data row from stored procedure
 */
interface MonthlyDataRow {
  Year?: number;
  SumIQD?: number;
  SumUSD?: number;
  ExpensesIQD?: number;
  ExpensesUSD?: number;
  FinalIQDSum?: number;
  FinalUSDSum?: number;
  GrandTotal?: number;
  [key: string]: string | number | Date | null | undefined;
}

/**
 * Currency totals structure
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

    // Execute the stored procedure
    const dailyData = await database.executeStoredProcedure<DailyData>(
      'ProcGrandTotal',
      [
        ['month', database.TYPES.Int, monthNum],
        ['year', database.TYPES.Int, yearNum],
        ['Ex', database.TYPES.Int, exRate]
      ],
      undefined, // beforeExec callback
      (columns) => {
        // Row mapper - convert columns to DailyData object
        const row: DailyData = {};
        columns.forEach(column => {
          const value = column.value;
          const name = column.metadata.colName as keyof DailyData;
          if (value === null || value === undefined) {
            // Skip null/undefined values
            return;
          } else if (typeof value === 'number' || typeof value === 'string') {
            (row as Record<string, unknown>)[name] = value;
          } else if (value instanceof Date) {
            // Format Date objects without timezone conversion
            (row as Record<string, unknown>)[name] = `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
          } else if (typeof value === 'object' && value.constructor?.name === 'Date') {
            // Handle Date-like objects from Tedious - format without timezone conversion
            const d = value as Date;
            (row as Record<string, unknown>)[name] = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          } else if (typeof (value as { getFullYear?: () => number })?.getFullYear === 'function') {
            // Handle objects with Date methods - format without timezone conversion
            const d = value as Date;
            (row as Record<string, unknown>)[name] = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          } else {
            // Fallback: convert to string
            (row as Record<string, unknown>)[name] = String(value);
          }
        });
        return row;
      }
    );

    // Delegate calculation to service layer
    const summary = calculateMonthlyStatistics(dailyData, exRate);

    res.json({
      success: true,
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

    // Execute stored procedure for 12-month period
    const monthlyData = await database.executeStoredProcedure<MonthlyDataRow>(
      'ProcYearlyMonthlyTotals',
      [
        ['startMonth', database.TYPES.Int, monthNum],
        ['startYear', database.TYPES.Int, yearNum],
        ['Ex', database.TYPES.Int, exRate]
      ],
      undefined,
      (columns) => {
        const row: MonthlyDataRow = {};
        columns.forEach(column => {
          row[column.metadata.colName] = column.value as string | number | Date | null;
        });
        return row;
      }
    );

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

    res.json({
      success: true,
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

    // Fetch data for each year by calling ProcYearlyMonthlyTotals for Jan-Dec
    const yearlyData: YearTotal[] = [];

    for (let year = startYearNum; year <= endYearNum; year++) {
      // Get 12 months of data starting from January of this year
      const monthlyData = await database.executeStoredProcedure<MonthlyDataRow>(
        'ProcYearlyMonthlyTotals',
        [
          ['startMonth', database.TYPES.Int, 1],
          ['startYear', database.TYPES.Int, year],
          ['Ex', database.TYPES.Int, exRate]
        ],
        undefined,
        (columns) => {
          const row: MonthlyDataRow = {};
          columns.forEach(column => {
            row[column.metadata.colName] = column.value as string | number | Date | null;
          });
          return row;
        }
      );

      // Filter to only include months from this year and aggregate
      const yearMonths = monthlyData.filter(m => m.Year === year);
      const yearTotal = yearMonths.reduce<YearTotal>((acc, month) => ({
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

      yearlyData.push(yearTotal);
    }

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

    res.json({
      success: true,
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
    const dateObj = validateDate(date);

    // Execute the stored procedure
    const baseInvoices = await database.executeStoredProcedure<BaseInvoice>(
      'ProDailyInvoices',
      [['iDate', database.TYPES.Date, dateObj]],
      undefined,
      (columns) => {
        // Map columns to BaseInvoice - invoiceID is required
        const invoiceID = columns.find(c => c.metadata.colName === 'invoiceID')?.value as number;
        if (invoiceID === undefined || invoiceID === null) {
          throw new Error('invoiceID is required in ProDailyInvoices result');
        }
        return {
          invoiceID,
          workid: columns.find(c => c.metadata.colName === 'workid')?.value as number | undefined,
          Amountpaid: columns.find(c => c.metadata.colName === 'Amountpaid')?.value as number | undefined,
          Dateofpayment: columns.find(c => c.metadata.colName === 'Dateofpayment')?.value as Date | string | undefined,
          PatientName: columns.find(c => c.metadata.colName === 'PatientName')?.value as string | undefined,
          Phone: columns.find(c => c.metadata.colName === 'Phone')?.value as string | undefined
        };
      }
    );

    // Delegate enrichment to service layer
    const enrichedInvoices = await enrichInvoicesWithDetails(baseInvoices);

    res.json({
      success: true,
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
