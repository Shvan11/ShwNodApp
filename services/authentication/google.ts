/**
 * Google Contacts API Service
 * Provides authentication and operations for Google Contacts
 */
import { promises as fs, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { cwd } from 'process';
import { authenticate } from '@google-cloud/local-auth';
import { google, people_v1 } from 'googleapis';
import { log } from '../../utils/logger.js';

// Import OAuth2Client type for authenticate() return type
import type { OAuth2Client } from 'google-auth-library';

// The actual return type of google.auth.fromJSON
type JSONClient = ReturnType<typeof google.auth.fromJSON>;

// Union type for all auth clients we use
type AuthClient = JSONClient | OAuth2Client;

// Auth client type for google.people() - use the actual type expected
type GoogleAuthClient = Parameters<typeof google.people>[0] extends { auth?: infer A } ? NonNullable<A> : never;

// ===========================================
// TYPES
// ===========================================

/**
 * Prepared contact
 */
export interface PreparedContact {
  id: number;
  text: string;
  phone: string;
}

/**
 * Contact data for adding
 */
export interface ContactData {
  name: string;
  phone: string;
}

/**
 * Token data stored in file
 */
interface TokenData {
  type?: string;
  client_id?: string;
  client_secret?: string;
  refresh_token?: string;
  access_token?: string;
  expiry_date?: number;
  token_type?: string;
  scope?: string;
}

/**
 * Credentials file structure
 */
interface CredentialsFile {
  installed?: {
    client_id: string;
    client_secret: string;
  };
  web?: {
    client_id: string;
    client_secret: string;
  };
}

/**
 * Client with credentials
 */
interface ClientWithCredentials {
  credentials: {
    access_token?: string | null;
    refresh_token?: string | null;
    expiry_date?: number | null;
  };
}

// ===========================================
// CONSTANTS
// ===========================================

// If modifying these scopes, delete token.json
const SCOPES = ['https://www.googleapis.com/auth/contacts'];
const CREDENTIALS_PATH = join(cwd(), 'credentials.json');
const TOKEN_DIR = join(cwd(), 'tokens');

// Ensure tokens directory exists
if (!existsSync(TOKEN_DIR)) {
  mkdirSync(TOKEN_DIR, { recursive: true });
}

// ===========================================
// HELPER FUNCTIONS
// ===========================================

/**
 * Check if client has refreshAccessToken method
 */
function hasRefreshMethod(client: unknown): client is { refreshAccessToken(): Promise<{ credentials: ClientWithCredentials['credentials'] }>; setCredentials(creds: ClientWithCredentials['credentials']): void } {
  return client !== null &&
         typeof client === 'object' &&
         'refreshAccessToken' in client &&
         typeof (client as Record<string, unknown>).refreshAccessToken === 'function';
}

/**
 * Check if client has credentials
 */
function hasCredentials(client: unknown): client is ClientWithCredentials {
  return client !== null &&
         typeof client === 'object' &&
         'credentials' in client &&
         typeof (client as Record<string, unknown>).credentials === 'object';
}

/**
 * Reads previously authorized credentials from the save file.
 * @param tokenPath - Path to the token file
 * @returns Client or null
 */
async function loadSavedCredentialsIfExist(tokenPath: string): Promise<AuthClient | null> {
  try {
    const content = await fs.readFile(tokenPath, 'utf-8');
    const credentials = JSON.parse(content) as TokenData;
    const client = google.auth.fromJSON(credentials);
    return client;
  } catch (err) {
    log.debug(`No existing token found at ${tokenPath} or error reading it`, {
      error: (err as Error).message
    });
    return null;
  }
}

/**
 * Refresh OAuth2 access token and update stored credentials
 * @param oauth2Client - The OAuth2 client
 * @param tokenPath - Path to the token file
 */
async function refreshAccessToken(oauth2Client: AuthClient, tokenPath: string): Promise<void> {
  try {
    log.info('Refreshing access token...');

    if (!hasRefreshMethod(oauth2Client)) {
      log.info('Client does not support token refresh');
      return;
    }

    const tokens = await oauth2Client.refreshAccessToken();
    oauth2Client.setCredentials(tokens.credentials);

    // Read existing token data to preserve any other fields
    let existingData: TokenData = {};
    try {
      const content = await fs.readFile(tokenPath, 'utf-8');
      existingData = JSON.parse(content);
    } catch {
      // If file doesn't exist or can't be parsed, use empty object
    }

    // Update with new token info
    const updatedData: TokenData = {
      ...existingData,
      access_token: tokens.credentials.access_token || undefined,
      refresh_token: tokens.credentials.refresh_token || existingData.refresh_token,
      expiry_date: tokens.credentials.expiry_date || undefined,
    };

    // Write updated token data back to file
    await fs.writeFile(tokenPath, JSON.stringify(updatedData, null, 2));
    log.info('Token refreshed and saved');
  } catch (error) {
    log.error('Error refreshing access token', { error: (error as Error).message });
    throw error;
  }
}

/**
 * Serializes credentials to a file compatible with GoogleAuth.fromJSON.
 * @param client - The authenticated client
 * @param tokenPath - Path to the token file
 */
async function saveCredentials(client: AuthClient, tokenPath: string): Promise<void> {
  try {
    const content = await fs.readFile(CREDENTIALS_PATH, 'utf-8');
    const keys: CredentialsFile = JSON.parse(content);
    const key = keys.installed || keys.web;
    if (!key) {
      throw new Error('No credentials found in credentials.json');
    }

    let refreshToken: string | undefined;
    if (hasCredentials(client)) {
      refreshToken = client.credentials.refresh_token || undefined;
    }

    const payload = JSON.stringify({
      type: 'authorized_user',
      client_id: key.client_id,
      client_secret: key.client_secret,
      refresh_token: refreshToken,
    });
    await fs.writeFile(tokenPath, payload);
    log.info(`Credentials saved to ${tokenPath}`);
  } catch (error) {
    log.error('Error saving credentials', { error: (error as Error).message });
    throw error;
  }
}

/**
 * Get OAuth2 client for Google API authorization
 * @param source - Identifier for the token file
 * @returns OAuth2Client
 */
async function authorize(source: string): Promise<AuthClient> {
  const tokenPath = join(TOKEN_DIR, `${source}_token.json`);

  log.info(`Attempting to authorize using token from ${tokenPath}`);
  let client = await loadSavedCredentialsIfExist(tokenPath);

  if (client) {
    try {
      // Check if token needs refresh
      if (hasCredentials(client)) {
        const credentials = client.credentials;
        if (credentials.expiry_date && credentials.expiry_date < Date.now()) {
          await refreshAccessToken(client, tokenPath);
        }
      }
      log.info('Authorization successful using saved credentials');
      return client;
    } catch (error) {
      log.warn('Error with saved credentials, will try fresh authentication', {
        error: (error as Error).message
      });
    }
  }

  log.info('No valid saved credentials, proceeding with new authentication');
  try {
    const authenticatedClient = await authenticate({
      scopes: SCOPES,
      keyfilePath: CREDENTIALS_PATH,
    });

    // authenticate() returns OAuth2Client which is compatible with our AuthClient union
    client = authenticatedClient;

    log.info('New authentication successful');

    if (hasCredentials(client) && client.credentials) {
      await saveCredentials(client, tokenPath);
    }

    return client;
  } catch (error) {
    log.error('Authentication failed', { error: (error as Error).message });
    throw error;
  }
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
 * Create a Google contact group
 * @param auth - OAuth2 client
 * @param group - Group name
 * @returns Resource name of created group
 */
async function createGroup(auth: GoogleAuthClient, group: string): Promise<string> {
  try {
    const service = google.people({ version: 'v1', auth });

    log.info(`Creating group "${group}"...`);
    const res = await service.contactGroups.create({
      requestBody: {
        contactGroup: {
          name: group,
        },
      },
    });

    const addedGroup = res.data;

    // Handle case where group already exists (status 409)
    if (res.status === 409) {
      log.info(`Group "${group}" already exists, fetching existing group...`);
      const res0 = await service.contactGroups.list({
        pageSize: 1000,
      });

      const groups = res0.data.contactGroups;
      if (groups) {
        for (const receivedGroup of groups) {
          if (receivedGroup.name === group) {
            log.info(`Found existing group: ${receivedGroup.resourceName}`);
            return receivedGroup.resourceName || '';
          }
        }
      }
    }

    log.info(`Group created: ${addedGroup.resourceName}`);
    return addedGroup.resourceName || '';
  } catch (error) {
    log.error(`Error creating group "${group}"`, { error: (error as Error).message });
    throw error;
  }
}

/**
 * Add a person to Google contacts
 * @param auth - OAuth2 client
 * @param contact - Contact info
 * @param resourceName - Optional group resource name
 * @returns Added person data
 */
async function addPerson(
  auth: GoogleAuthClient,
  contact: ContactData,
  resourceName?: string
): Promise<people_v1.Schema$Person> {
  try {
    const service = google.people({ version: 'v1', auth });

    log.info(`Adding contact: ${contact.name} (${contact.phone})`);

    const requestBody: people_v1.Schema$Person = {
      names: [
        {
          givenName: contact.name,
        },
      ],
      phoneNumbers: [
        {
          value: contact.phone,
        },
      ],
    };

    // Add group membership if provided
    if (resourceName) {
      requestBody.memberships = [
        {
          contactGroupMembership: {
            contactGroupResourceName: resourceName,
          },
        },
      ];
    }

    const res = await service.people.createContact({
      requestBody,
    });

    log.info(`Contact added: ${res.data.resourceName}`);
    return res.data;
  } catch (error) {
    log.error(`Error adding contact ${contact.name}`, { error: (error as Error).message });
    throw error;
  }
}

// ===========================================
// EXPORTED FUNCTIONS
// ===========================================

/**
 * Get contacts from Google
 * @param source - Source identifier for token
 * @returns Array of contacts
 */
export async function getContacts(source: string): Promise<PreparedContact[]> {
  log.info(`Fetching contacts using source: ${source}`);
  try {
    const client = await authorize(source);

    const service = google.people({ version: 'v1', auth: client as GoogleAuthClient });
    let connections: people_v1.Schema$Person[] = [];
    let nextPageToken: string | null | undefined = undefined;

    log.info('Fetching contacts with pagination...');

    // Fetch all contacts with pagination
    do {
      const res: { data: people_v1.Schema$ListConnectionsResponse } = await service.people.connections.list({
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
    log.error('Error fetching contacts', { error: (error as Error).message });
    throw error;
  }
}

/**
 * Add a single contact to Google
 * @param source - Source identifier for token
 * @param person - Contact info
 * @returns Added contact
 */
export async function addContact(
  source: string,
  person: ContactData
): Promise<people_v1.Schema$Person> {
  log.info(`Adding contact using source: ${source}`);
  try {
    const client = await authorize(source);
    const addedPerson = await addPerson(client as GoogleAuthClient, person);
    return addedPerson;
  } catch (error) {
    log.error('Error adding contact', { error: (error as Error).message });
    throw error;
  }
}

/**
 * Add multiple contacts to Google
 * @param source - Source identifier for token
 * @param persons - Array of contacts
 * @param group - Group name
 * @returns Added contacts
 */
export async function addContacts(
  source: string,
  persons: ContactData[],
  group: string
): Promise<people_v1.Schema$Person[]> {
  log.info(`Adding ${persons.length} contacts using source: ${source}`);
  try {
    const client = await authorize(source);
    let resourceName: string | undefined;

    // Create or get group if specified
    if (group) {
      log.info(`Using group: ${group}_Appointments`);
      resourceName = await createGroup(client as GoogleAuthClient, group + '_Appointments');
    }

    // Add each person
    const addedPersons: people_v1.Schema$Person[] = [];
    for (const person of persons) {
      const addedPerson = await addPerson(client as GoogleAuthClient, person, resourceName);
      addedPersons.push(addedPerson);
    }

    log.info(`Successfully added ${addedPersons.length} contacts`);
    return addedPersons;
  } catch (error) {
    log.error('Error adding contacts', { error: (error as Error).message });
    throw error;
  }
}
