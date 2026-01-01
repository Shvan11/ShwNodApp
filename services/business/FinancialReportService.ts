/**
 * Financial Report Service - Business Logic Layer
 *
 * This service handles all financial reporting business logic including:
 * - Monthly statistics calculations with multi-currency aggregation
 * - Net profit calculations
 * - Grand totals with exchange rate conversions
 * - Cash box balance extraction
 * - Daily invoice enrichment with additional queries
 *
 * This layer sits between route handlers and database queries,
 * encapsulating complex financial calculation and aggregation logic.
 */

import { log } from '../../utils/logger.js';
import * as database from '../database/index.js';

/**
 * Currency amounts
 */
export interface CurrencyAmounts {
  IQD: number;
  USD: number;
}

/**
 * Monthly statistics result
 */
export interface MonthlyStatistics {
  totalRevenue: CurrencyAmounts;
  totalExpenses: CurrencyAmounts;
  netProfit: CurrencyAmounts;
  grandTotal: CurrencyAmounts;
  cashBox: CurrencyAmounts;
}

/**
 * Daily data from ProcGrandTotal
 */
export interface DailyData {
  SumIQD?: number;
  SumUSD?: number;
  ExpensesIQD?: number;
  ExpensesUSD?: number;
  QasaIQD?: number;
  QasaUSD?: number;
  Date?: string;
  DayTotal?: number;
}

/**
 * Base invoice from stored procedure
 */
export interface BaseInvoice {
  invoiceID: number;
  workid?: number;
  Amountpaid?: number;
  Dateofpayment?: Date | string;
  PatientName?: string;
  Phone?: string;
}

/**
 * Enriched invoice with payment details
 */
export interface EnrichedInvoice extends BaseInvoice {
  IQDReceived: number;
  USDReceived: number;
}

/**
 * Validated month/year
 */
export interface ValidatedMonthYear {
  month: number;
  year: number;
}

/**
 * Calculate monthly financial statistics from daily data
 *
 * Aggregates daily revenue, expenses, and calculates:
 * - Total revenue (IQD and USD)
 * - Total expenses (IQD and USD)
 * - Net profit (revenue - expenses)
 * - Grand totals (converted using exchange rate)
 * - Cash box balance (from last day)
 *
 * @param dailyData - Daily data from ProcGrandTotal
 * @param exchangeRate - Exchange rate for USD to IQD conversion
 * @returns Aggregated monthly statistics
 */
export function calculateMonthlyStatistics(
  dailyData: DailyData[],
  exchangeRate: number
): MonthlyStatistics {
  let totalIQD = 0;
  let totalUSD = 0;
  let totalExpensesIQD = 0;
  let totalExpensesUSD = 0;
  let finalQasaIQD = 0;
  let finalQasaUSD = 0;

  // Aggregate daily values
  dailyData.forEach((day) => {
    totalIQD += day.SumIQD || 0;
    totalUSD += day.SumUSD || 0;
    totalExpensesIQD += Math.abs(day.ExpensesIQD || 0);
    totalExpensesUSD += Math.abs(day.ExpensesUSD || 0);
    // Use the last day's Qasa values as the final balance
    finalQasaIQD = day.QasaIQD || 0;
    finalQasaUSD = day.QasaUSD || 0;
  });

  // Calculate net profit
  const netIQD = totalIQD - totalExpensesIQD;
  const netUSD = totalUSD - totalExpensesUSD;

  // Calculate grand totals with currency conversion
  const grandTotalUSD = netIQD / exchangeRate + netUSD;
  const grandTotalIQD = netIQD + netUSD * exchangeRate;

  return {
    totalRevenue: {
      IQD: totalIQD,
      USD: totalUSD,
    },
    totalExpenses: {
      IQD: totalExpensesIQD,
      USD: totalExpensesUSD,
    },
    netProfit: {
      IQD: netIQD,
      USD: netUSD,
    },
    grandTotal: {
      USD: Math.round(grandTotalUSD * 100) / 100,
      IQD: Math.round(grandTotalIQD),
    },
    cashBox: {
      IQD: finalQasaIQD,
      USD: finalQasaUSD,
    },
  };
}

/**
 * Invoice details from database
 */
interface InvoiceDetails {
  IQDReceived: number | null;
  USDReceived: number | null;
  [key: string]: number | null;
}

/**
 * Enrich an invoice with additional details
 *
 * Fetches IQDReceived and USDReceived for a specific invoice
 *
 * @param invoice - Base invoice object
 * @returns Enriched invoice with IQDReceived and USDReceived
 */
async function enrichInvoice(invoice: BaseInvoice): Promise<EnrichedInvoice> {
  const invoiceDetails = await database.executeQuery<InvoiceDetails>(
    'SELECT IQDReceived, USDReceived FROM tblInvoice WHERE invoiceID = @invoiceID',
    [['invoiceID', database.TYPES.Int, invoice.invoiceID]],
    (columns) => {
      const row: InvoiceDetails = {
        IQDReceived: null,
        USDReceived: null,
      };
      columns.forEach((column) => {
        row[column.metadata.colName] = column.value as number | null;
      });
      return row;
    }
  );

  return {
    ...invoice,
    IQDReceived: invoiceDetails[0]?.IQDReceived || 0,
    USDReceived: invoiceDetails[0]?.USDReceived || 0,
  };
}

/**
 * Enrich invoices with additional details in parallel
 *
 * For each invoice from the stored procedure, fetches additional
 * payment details (IQDReceived, USDReceived) using Promise.all
 *
 * @param invoices - Base invoices from stored procedure
 * @returns Enriched invoices
 */
export async function enrichInvoicesWithDetails(
  invoices: BaseInvoice[]
): Promise<EnrichedInvoice[]> {
  if (!Array.isArray(invoices) || invoices.length === 0) {
    return [];
  }

  // Fetch additional details for all invoices in parallel
  const enrichedInvoices = await Promise.all(
    invoices.map((invoice) => enrichInvoice(invoice))
  );

  log.info(`Enriched ${enrichedInvoices.length} invoices with payment details`);

  return enrichedInvoices;
}

/**
 * Validate month and year parameters
 * @param month - Month (1-12)
 * @param year - Year (2000-2100)
 * @returns Validated month and year
 * @throws Error If validation fails
 */
export function validateMonthYear(
  month: number | string,
  year: number | string
): ValidatedMonthYear {
  const monthNum = parseInt(String(month));
  const yearNum = parseInt(String(year));

  if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
    throw new Error('Month must be between 1 and 12');
  }

  if (isNaN(yearNum) || yearNum < 2000 || yearNum > 2100) {
    throw new Error('Year must be between 2000 and 2100');
  }

  return { month: monthNum, year: yearNum };
}

/**
 * Validate and parse date parameter
 * @param date - Date string in YYYY-MM-DD format
 * @returns Parsed date object
 * @throws Error If date format is invalid
 */
export function validateDate(date: string): Date {
  const dateObj = new Date(date);
  if (isNaN(dateObj.getTime())) {
    throw new Error('Invalid date format');
  }
  return dateObj;
}

export default {
  calculateMonthlyStatistics,
  enrichInvoicesWithDetails,
  validateMonthYear,
  validateDate,
};
