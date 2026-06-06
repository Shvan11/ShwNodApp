/**
 * API contract — reports / statistics endpoints (`/api/statistics*`,
 * `/api/daily-invoices`).
 *
 * Single source of truth for each endpoint's response shapes, imported by BOTH
 * the Express routes (relative `.js`) and the React app (`@shared` alias). See
 * docs/shared-contract-progress.md.
 *
 * Phase 13 (Wave 2). Group B — response-only. Phase 3 Group 5: all responses are
 * intentionally loose (server-side computed aggregates whose structure varies by
 * period/filter combination). Containers assert the stable array/object key;
 * inner shapes stay loose to preserve the full service-computed payload.
 */
import { z } from 'zod';

// "is it an array" guard — flip-free (every type is assignable to unknown).
const anyArray = z.array(z.unknown());

// GET /api/statistics → { month, year, exchangeRate, dailyData, summary }.
export const statistics = {
  // Intentionally loose: computed aggregate — dailyData rows and summary block are service-computed, structure varies by filter
  response: z.looseObject({ dailyData: anyArray, summary: z.unknown() }),
} as const;

// GET /api/statistics/yearly → { startMonth, startYear, …, monthlyData, summary }.
export const yearlyStatistics = {
  // Intentionally loose: computed aggregate — monthlyData rows and summary block are service-computed, structure varies by filter
  response: z.looseObject({ monthlyData: anyArray, summary: z.unknown() }),
} as const;

// GET /api/statistics/multi-year → { startYear, endYear, …, yearlyData, summary }.
export const multiYearStatistics = {
  // Intentionally loose: computed aggregate — yearlyData rows and summary block are service-computed, structure varies by filter
  response: z.looseObject({ yearlyData: anyArray, summary: z.unknown() }),
} as const;

// GET /api/daily-invoices → { date, count, invoices }.
export const dailyInvoices = {
  query: z.object({ date: z.string().optional() }),
  // Intentionally loose: invoices array is an enriched invoice join — structure varies by work/payment state
  response: z.looseObject({ invoices: anyArray, count: z.number() }),
} as const;
export type DailyInvoicesQuery = z.infer<typeof dailyInvoices.query>;

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
