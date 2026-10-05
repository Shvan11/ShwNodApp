/**
 * Expiry dates on Stand items (`stand_items.expiry_date`, a PG `date` that reaches
 * the browser as `'YYYY-MM-DD'`). Pure, so the rules are unit-tested.
 *
 * Comparisons stay on the date STRING or on local days: `new Date('YYYY-MM-DD')` is
 * UTC midnight, which made an item "expired" from 03:00 on its last good day in
 * Baghdad and a day early anywhere west of UTC (audit FE-F19-12).
 */
import { parseLocalDate, toLocalDateString } from './calendarDate';

/**
 * The local `'YYYY-MM-DD'` of `at`. Components pass a query's `dataUpdatedAt` (no
 * clock read during render); event handlers call it with no argument for "now".
 */
export function localToday(at: Date | number = Date.now()): string {
  return toLocalDateString(new Date(at));
}

/** An item is expired the day AFTER its expiry date: it is good through that day. */
export function isExpired(expiry: string | null | undefined, today: string): boolean {
  return !!expiry && expiry < today;
}

/** Whole days from `today` to `expiry` (negative once it has passed). */
export function daysUntil(expiry: string, today: string): number {
  const ms = parseLocalDate(expiry).getTime() - parseLocalDate(today).getTime();
  return Math.round(ms / 86_400_000);
}

const pad = (n: number) => String(n).padStart(2, '0');

function realDay(y: number, m: number, d: number): string | null {
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

function lastDayOfMonth(y: number, m: number): string | null {
  if (m < 1 || m > 12) return null;
  return realDay(y, m, new Date(y, m, 0).getDate());
}

/**
 * Turn whatever the AI scan read off the packaging into a `'YYYY-MM-DD'`, or null
 * when it can't be read with confidence (audit FE-F19-10). The model is asked for
 * ISO, but packaging prints a month more often than a day:
 *   - `2027-05-31`                → itself (when it is a real day)
 *   - `2027-05`, `2027/5`         → the last day of that month
 *   - `05/2027`, `5-2027`, `05.2027` → the last day of that month
 *   - `31/05/2027`, `31.05.2027`  → that day (day first, as printed in Iraq)
 */
export function normalizeScannedExpiry(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return realDay(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{4})[-/.](\d{1,2})$/.exec(s);
  if (m) return lastDayOfMonth(Number(m[1]), Number(m[2]));
  m = /^(\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) return lastDayOfMonth(Number(m[2]), Number(m[1]));
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) return realDay(Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}
