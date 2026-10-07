/**
 * The patient typeahead's limits — `GET /api/patients/lookup`.
 *
 * Shared because both sides enforce them: the server returns nothing below a
 * minimum, and the client does not ask (nor show a row) below it. Import-free on
 * purpose, so a test on either side can read it without a database.
 */
export const PATIENT_LOOKUP = {
  /** A name is searched from this many characters. */
  nameMinChars: 2,
  /** A patient ID is searched from the first digit. */
  idMinChars: 1,
  /** A phone number is searched from this many characters. */
  phoneMinChars: 2,
  /** Rows a name search returns unless the caller asks for another number. */
  nameLimit: 8,
  /** Rows EACH group of a phone/ID search returns (IDs, then phones) unless asked. */
  groupLimit: 4,
  /** The most rows a caller may ask for, per group. */
  maxLimit: 25,
  /** Longest search text accepted. */
  maxQueryLength: 100,
} as const;

/** What the text is matched against: the name, or the phone numbers and the ID. */
export type PatientLookupBy = 'name' | 'phoneId';

/** Which rule matched a row. A phone/ID search returns its `id` rows before its `phone` rows. */
export type PatientLookupGroup = 'name' | 'id' | 'phone';
