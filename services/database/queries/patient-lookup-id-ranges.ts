/**
 * "Every patient ID that starts with these digits", as ranges on the primary key.
 *
 * `person_id::text LIKE '45%'` reads the whole table: the cast hides the column
 * from its index. The same set is 45, 450–459, 4500–4599, … — one index range per
 * extra digit, ten at most for an `integer`. Ascending, so the ranges in order are
 * the IDs in order: the exact ID first, then the shortest that extend it.
 *
 * Import-free (no database), so its test runs anywhere.
 */

/** Largest value of the PostgreSQL `integer` that `patients.person_id` is. */
const INT4_MAX = 2_147_483_647;

export type IdRange = [lo: number, hi: number];

export function idPrefixRanges(digits: string): IdRange[] {
  // No ID has a leading zero, and anything but digits is not the start of one.
  if (!/^[1-9]\d*$/.test(digits)) return [];
  const prefix = Number(digits);
  const ranges: IdRange[] = [];
  for (let scale = 1; prefix * scale <= INT4_MAX; scale *= 10) {
    ranges.push([prefix * scale, Math.min(prefix * scale + scale - 1, INT4_MAX)]);
  }
  return ranges;
}
