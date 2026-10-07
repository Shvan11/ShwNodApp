/**
 * The patient typeahead's rules, as the browser needs them.
 *
 * The matching itself is the server's (`GET /api/patients/lookup`,
 * services/database/queries/patient-lookup-queries.ts): the browser no longer
 * holds the patient list. What stays here is the same rule in JavaScript, for the
 * one moment the server cannot cover — between a keystroke and its answer. The
 * rows on screen then belong to the PREVIOUS text, and `matchesLookup` drops the
 * ones the new text rules out, so a row is never shown (or picked with Enter)
 * that does not match what is in the box.
 *
 * So these must agree with the SQL. A rule changed there changes here.
 *
 * One home for the name rule, as before. There used to be two widgets rendering a
 * patient jump list (`PatientSearchCombobox` and the older `PatientQuickSearch`,
 * retired by audit FE-F4-13) with a drifted copy each, and both copies were wrong
 * in the same way: a bare `String.startsWith`, which is case-SENSITIVE, over a
 * server whose text columns are `citext` (case-insensitive). Typing `ali` offered
 * nothing while pressing Enter found `Ali`.
 */
import { PATIENT_LOOKUP, type PatientLookupBy } from '@shared/patient-lookup';
import type { PatientLookupMatch } from '@shared/contracts/patient.contract';

/**
 * Does this name match the typed text?
 *
 * `prefixOnly` mirrors PatientManagement's "Match from beginning of name only"
 * checkbox — which defaults to OFF, i.e. substring, which is also what the server
 * does when `nameStartsWith` is absent.
 *
 * Case folding is `toLocaleLowerCase()`-free on purpose: `toLowerCase()` is the
 * locale-independent fold, it is a no-op for Arabic (which is caseless), and it
 * matches what PG's `lower()` does for the Latin range.
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

/**
 * A box that takes a name, a phone number or an ID decides by the first
 * character: a digit means phone/ID. (No patient's name starts with one.)
 */
export function patientLookupModeFor(text: string): PatientLookupBy {
  return /^\s*\d/.test(text) ? 'phoneId' : 'name';
}

/** Is the text long enough to be looked up at all? `text` is already trimmed. */
export function canLookUp(text: string, by: PatientLookupBy): boolean {
  return text.length >= (by === 'name' ? PATIENT_LOOKUP.nameMinChars : PATIENT_LOOKUP.idMinChars);
}

/**
 * Would the server still return this row for `text`? `text` is already trimmed.
 *
 *  - name   the name contains the text (starts with it, under `nameStartsWith`)
 *  - id     the ID starts with the digits
 *  - phone  the row's number contains the text, from the second character
 */
export function matchesLookup(
  match: PatientLookupMatch,
  text: string,
  by: PatientLookupBy,
  nameStartsWith: boolean
): boolean {
  if (!canLookUp(text, by)) return false;
  if (by === 'name') {
    return match.group === 'name' && matchesPatientName(match.name, text, nameStartsWith);
  }
  if (match.group === 'id') {
    return /^[1-9]\d*$/.test(text) && String(match.id).startsWith(text);
  }
  if (match.group === 'phone') {
    return text.length >= PATIENT_LOOKUP.phoneMinChars && !!match.phone?.includes(text);
  }
  return false;
}

/**
 * One row per patient, first occurrence kept. A phone/ID search lists a patient
 * twice when both the ID and a phone number match; a picker that shows a plain
 * list (not the two groups) wants them once.
 */
export function uniquePatients<T extends { id: number }>(matches: readonly T[]): T[] {
  const seen = new Set<number>();
  return matches.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
}
