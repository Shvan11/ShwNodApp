/**
 * Date helpers for the server boundary.
 */

/**
 * Format a date value to a local-time `YYYY-MM-DD` string.
 *
 * The mssql pool runs with `useUTC: false` (see `config/config.ts`), so the
 * driver builds `Date` objects in the server's local timezone. Reading them back
 * with *local* getters returns the exact wall-clock date the DB stored — with no
 * UTC round-trip, which is what shifts a midnight value back a day when a date is
 * serialized via `toISOString()` and then sliced.
 *
 * This is the code-side equivalent of the `CONVERT(varchar, col, 23)` pattern
 * used in the inline SQL queries (e.g. `patient-queries` DateOfBirth/DateAdded),
 * for date columns that arrive as `Date` objects (stored-proc results, etc.).
 *
 * @param value Date object (typical), parseable string, or null/undefined.
 * @returns `YYYY-MM-DD`, or `''` for null/invalid input.
 */
export function toDateOnly(value: Date | string | null | undefined): string {
  if (!value) return '';
  // Plain date strings pass through untouched. Round-tripping them via
  // `new Date('YYYY-MM-DD')` parses as UTC midnight, which the local getters
  // below would shift back a day on a negative-offset timezone.
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parse a `YYYY-MM-DD` string to a LOCAL-midnight Date (the app stores
 * wall-clock dates, never UTC — `new Date('YYYY-MM-DD')` would parse UTC).
 * Structural only; returns null for non-matching input.
 */
export function parseLocalDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
