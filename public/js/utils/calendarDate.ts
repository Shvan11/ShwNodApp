/**
 * Calendar date helpers.
 *
 * A bare `new Date('YYYY-MM-DD')` parses as UTC midnight, which shifts the
 * calendar day backward in any timezone west of UTC; anchoring at local noon
 * keeps the wall-clock day correct everywhere the week/day math reads
 * getDate()/getDay()/getMonth(). Masked in prod by the single UTC+3 clinic
 * timezone, but a real bug on a negative-offset host — so parse date-only
 * strings through here, never `new Date(dateOnlyString)` directly.
 *
 * Pass-through for values already a Date (and for non date-only strings, e.g.
 * full timestamps, which `new Date()` parses as local already).
 */
export function parseLocalDate(value: Date | string): Date {
    if (value instanceof Date) return value;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
    return new Date(value);
}

/** Format a Date as a local 'YYYY-MM-DD' (no UTC shift). */
export function toLocalDateString(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * Saturday that starts the working week containing `date` (week = Sat–Thu).
 * Mirrors getWeekStart in routes/calendar.ts.
 */
export function getWeekStartSaturday(date: Date | string): Date {
    const start = parseLocalDate(date instanceof Date ? date : date);
    const d = new Date(start);
    const day = d.getDay();            // Sun=0 … Sat=6
    const diff = day === 6 ? 0 : day + 1; // back up to Saturday
    d.setDate(d.getDate() - diff);
    d.setHours(0, 0, 0, 0);
    return d;
}

/**
 * Advance `count` WORKING days from a 'YYYY-MM-DD' string, skipping Fridays
 * (clinic closed — matches the SQL `EXTRACT(DOW) <> 5` filter). count=0 returns
 * the same day (nudged off a Friday if it lands on one). Negative counts page
 * backward. Returns a 'YYYY-MM-DD' string.
 */
export function addWorkingDays(dateStr: string, count: number): string {
    const d = parseLocalDate(dateStr);
    const step = count < 0 ? -1 : 1;
    // Normalise off a Friday start so a working-day count is well-defined.
    if (d.getDay() === 5) d.setDate(d.getDate() + step);
    let remaining = Math.abs(count);
    while (remaining > 0) {
        d.setDate(d.getDate() + step);
        if (d.getDay() !== 5) remaining--;
    }
    return toLocalDateString(d);
}
