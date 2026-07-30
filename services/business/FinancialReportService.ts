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
  /** null on both legs when no exchange rate exists to convert with. */
  grandTotal: { IQD: number | null; USD: number | null };
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
  /** null when the day has no exchange rate and none can be carried in. */
  GrandTotal?: number | null;
  GrandTotalIQD?: number | null;
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
 * The GRAND TOTALS are accumulated from the per-day GrandTotal / GrandTotalIQD columns,
 * each of which getMonthlyGrandTotals already converted at THAT DAY's own exchange rate.
 * They used to be recomputed here by applying one flat rate to the whole month's net,
 * which made the summary card disagree with the daily table it sits above whenever the
 * rate moved during the month. `exchangeRate` is now only applied to the monthly-only
 * expenses (rent/utilities — `is_monthly` rows, absent from the per-day figures), which
 * are a month-level cost with no day to borrow a rate from.
 *
 * @param dailyData - Daily data from getMonthlyGrandTotals (per-day, daily-only expenses)
 * @param exchangeRate - Reference rate for the month (converts the monthly-only expenses)
 * @param monthlyExpenses - Month's total expenses by currency, ALL expenses (positive)
 * @returns Aggregated monthly statistics
 */
export function calculateMonthlyStatistics(
  dailyData: DailyData[],
  exchangeRate: number | null,
  monthlyExpenses: CurrencyAmounts
): MonthlyStatistics {
  let totalIQD = 0;
  let totalUSD = 0;
  let finalExpectedCashIQD = 0;
  let finalExpectedCashUSD = 0;
  // Per-day grand totals (already converted at each day's own rate) + the daily-only
  // expenses those rows netted out, so the monthly-only remainder can be isolated below.
  let dailyGrandTotalUSD = 0;
  let dailyGrandTotalIQD = 0;
  let dailyExpensesIQD = 0;
  let dailyExpensesUSD = 0;

  // Aggregate daily revenue + carry the running cash-box balance.
  dailyData.forEach((day) => {
    totalIQD += day.SumIQD || 0;
    totalUSD += day.SumUSD || 0;
    dailyGrandTotalUSD += day.GrandTotal || 0;
    dailyGrandTotalIQD += day.GrandTotalIQD || 0;
    // Expense columns arrive negative (the views select -SUM(amount)).
    dailyExpensesIQD += Math.abs(day.ExpensesIQD || 0);
    dailyExpensesUSD += Math.abs(day.ExpensesUSD || 0);
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

  // Whatever the per-day rows left out: the is_monthly expenses. Clamped at 0 so a
  // rounding artefact can never turn into a phantom credit.
  const monthlyOnlyExpensesIQD = Math.max(0, totalExpensesIQD - dailyExpensesIQD);
  const monthlyOnlyExpensesUSD = Math.max(0, totalExpensesUSD - dailyExpensesUSD);

  // Grand totals = the per-day (per-day-rate) totals, less the month-level costs.
  // With no rate on record anywhere there is nothing to convert with, so they report
  // null rather than a figure derived from an assumed rate. Every un-converted number
  // above (revenue, expenses, net profit, cash box) is unaffected and still exact.
  const grandTotalUSD =
    exchangeRate === null
      ? null
      : dailyGrandTotalUSD - (monthlyOnlyExpensesIQD / exchangeRate + monthlyOnlyExpensesUSD);
  const grandTotalIQD =
    exchangeRate === null
      ? null
      : dailyGrandTotalIQD - (monthlyOnlyExpensesIQD + monthlyOnlyExpensesUSD * exchangeRate);

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
      USD: grandTotalUSD === null ? null : Math.round(grandTotalUSD * 100) / 100,
      IQD: grandTotalIQD === null ? null : Math.round(grandTotalIQD),
    },
    cashBox: {
      IQD: finalExpectedCashIQD,
      USD: finalExpectedCashUSD,
    },
  };
}

// enrichInvoice / enrichInvoicesWithDetails are GONE. They ran one
// `SELECT iqd_received, usd_received FROM invoices WHERE invoice_id = ?` per invoice —
// for two columns the daily-invoices row already carried — so every open of the modal
// cost one round trip per invoice on top of the list query. getDailyInvoices
// (report-queries.ts) now selects both columns directly and returns EnrichedInvoice[].

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
 * Assert that a date parameter is parseable. Callers use this purely as a guard —
 * the parsed Date it used to return was discarded at the only call site — so it
 * returns nothing and simply throws on a bad value.
 * @param date - Date string in YYYY-MM-DD format
 * @throws Error If date format is invalid
 */
export function validateDate(date: string): void {
  if (isNaN(new Date(date).getTime())) {
    throw new Error('Invalid date format');
  }
}

export default {
  calculateMonthlyStatistics,
  validateMonthYear,
  validateDate,
};
