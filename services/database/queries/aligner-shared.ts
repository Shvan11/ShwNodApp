/**
 * Helpers shared by the aligner query modules.
 *
 * Split out of aligner-queries.ts (S2/C4). Everything here is used by BOTH the set
 * writes and the batch writes, which is the only reason it isn't inside one of them.
 */
import type { Transaction } from 'kysely';
import type { Database } from '../kysely.js';

export type PgTransaction = Transaction<Database>;

/**
 * Coerce a possibly-empty / string numeric input to an integer.
 *
 * Blank form fields arrive over JSON as `''`, which `??` does NOT catch —
 * passing `''` to an integer column throws PG `22P02`
 * (`invalid input syntax for type integer: ""`). Returns `fallback` for
 * null/undefined/empty/non-numeric values; otherwise the truncated integer.
 */
export function toIntOr<T extends number | null>(value: unknown, fallback: T): number | T {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}
