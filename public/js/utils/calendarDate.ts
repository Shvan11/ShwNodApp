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
