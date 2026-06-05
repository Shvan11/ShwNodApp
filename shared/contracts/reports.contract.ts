/**
 * API contract — reports / statistics endpoints (`/api/statistics*`,
 * `/api/daily-invoices`).
 *
 * Single source of truth for each endpoint's response shapes, imported by BOTH
 * the Express routes (relative `.js`) and the React app (`@shared` alias). See
 * docs/shared-contract-progress.md.
 *
 * Phase 13 (Wave 2). Group B — response-only. Each statistics aggregate is a
 * closed-ish container: the period/array field is asserted (`anyArray`), the
 * rich `summary` block is `z.unknown()` (preserve — it's a service-computed type).
 */
import { z } from 'zod';

// "is it an array" guard — flip-free (every type is assignable to `unknown`).
const anyArray = z.array(z.unknown());

// GET /api/statistics → { month, year, exchangeRate, dailyData, summary }.
export const statistics = {
  response: z.looseObject({ dailyData: anyArray, summary: z.unknown() }),
} as const;

// GET /api/statistics/yearly → { startMonth, startYear, …, monthlyData, summary }.
export const yearlyStatistics = {
  response: z.looseObject({ monthlyData: anyArray, summary: z.unknown() }),
} as const;

// GET /api/statistics/multi-year → { startYear, endYear, …, yearlyData, summary }.
export const multiYearStatistics = {
  response: z.looseObject({ yearlyData: anyArray, summary: z.unknown() }),
} as const;

// GET /api/daily-invoices → { date, count, invoices }.
export const dailyInvoices = {
  response: z.looseObject({ invoices: anyArray, count: z.number() }),
} as const;
