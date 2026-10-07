import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { PatientLookupBy } from '@shared/patient-lookup';
import type { PatientLookupMatch } from '@shared/contracts/patient.contract';
import { patientLookupQuery } from '@/query/queries';
import { canLookUp, matchesLookup, patientLookupModeFor } from '@/utils/patientSearch';
import { useDebouncedValue } from './useDebouncedValue';

/**
 * How long typing must pause before the server is asked. Short on purpose: an
 * answer costs the server about a millisecond and a superseded request is
 * aborted, so the wait is only there to skip the letters of a word in flight.
 */
const PATIENT_LOOKUP_DEBOUNCE_MS = 120;

export interface PatientLookupOptions {
  /**
   * What the text is matched against. `'auto'` is for a box that takes anything:
   * text starting with a digit is a phone number or an ID, anything else a name.
   */
  by: PatientLookupBy | 'auto';
  /** Names that START with the text only. */
  nameStartsWith?: boolean;
  /** Only patients with a phone number. */
  requirePhone?: boolean;
  /** A patient to leave out. */
  exclude?: number;
  /** Rows per group; the server's defaults when absent. */
  limit?: number;
  /** `false` asks nothing and returns no rows (a closed list, a picker on another source). */
  enabled?: boolean;
}

export interface PatientLookupResult {
  /** The rows to show for `text` AS IT IS NOW, best first. */
  matches: PatientLookupMatch[];
  /** An answer for the current text is on its way. */
  isSearching: boolean;
  isError: boolean;
  error: unknown;
}

/**
 * The patient typeahead: the server's few best matches for `text`, kept in step
 * with it as it is typed.
 *
 * It replaced filtering the whole patient list in the browser. That was instant
 * and this must feel so, which takes three things:
 *  - the request follows the pauses in typing, and React Query aborts the one it
 *    supersedes (the factory passes its `signal`);
 *  - the previous answer stays on screen until the next arrives, so the list does
 *    not blink shut on every letter;
 *  - while it does, the rows the new text rules out are dropped at once
 *    (`matchesLookup`). What is listed always matches what is typed, so Enter can
 *    never open a patient the text no longer names.
 */
export function usePatientLookup(text: string, options: PatientLookupOptions): PatientLookupResult {
  const { by, nameStartsWith = false, requirePhone = false, exclude, limit, enabled = true } = options;

  const typed = text.trim();
  const asked = useDebouncedValue(typed, PATIENT_LOOKUP_DEBOUNCE_MS);
  // Each text picks its own mode, so a request never pairs one text with the
  // other's mode during the pause.
  const typedBy = by === 'auto' ? patientLookupModeFor(typed) : by;
  const askedBy = by === 'auto' ? patientLookupModeFor(asked) : by;

  const wanted = enabled && canLookUp(typed, typedBy);
  const query = useQuery({
    ...patientLookupQuery({ q: asked, by: askedBy, nameStartsWith, requirePhone, exclude, limit }),
    enabled: enabled && canLookUp(asked, askedBy),
    placeholderData: keepPreviousData,
  });

  const matches = wanted
    ? (query.data ?? []).filter((m) => matchesLookup(m, typed, typedBy, nameStartsWith))
    : [];

  return {
    matches,
    isSearching: wanted && (typed !== asked || query.isFetching),
    isError: wanted && query.isError,
    error: wanted ? query.error : null,
  };
}
