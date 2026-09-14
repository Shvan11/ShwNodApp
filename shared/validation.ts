/**
 * Shared Zod primitives for the request-validation boundary (used with
 * `validate({ body, params, query })`). Only the genuinely-reusable, easy-to-
 * get-wrong building blocks live here — the real-calendar date check and the
 * numeric-id/param helpers. Entity-specific body schemas stay inline in each
 * route module (the established convention; see work/photo-editor routes).
 *
 * Boundaries only — see CLAUDE.md (Zod = untrusted input crossing into the app).
 *
 * LOCATION: this file lives in `shared/` (project root) so it is importable by
 * BOTH the Express routes (relative `.js`) and the React bundle (`@shared`
 * alias). Every route imports it directly; the old
 * `middleware/validation-schemas.ts` re-export barrel had no importers left and
 * has been deleted.
 */
import { z } from 'zod';

/** Structural `YYYY-MM-DD` (right digit ranges, but allows e.g. Feb 30).
 *  Implementation detail of `dateString` below — not exported. */
const YMD_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** True iff `s` is a real calendar date — round-trips through a LOCAL Date (the
 *  app stores wall-clock dates, never UTC). Rejects 2024-02-30, 2025-04-31, etc. */
function isRealYmd(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
}

/** A required `YYYY-MM-DD` date string that must be a real calendar day. */
export const dateString = z
  .string()
  .regex(YMD_RE, 'Invalid date (expected YYYY-MM-DD)')
  .refine(isRealYmd, 'Not a real calendar date');

/**
 * An OPTIONAL date that tolerates the empty string. Many handlers treat `''`
 * (and absent) as "no date" (`body.x ? new Date(body.x) : undefined`), so we must
 * accept `''` rather than 400 it — while still rejecting junk / impossible dates.
 */
export const optionalDateString = z.union([z.literal(''), dateString]).optional();

/**
 * A numeric route-param VALUE (e.g. `:id`, `:workId`). Kept as a validated
 * STRING (not coerced) so the handler's existing `parseInt(req.params.x, 10)`
 * keeps working unchanged after the validate() write-back. Rejects non-numeric
 * and empty params with a 400 before the handler runs.
 */
export const numericParam = z.string().regex(/^\d+$/, 'Invalid id (expected a positive integer)');

/** Convenience: a params schema for a single `:id`-style segment. */
export const idParams = (name: string) => z.object({ [name]: numericParam });

/**
 * A body/JSON id field: coerces `"123"`→123, rejects NaN/negatives/floats.
 * (`.int()` rejects NaN because `Number.isInteger(NaN) === false`, so a junk
 * value like `"abc"` 400s rather than slipping through as NaN.)
 */
export const intId = z.coerce.number().int().positive();

/**
 * Minimum password length, and the schema that enforces it. The SSoT for every
 * password rule in the app — the user-management contracts, `POST
 * /api/auth/change-password`, the two React forms and the emergency reset script
 * (which runs under `tsx`, so it imports this directly) all read it, so the floor
 * moves in one place.
 *
 * 8, not the historical 6: this database holds PHI. Existing passwords are
 * unaffected — the floor is only checked when one is set or changed. No
 * complexity rules on purpose; they push people toward predictable
 * substitutions without adding real entropy.
 */
export const MIN_PASSWORD_LENGTH = 8;

export const passwordString = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);

