/**
 * The currencies a WORK can be denominated in — and so the currencies the money ledger can hold.
 * Imported by BOTH sides: the work contract (`z.enum`), `WorkService` (the configured default) and
 * the work form (its `<select>` and its default).
 *
 * WHY ONLY TWO. The ledger is USD/IQD and nothing else: `invoices` has `usd_received` and
 * `iqd_received` columns only, `PaymentModal` branches on `'USD'`/`'IQD'`, and statistics and
 * commissions separate exactly those two. The work form used to offer EUR as well, which no money
 * path supported — "Mark as fully paid" booked euros into the dollar cash box, and a EUR account
 * fell into PaymentModal's IQD arms (frontend audit FE-F7-5). EUR stays available on the patient's
 * *estimate* and on cost presets, which are display-only and never reach the ledger. Adding a
 * currency here is therefore NOT a one-line change: it needs an invoice column, PaymentModal arms,
 * a statistics split and an exchange rate first.
 *
 * THE DEFAULT IS CONFIGURATION. A new work used to start at a hardcoded 'USD' while 79 % of this
 * clinic's works are IQD, and a "switch to IQD above 10,000" keystroke heuristic papered over it —
 * which silently re-denominated a $2,000 work as 2,000 IQD while its total was being edited
 * (FE-F7-3). This is a multi-deployment product, so the default is a per-clinic option row
 * (Settings → General), seeded from the clinic's own works; an unset or unrecognised value means
 * "no default — staff choose on every work", never a guessed currency.
 */

export const WORK_CURRENCIES = ['IQD', 'USD'] as const;

export type WorkCurrency = (typeof WORK_CURRENCIES)[number];

/** `options.option_name` of the clinic's default work currency (Settings → General). */
export const DEFAULT_WORK_CURRENCY_OPTION = 'DEFAULT_WORK_CURRENCY';

/**
 * A stored or submitted value → a ledger currency, or `null` when it is not one. Tolerates case
 * and surrounding whitespace (the options row is free text in the generic settings list, and the
 * DB column is `citext`), but never guesses: anything else is `null`, i.e. "not set".
 */
export function parseWorkCurrency(value: unknown): WorkCurrency | null {
  if (typeof value !== 'string') return null;
  const upper = value.trim().toUpperCase();
  return (WORK_CURRENCIES as readonly string[]).includes(upper) ? (upper as WorkCurrency) : null;
}
