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
import {
  getCachedContacts,
  invalidateContactsCache,
  setCachedContacts,
} from './contacts-cache.js';

// The `auth` type People's typings expect; our OAuth2Client satisfies it structurally.
type GoogleAuthClient = Parameters<typeof people>[0] extends { auth?: infer A }
  ? NonNullable<A>
  : never;

/**
 * Prepared contact
 */
export interface PreparedContact {
  /**
   * Stable identity: the People `resourceName` plus the phone's index, NOT a running counter.
   * A loop counter shifts the moment anything upstream is added or removed, so anything that
   * persisted a selection by id pointed at a different person after the next fetch. (It also made
   * the FIRST contact's id `0`, which the client's `contact.id || contact.phone` treated as absent.)
   */
  id: string;
  text: string;
  phone: string;
}

/** Human label for a People phone type, e.g. 'mobile' → 'mobile', 'workMobile' → 'work mobile'. */
function phoneLabel(phone: people_v1.Schema$PhoneNumber): string {
  const raw = phone.formattedType || phone.type || '';
  return raw.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().trim();
}

/**
 * Flatten People results into the recipient list.
 *
 * One entry PER PHONE NUMBER, not per contact: taking only `phoneNumbers[0]` meant a contact stored
 * with both a mobile and a clinic landline appeared once, with whichever number Google happened to
 * order first — and no way to reach the other. Where a contact has several, the number's type is
 * appended to the label so the two are tellable apart in the dropdown.
 */
function prepareContacts(contacts: people_v1.Schema$Person[]): PreparedContact[] {
  const prepared: PreparedContact[] = [];

  for (const person of contacts) {
    const name = person.names?.[0]?.displayName;
    const phones = (person.phoneNumbers ?? []).filter((p) => p.value);
    if (!name || phones.length === 0) continue;

    const resource = person.resourceName ?? name;
    phones.forEach((phone, idx) => {
      const label = phones.length > 1 ? phoneLabel(phone) : '';
      prepared.push({
        id: `${resource}#${idx}`,
        text: label ? `${name} (${label})` : name,
        phone: phone.value!,
      });
    });
  }

  return prepared;
}

/**
 * Get contacts for one connected Google account.
 *
 * @param source - Account id from shared/google-contacts-accounts.ts (`shw`/`cli`)
 * @param refresh - Bypass the cache and re-crawl the account now
 * @throws GoogleContactsAuthError when that account isn't configured/connected
 */
export async function getContacts(source: string, refresh = false): Promise<PreparedContact[]> {
  const cached = refresh ? null : getCachedContacts(source);
  if (cached) {
    log.debug(`Serving ${cached.length} cached contacts for source: ${source}`);
    return cached;
  }

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
    log.info(`Processed ${preparedContacts.length} reachable numbers across the fetched contacts`);

    setCachedContacts(source, preparedContacts);
    return preparedContacts;
  } catch (error) {
    // A revoked/expired grant must clear itself, or the Settings card keeps
    // claiming "Connected" while every fetch fails.
    if (isInvalidGrantError(error)) {
      invalidateContactsCache(source);
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
