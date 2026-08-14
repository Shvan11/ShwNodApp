/**
 * Google Contacts (People API) — the message-recipient phone book behind
 * `GET /api/google?source=`, feeding the recipient dropdowns in SendMessage and
 * TelegramShareModal.
 *
 * Authorization lives entirely in ./oauth.ts (DB-persisted grants, one per Google
 * account, connected from Settings → Integrations). This module only reads.
 */
import { people, people_v1 } from '@googleapis/people';
import type { OAuth2Client } from 'google-auth-library';
import { log } from '../../utils/logger.js';
import {
  getAuthorizedClient,
  handleInvalidGrant,
  isInvalidGrantError,
  GoogleContactsAuthError,
} from './oauth.js';

// The `auth` type People's typings expect; our OAuth2Client satisfies it structurally.
type GoogleAuthClient = Parameters<typeof people>[0] extends { auth?: infer A }
  ? NonNullable<A>
  : never;

/**
 * Prepared contact
 */
export interface PreparedContact {
  id: number;
  text: string;
  phone: string;
}

/**
 * Process contacts into a more usable format
 * @param contacts - Raw contacts from Google API
 * @returns Processed contacts
 */
function prepareContacts(contacts: people_v1.Schema$Person[]): PreparedContact[] {
  const preparedContacts: PreparedContact[] = [];
  let i = 0;

  contacts.forEach((person) => {
    if (
      person.names &&
      person.names.length > 0 &&
      person.phoneNumbers &&
      person.phoneNumbers.length > 0
    ) {
      preparedContacts.push({
        id: i,
        text: person.names[0].displayName || '',
        phone: person.phoneNumbers[0].value || '',
      });
      i++;
    }
  });

  return preparedContacts;
}

/**
 * Get contacts for one connected Google account.
 *
 * @param source - Account id from shared/google-contacts-accounts.ts (`shw`/`cli`)
 * @throws GoogleContactsAuthError when that account isn't configured/connected
 */
export async function getContacts(source: string): Promise<PreparedContact[]> {
  log.info(`Fetching contacts using source: ${source}`);

  const client: OAuth2Client = await getAuthorizedClient(source);
  const service = people({ version: 'v1', auth: client as GoogleAuthClient });

  try {
    let connections: people_v1.Schema$Person[] = [];
    let nextPageToken: string | null | undefined = undefined;

    // Fetch all contacts with pagination
    do {
      const res: { data: people_v1.Schema$ListConnectionsResponse } =
        await service.people.connections.list({
          resourceName: 'people/me',
          pageSize: 1000,
          pageToken: nextPageToken || undefined,
          personFields: 'names,emailAddresses,phoneNumbers',
        });

      if (res.data.connections) {
        log.debug(`Fetched ${res.data.connections.length} contacts in this page`);
        connections = connections.concat(res.data.connections);
      }

      nextPageToken = res.data.nextPageToken;
    } while (nextPageToken);

    log.info(`Total contacts fetched: ${connections.length}`);

    const preparedContacts = prepareContacts(connections);
    log.info(`Processed ${preparedContacts.length} valid contacts with names and phone numbers`);

    return preparedContacts;
  } catch (error) {
    // A revoked/expired grant must clear itself, or the Settings card keeps
    // claiming "Connected" while every fetch fails.
    if (isInvalidGrantError(error)) {
      await handleInvalidGrant(source);
      throw new GoogleContactsAuthError(
        'not_connected',
        'The Google authorization for this account has expired or been revoked. Reconnect it in Settings → Integrations.'
      );
    }
    log.error('Error fetching contacts', { source, error: (error as Error).message });
    throw error;
  }
}
