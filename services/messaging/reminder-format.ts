/**
 * Pure formatting primitives for appointment-reminder text (WhatsApp + SMS).
 *
 * These were private to `services/database/queries/messaging-queries.ts`, which
 * made every rule that depends on them reachable only through a live database.
 * They are SQL-compat shims — each one reproduces what the retired stored
 * procedure did (`FORMAT(dt,'h:mm')`, `DATENAME(dw,…)`, the phone CASE ladder) —
 * so their quirks are deliberate and must not be "modernised" into the
 * `utils/phone-formatter.ts` / `Intl` equivalents: the reminder text and the
 * dialled number would both change.
 *
 * Nothing here does I/O, and nothing here imports the database layer, so the
 * decision modules that build on it (`whatsapp-batch-plan.ts`) stay unit-testable.
 */

const ENGLISH_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Parse a date-only string as LOCAL midnight (avoids the UTC-parse day-shift). */
function parseLocalDate(value: Date | string): Date {
  if (value instanceof Date) return value;
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? new Date(`${value.slice(0, 10)}T00:00:00`) : new Date(value);
}

/** SQL `DATENAME(dw, ...)` — English weekday name. */
export function englishDay(value: Date | string): string {
  return ENGLISH_DAYS[parseLocalDate(value).getDay()] ?? '';
}

/** Whole days from today (local wall-clock) to the target date. */
export function daysFromToday(target: Date | string): number {
  const t = parseLocalDate(target);
  const now = new Date();
  const a = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate());
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((a - b) / 86_400_000);
}

/** SQL `FORMAT(dt, 'h:mm')` / `'h:mm tt'` — 12-hour clock, no leading-zero hour. */
export function format12h(date: Date, withMeridiem = false): string {
  const h = date.getHours();
  const m = String(date.getMinutes()).padStart(2, '0');
  const h12 = h % 12 || 12;
  return withMeridiem ? `${h12}:${m} ${h < 12 ? 'AM' : 'PM'}` : `${h12}:${m}`;
}

/** SQL `FORMAT(d, 'dd/MM/yyyy')`. */
export function formatDMY(value: Date | string): string {
  const d = parseLocalDate(value);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/** Normalise a local phone to `country_code + number` (no '+'), matching the procs' CASE ladder. */
export function formatPhone(phone: string, countryCode: string): string {
  const p = phone.trim();
  if (p.startsWith(`+${countryCode}`)) return p.slice(1);
  if (p.startsWith(`00${countryCode}`)) return p.slice(2);
  if (p.startsWith(countryCode)) return p;
  if (p.startsWith('0')) return countryCode + p.slice(1);
  return countryCode + p;
}

/** The procs' phone validation: non-empty, digits/'+' only, at least one digit. */
export function isValidPhone(phone: string | null | undefined): phone is string {
  if (!phone) return false;
  const p = phone.trim();
  return p.length > 0 && /^[0-9+]+$/.test(p) && /[0-9]/.test(p);
}
