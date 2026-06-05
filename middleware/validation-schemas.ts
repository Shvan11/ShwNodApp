/**
 * Shared Zod primitives for the request-validation boundary (used with
 * `validate({ body, params, query })`). Only the genuinely-reusable, easy-to-
 * get-wrong building blocks live here — the real-calendar date check and the
 * numeric-id/param helpers. Entity-specific body schemas stay inline in each
 * route module (the established convention; see work/photo-editor routes).
 *
 * Boundaries only — see CLAUDE.md (Zod = untrusted input crossing into the app).
 */
import { z } from 'zod';

/** Structural `YYYY-MM-DD` (right digit ranges, but allows e.g. Feb 30). */
export const YMD_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** True iff `s` is a real calendar date — round-trips through a LOCAL Date (the
 *  app stores wall-clock dates, never UTC). Rejects 2024-02-30, 2025-04-31, etc. */
export function isRealYmd(s: string): boolean {
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

/** A non-negative integer (ids that may legitimately be 0, counts, codes). */
export const nonNegInt = z.coerce.number().int().nonnegative();

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
