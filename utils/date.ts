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

// ---------------------------------------------------------------------------
// Clock / wall-clock formatting (SSoT)
// ---------------------------------------------------------------------------
//
// Every 12-hour rendering in the app funnels through here. There used to be three
// independent implementations — `fmtClock`/`fmtTimeStr` in appointment-queries.ts
// and `formatTime` in the appointment PDF generator — and they disagreed about
// whether their INPUT was 24-hour or already-converted 12-hour. The PDF read a
// `to_char(…,'HH12:MI')` value as if it were 24-hour, so every afternoon
// appointment printed as AM. One converter, one input convention: 24-hour in.

/** Format a Date's local wall-clock time as 12-hour `h:mm` (optionally ` AM`/` PM`). */
export function formatClock12(date: Date, withMeridiem = false): string {
  const h = date.getHours();
  const base = `${String(h % 12 || 12).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return withMeridiem ? `${base} ${h < 12 ? 'AM' : 'PM'}` : base;
}

/**
 * Format a 24-hour clock string (`HH:MM` or `HH:MM:SS`, e.g. a PG `time` column
 * or `to_char(…,'HH24:MI')`) as 12-hour `hh:mm`, optionally with a meridiem.
 * Returns `null` for null/empty input and echoes anything unparseable back
 * unchanged, so a malformed value is visible rather than silently rewritten.
 */
export function formatTime12(value: string | null | undefined, withMeridiem = false): string | null {
  if (!value) return null;
  const parts = value.split(':');
  if (parts.length < 2) return value;
  const h = parseInt(parts[0], 10);
  if (Number.isNaN(h)) return value;
  const base = `${String(h % 12 || 12).padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
  return withMeridiem ? `${base} ${h < 12 ? 'AM' : 'PM'}` : base;
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Render a date/time against a moment-style token pattern (`dddd, MMMM DD, YYYY`,
 * `hh:mm A`, …). Local getters throughout — the app stores wall-clock values, so a
 * UTC round-trip would shift the day.
 *
 * Tokens are substituted in one left-to-right scan (longest token wins at each
 * position) so a token can never match inside text an earlier substitution
 * produced — 'May' contains no token, but 'March' contains 'A' and the old
 * two-pass placeholder dance existed only to dodge that.
 *
 * Returns `''` for null/undefined and echoes an unparseable value unchanged.
 */
export function formatDatePattern(value: Date | string | number | null | undefined, pattern: string): string {
  if (value === null || value === undefined || value === '') return '';
  // A bare 'YYYY-MM-DD' must be read as a LOCAL date. `new Date('2026-11-01')`
  // parses UTC midnight, which the local getters below then render as the
  // PREVIOUS day anywhere west of UTC — the clinic runs at UTC+3 today, but this
  // ships to centers in their own timezones.
  const date =
    value instanceof Date
      ? value
      : (typeof value === 'string' ? parseLocalDate(value) : null) ?? new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  const hours24 = date.getHours();
  const hours12 = hours24 % 12 || 12;
  const meridiem = hours24 >= 12 ? 'PM' : 'AM';

  const tokens: Record<string, string> = {
    dddd: DAYS_FULL[date.getDay()],
    YYYY: String(date.getFullYear()),
    YY: String(date.getFullYear()).slice(-2),
    MMMM: MONTHS_FULL[date.getMonth()],
    MMM: MONTHS_SHORT[date.getMonth()],
    MM: String(date.getMonth() + 1).padStart(2, '0'),
    DD: String(date.getDate()).padStart(2, '0'),
    HH: String(hours24).padStart(2, '0'),
    hh: String(hours12).padStart(2, '0'),
    h: String(hours12),
    mm: String(date.getMinutes()).padStart(2, '0'),
    ss: String(date.getSeconds()).padStart(2, '0'),
    A: meridiem,
    a: meridiem.toLowerCase(),
  };
  // Longest-first so 'MMMM' is tried before 'MMM' before 'MM'.
  const ordered = Object.keys(tokens).sort((a, b) => b.length - a.length);

  let out = '';
  let i = 0;
  outer: while (i < pattern.length) {
    for (const token of ordered) {
      if (pattern.startsWith(token, i)) {
        out += tokens[token];
        i += token.length;
        continue outer;
      }
    }
    out += pattern[i];
    i += 1;
  }
  return out;
}
