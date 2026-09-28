/**
 * Client-side patient jump-list matching.
 *
 * One home for the name rule, because there are two widgets rendering a patient
 * jump list (`PatientSearchCombobox` and the older `PatientQuickSearch`) and
 * they had drifted into two copies of it. Both copies were also wrong in the
 * same way: a bare `String.startsWith`, which is case-SENSITIVE, over a server
 * whose text columns are `citext` (case-insensitive). Typing `ali` offered
 * nothing while pressing Enter found `Ali`.
 *
 * `prefixOnly` mirrors PatientManagement's "Match from beginning of name only"
 * checkbox — which defaults to OFF, i.e. substring, which is also what the
 * server does when `nameStartsWith` is absent. The jump list used to ignore that
 * checkbox entirely and always match a prefix, so with the box unchecked the
 * dropdown stayed empty while the results table below it filled with matches.
 *
 * Case folding is `toLocaleLowerCase()`-free on purpose: `toLowerCase()` is the
 * locale-independent fold, it is a no-op for Arabic (which is caseless), and it
 * matches what PG's `citext` does for the Latin range.
 */
export function matchesPatientName(
  name: string | null | undefined,
  input: string,
  prefixOnly: boolean
): boolean {
  if (!name) return false;
  const haystack = name.toLowerCase();
  const needle = input.toLowerCase();
  return prefixOnly ? haystack.startsWith(needle) : haystack.includes(needle);
}
