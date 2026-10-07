import { PATIENT_LOOKUP } from '@shared/patient-lookup';
import { canLookUp, patientLookupModeFor, uniquePatients } from '@/utils/patientSearch';
import { usePatientLookup } from './usePatientLookup';

/** A patient a message can be sent to. */
export interface PatientContact {
  id: number;
  name: string;
  phone: string;
}

/** How many of each kind a recipient picker lists; a dropdown scrolls, a jump list does not. */
const PICKER_LIMIT = 20;

export interface PatientContactsResult {
  /** The patients matching what is typed, each with the number to send to. */
  contacts: PatientContact[];
  isLoading: boolean;
  /** Nothing is listed because nothing (or too little) has been typed yet. */
  needsInput: boolean;
  isError: boolean;
  error: unknown;
}

/**
 * The "Patients' Phones" source of a message-recipient picker (Send Message, the
 * Telegram share dialog).
 *
 * The picker used to be handed every patient with a phone number and filter them
 * itself. It now shows what the server finds for the text in its search box: a
 * name, or — when the text starts with a digit — a phone number or patient ID.
 * Only patients who have a number are offered, and a patient found by their
 * second number is offered with that one.
 */
export function usePatientContacts(searchText: string, enabled: boolean): PatientContactsResult {
  const lookup = usePatientLookup(searchText, {
    by: 'auto',
    requirePhone: true,
    limit: PICKER_LIMIT,
    enabled,
  });
  const typed = searchText.trim();
  const contacts = uniquePatients(lookup.matches).flatMap((m) =>
    m.phone ? [{ id: m.id, name: m.name, phone: m.phone }] : []
  );
  return {
    contacts,
    isLoading: lookup.isSearching,
    needsInput: !canLookUp(typed, patientLookupModeFor(typed)),
    isError: lookup.isError,
    error: lookup.error,
  };
}

/** What an empty picker says while `needsInput`. */
export const PATIENT_CONTACTS_PROMPT = `Type a name (${PATIENT_LOOKUP.nameMinChars}+ letters), a phone number or a patient ID`;
