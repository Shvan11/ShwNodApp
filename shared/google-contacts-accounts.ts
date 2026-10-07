/**
 * Google Contacts account registry — cross-boundary SSoT for the Google accounts
 * the clinic pulls its contact phone book from.
 *
 * The staff app offers these as message-recipient "sources" alongside the patient
 * phone book (`pat`) and employees (`emp`); each is a SEPARATE Google account with
 * its own OAuth grant, connected individually from Settings → Integrations.
 *
 * Imported by both sides — Express via a relative `.js`, React via `@shared`. The
 * ids double as the `?source=` query value on `GET /api/google` and as the suffix
 * of the `integration_oauth_tokens.provider` key (`google_contacts:<id>`), so
 * renaming one orphans its stored grant.
 */

export interface GoogleContactAccount {
  /** Stable id — the `?source=` value and the token-store provider suffix. */
  id: string;
  /** Human label shown in the recipient-source dropdowns and the Settings card. */
  label: string;
}

// The ids are historical (`shw` was the original clinic's doctor) and stay: a grant is
// stored under its id. The LABELS are what staff read, so they name the slot's role,
// never a person: `shw` read "Dr. Shwan Phone" on every install. Which Google account
// a slot is connected to shows on its Settings card (`account_email`).
export const GOOGLE_CONTACT_ACCOUNTS: readonly GoogleContactAccount[] = [
  { id: 'shw', label: "Doctor's Phone" },
  { id: 'cli', label: 'Clinic Phone' },
] as const;

/** Is this string one of the registered account ids? */
export function isGoogleContactAccountId(value: string): boolean {
  return GOOGLE_CONTACT_ACCOUNTS.some((a) => a.id === value);
}

/** Label for an account id, falling back to the raw id for an unknown one. */
export function googleContactAccountLabel(id: string): string {
  return GOOGLE_CONTACT_ACCOUNTS.find((a) => a.id === id)?.label ?? id;
}
