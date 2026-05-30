/**
 * Arabic weekday name for appointment-reminder messages.
 *
 * Phase-5 TypeScript replacement for the SQL Server scalar function `dbo.ArabicDay`
 * (init_script.sql). The proc messages (GetNewAppointmentMessage / GetWhatsAppMessagesToSend /
 * ProcSMS) embedded `dbo.ArabicDay(@AppDate)`; those procs now build their strings in TS.
 *
 * The original used `DATEPART(weekday, @date)` under the default DATEFIRST=7 (Sunday=1 … Saturday=7)
 * and intentionally returned NULL for Friday (clinic closed) — preserved here as ''.
 */

// Indexed by JS Date#getDay(): 0=Sunday … 6=Saturday. Friday ('') matches the proc's NULL.
const ARABIC_DAYS: readonly string[] = [
  'ألاحد',    // 0 Sunday
  'ألاثنين',  // 1 Monday
  'ألثلاثاء', // 2 Tuesday
  'ألاربعاء', // 3 Wednesday
  'ألخميس',   // 4 Thursday
  '',          // 5 Friday — clinic closed (proc returned NULL)
  'ألسبت',    // 6 Saturday
];

/**
 * @param value `YYYY-MM-DD` string (date-only columns arrive as strings), a Date, or null.
 * @returns the Arabic weekday name, or '' for Friday / invalid input (mirrors the proc's NULL).
 */
export function arabicDay(value: Date | string | null | undefined): string {
  if (!value) return '';
  // Parse a bare YYYY-MM-DD as local midnight (avoids the UTC-parse day-shift `new Date('2026-01-01')` causes).
  const d =
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T00:00:00`)
      : value instanceof Date
        ? value
        : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return ARABIC_DAYS[d.getDay()] ?? '';
}