/**
 * A MONEY amount crossing a request boundary.
 *
 * Every money column in the schema is `integer` — `expenses.amount`,
 * `invoices.amount_paid`/`usd_received`/`iqd_received`/`change`,
 * `works.total_required`/`discount`, `work_items.item_cost`,
 * `patients.estimated_cost`, `sms.exchange_rate` and the whole `stand_*` price
 * set. That is a deliberate IQD-first choice (the dinar has no minor unit in
 * daily use), but the contracts used to accept ANY number, so the two halves
 * disagreed and a fractional amount was resolved differently per route: the
 * expense + Stand-restock paths `parseInt`ed it and silently stored `12` for
 * `12.99`, while `PaymentService` passed `12.5` through to an `integer` column
 * and PG answered `22P02` → a 500. Rejecting it at the boundary is the one
 * place both halves can agree, and it is visible to the person typing it.
 *
 * NOTE: the two money columns that are genuinely `numeric` —
 * `estimated_cost_presets.amount` (18,2) and `aligner_sets.set_cost` (10,2) —
 * legitimately take decimals and must NOT use this.
 *
 * SIGN: non-negative is the DEFAULT, deliberately. The fractional guard above
 * originally shipped without one, and 6 of the 12 sites using it did not add a
 * sign check of their own — so `POST /api/addInvoice` accepted
 * `amountPaid: -100000`, which does not merely record a wrong number: a negative
 * invoice INCREASES the work's remaining balance and skews every report that sums
 * `invoices.amount_paid`, the doctor-commission figures included. No money field
 * in the schema legitimately takes a negative (a refund is not modeled as one),
 * so the safe answer is the default rather than something each site must remember.
 * Add `.positive()` on top wherever 0 is also meaningless (a payment, a fee);
 * `.nonnegative()` is already implied and needs no repeating.
 */
export const moneyInt = z.coerce
  .number()
  .int('Amount must be a whole number — fractional amounts are not supported')
  .nonnegative('Amount cannot be negative');

/**
 * Optional numeric QUERY param that tolerates the empty string. A query like
 * `?limit=` arrives as `''`; the handlers treat an absent/empty filter as "no
 * filter", so map `''`→undefined BEFORE coercion (otherwise `''` coerces to 0).
 * A junk value (`?limit=abc`) coerces to NaN and is rejected by `.int()` — the
 * exact H10 sub-issue (silent NaN filters). Use `.positive` for ids/limits
 * (1+) and `.nonneg` for offsets (0+).
 */
const emptyToUndef = (v: unknown) => (v === '' ? undefined : v);
// `.optional()` appears on BOTH the inner schema and the outer preprocess: the
// OUTER makes `z.object` treat the key as absent-able; the INNER lets the
// ''→undefined mapping resolve to a clean undefined instead of coercing to NaN.
export const optionalPositiveIntQuery = z
  .preprocess(emptyToUndef, z.coerce.number().int().positive().optional())
  .optional();
export const optionalNonNegIntQuery = z
  .preprocess(emptyToUndef, z.coerce.number().int().nonnegative().optional())
  .optional();

/**
 * RESPONSE-side primitive for a PG `timestamp` (WITHOUT time zone) column.
 *
 * Such a column is a `Date` on the SERVER (the `pg` parser returns `Date` for
 * `timestamp`), but a `string` on the CLIENT (it crossed JSON.stringify, which
 * calls `Date.prototype.toISOString`). The SAME contract `response` schema is
 * parsed at BOTH points — `sendData`'s dev-parse on the server (sees a `Date`)
 * and `fetchJSON({ schema })` on the client (sees a `string`) — so a plain
 * `z.string()` would throw server-side on the raw `Date`, and a plain `z.date()`
 * would throw client-side on the serialized string. This union accepts both.
 *
 * The `Date` branch `.transform`s to `toISOString()` — the exact same ISO string
 * `JSON.stringify` already produces in prod (where `sendData` skips the parse and
 * sends the raw `Date`), so dev and prod deliver an IDENTICAL wire value. Net
 * result: validates on both sides, and the inferred output type is **`string`**
 * (matching the hand-written frontend interfaces these columns feed).
 *
 * NOTE: this is the opposite of `date`-typed columns (e.g. `expiry_date`,
 * `date_of_payment`) — those are already `string` on BOTH sides (the codegen
 * `--date-parser string`), so model them as a plain `z.string()`, not this.
 */
export const timestampString = z.union([z.string(), z.date().transform((d) => d.toISOString())]);

/**
 * RESPONSE-side "is it an array" guard — `z.array(z.unknown())`. Flip-free (every
 * type is assignable to `unknown`), so it asserts the array CLASS while preserving the
 * payload, without forcing a query/route `interface`→`type` flip. Use for a response
 * whose ROW shape is intentionally long-tail/dynamic (a counted D2 marker — see the
 * allowlist note in CLAUDE.md). Centralized here (was duplicated as a local `const` in
 * several contracts) so the docs' "primitive lives in shared/validation.ts" claim holds.
 */
export const anyArray = z.array(z.unknown());
