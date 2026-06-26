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
import { sql } from 'kysely';
import { getKysely } from '../database/kysely.js';

/**
 * currency amounts
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
  Day?: string;
  SumIQD?: number;
  SumUSD?: number;
  ExpensesIQD?: number;
  ExpensesUSD?: number;
  ExpectedCashIQD?: number;
  ExpectedCashUSD?: number;
  GrandTotal?: number;
  GrandTotalIQD?: number;
  FinalIQDSum?: number;
  FinalUSDSum?: number;
}

/**
 * Base invoice from stored procedure
 */
export interface BaseInvoice {
  invoice_id: number;
  workid?: number;
  amount_paid?: number;
  date_of_payment?: Date | string;
  patient_name?: string;
  phone?: string;
  sys_start_time?: Date | string;
  currency?: string;
  change?: number;
}

/**
 * Enriched invoice with payment details
 */
export interface EnrichedInvoice extends BaseInvoice {
  iqd_received: number;
  usd_received: number;
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
 * Aggregates daily revenue and calculates:
 * - Total revenue (IQD and USD)
 * - Total expenses (IQD and USD)
 * - Net profit (revenue - expenses)
 * - Grand totals (converted using exchange rate)
 * - Cash box balance (from last day)
 *
 * Revenue is summed from the per-day rows; expenses come from `monthlyExpenses` (the
 * month's ALL-expenses total, including monthly/recurring ones) rather than the per-day
 * rows — those rows are now DAILY-ONLY (monthly expenses excluded so they don't distort
 * the per-day breakdown). The month rollup still counts monthly expenses, so net profit
 * is unchanged from before this split.
 *
 * @param dailyData - Daily data from getMonthlyGrandTotals (per-day, daily-only expenses)
 * @param exchangeRate - Exchange rate for USD to IQD conversion
 * @param monthlyExpenses - Month's total expenses by currency, ALL expenses (positive)
 * @returns Aggregated monthly statistics
 */
export function calculateMonthlyStatistics(
  dailyData: DailyData[],
  exchangeRate: number,
  monthlyExpenses: CurrencyAmounts
): MonthlyStatistics {
  let totalIQD = 0;
  let totalUSD = 0;
  let finalExpectedCashIQD = 0;
  let finalExpectedCashUSD = 0;

  // Aggregate daily revenue + carry the running cash-box balance.
  dailyData.forEach((day) => {
    totalIQD += day.SumIQD || 0;
    totalUSD += day.SumUSD || 0;
    // Use the last day's Expected Cash values as the final balance
    finalExpectedCashIQD = day.ExpectedCashIQD || 0;
    finalExpectedCashUSD = day.ExpectedCashUSD || 0;
  });

  // Month expenses include monthly/recurring costs (rent, utilities) — a month-level
  // figure, not the sum of the daily-only per-day rows.
  const totalExpensesIQD = Math.abs(monthlyExpenses.IQD || 0);
  const totalExpensesUSD = Math.abs(monthlyExpenses.USD || 0);

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
      IQD: finalExpectedCashIQD,
      USD: finalExpectedCashUSD,
    },
  };
}

/**
 * Invoice details from database
 */
interface InvoiceDetails {
  iqd_received: number | null;
  usd_received: number | null;
  [key: string]: number | null;
}

/**
 * Enrich an invoice with additional details
 *
 * Fetches iqd_received and usd_received for a specific invoice
 *
 * @param invoice - Base invoice object
 * @returns Enriched invoice with iqd_received and usd_received
 */
async function enrichInvoice(invoice: BaseInvoice): Promise<EnrichedInvoice> {
  const db = getKysely();
  const { rows: invoiceDetails } = await sql<InvoiceDetails>`
    SELECT "iqd_received", "usd_received" FROM "invoices" WHERE "invoice_id" = ${invoice.invoice_id}
  `.execute(db);

  return {
    ...invoice,
    iqd_received: invoiceDetails[0]?.iqd_received || 0,
    usd_received: invoiceDetails[0]?.usd_received || 0,
  };
}

/**
 * Enrich invoices with additional details in parallel
 *
 * For each invoice from the stored procedure, fetches additional
 * payment details (iqd_received, usd_received) using Promise.all
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
