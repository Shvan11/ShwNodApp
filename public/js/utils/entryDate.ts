/**
 * Sanity check for a money entry's date (payments, expenses).
 *
 * Nothing bounded these dates, and a date input commits on every year keystroke,
 * so a slipped digit (2062) or a half-typed year (0202) saved silently. Such an
 * entry still counts toward a work's Paid total but falls outside every daily and
 * statistics period, today's cash count included (audit FE-F8-9). A future or
 * long-past date is not always wrong (a late-recorded payment, a prepaid bill),
 * so the forms ASK rather than refuse; `ENTRY_DATE_MIN` is the one hard floor.
 */

/** Earliest date any money form accepts (the input's `min`). No clinic ledger predates it. */
export const ENTRY_DATE_MIN = '2000-01-01';

export type UnusualEntryDate = 'future' | 'old' | null;

/** `'future'` after today, `'old'` more than a year before today, else `null`. Dates are `YYYY-MM-DD`. */
export function unusualEntryDate(date: string, today: string): UnusualEntryDate {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
    if (date > today) return 'future';
    const yearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
    return date < yearAgo ? 'old' : null;
}
