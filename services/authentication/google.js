/**
 * Google Contacts API Service
 * Provides authentication and operations for Google Contacts
 */
import { promises as fs, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { cwd } from 'process';
import { authenticate } from '@google-cloud/local-auth';
import { google } from 'googleapis';


// If modifying these scopes, delete token.json
const SCOPES = ['https://www.googleapis.com/auth/contacts'];
const CREDENTIALS_PATH = join(cwd(), 'credentials.json');
const TOKEN_DIR = join(cwd(), 'tokens');

// Ensure tokens directory exists
if (!existsSync(TOKEN_DIR)) {
  mkdirSync(TOKEN_DIR, { recursive: true });
}

/**
 * Reads previously authorized credentials from the save file.
 * @param {string} tokenPath - Path to the token file
 * @return {Promise<OAuth2Client|null>}
 */
async function loadSavedCredentialsIfExist(tokenPath) {
  try {
    const content = await fs.readFile(tokenPath);
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch (err) {
    console.log(`No existing token found at ${tokenPath} or error reading it:`, err.message);
    return null;
  }
}

/**
 * Refresh OAuth2 access token and update stored credentials
 * @param {OAuth2Client} oauth2Client - The OAuth2 client
 * @param {string} tokenPath - Path to the token file
 * @return {Promise<void>}
 */
async function refreshAccessToken(oauth2Client, tokenPath) {
  try {
    console.log('Refreshing access token...');
    const tokens = await oauth2Client.refreshAccessToken();
    oauth2Client.setCredentials(tokens.credentials);
    
    // Read existing token data to preserve any other fields
    let existingData = {};
    try {
      const content = await fs.readFile(tokenPath);
      existingData = JSON.parse(content);
    } catch (error) {
      // If file doesn't exist or can't be parsed, use empty object
    }
    
    // Update with new token info
    const updatedData = {
      ...existingData,
      access_token: tokens.credentials.access_token,
      refresh_token: tokens.credentials.refresh_token || existingData.refresh_token,
      expiry_date: tokens.credentials.expiry_date
    };
    
    // Write updated token data back to file
    await fs.writeFile(tokenPath, JSON.stringify(updatedData, null, 2));
    console.log('Token refreshed and saved');
  } catch (error) {
    console.error('Error refreshing access token:', error);
    throw error;
  }
}

/**
 * Serializes credentials to a file compatible with GoogleAuth.fromJSON.
 * @param {OAuth2Client} client - The authenticated client
 * @param {string} tokenPath - Path to the token file
 * @return {Promise<void>}
 */
async function saveCredentials(client, tokenPath) {
  try {
    const content = await fs.readFile(CREDENTIALS_PATH);
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;
    const payload = JSON.stringify({
      type: 'authorized_user',
      client_id: key.client_id,
      client_secret: key.client_secret,
      refresh_token: client.credentials.refresh_token,
    });
    await fs.writeFile(tokenPath, payload);
    console.log(`Credentials saved to ${tokenPath}`);
  } catch (error) {
    console.error('Error saving credentials:', error);
    throw error;
  }
}

/**
 * Get OAuth2 client for Google API authorization
 * @param {string} source - Identifier for the token file
 * @returns {Promise<OAuth2Client>}
 */
async function authorize(source) {
  const tokenPath = join(TOKEN_DIR, `${source}_token.json`);
  
  console.log(`Attempting to authorize using token from ${tokenPath}`);
  let client = await loadSavedCredentialsIfExist(tokenPath);
  
  if (client) {
    try {
      // Check if token needs refresh
      if (client.credentials.expiry_date && client.credentials.expiry_date < Date.now()) {
        await refreshAccessToken(client, tokenPath);
      }
      console.log('Authorization successful using saved credentials');
      return client;
    } catch (error) {
      console.warn('Error with saved credentials, will try fresh authentication:', error.message);
    }
  }
  
  console.log('No valid saved credentials, proceeding with new authentication');
  try {
    client = await authenticate({
      scopes: SCOPES,
      keyfilePath: CREDENTIALS_PATH,
    });
    
    console.log('New authentication successful');
    
    if (client.credentials) {
      await saveCredentials(client, tokenPath);
    }
    
    return client;
  } catch (error) {
    console.error('Authentication failed:', error);
    throw error;
  }
}

/**
 * Process contacts into a more usable format
 * @param {Array} contacts - Raw contacts from Google API
 * @returns {Array} - Processed contacts
 */
function prepareContacts(contacts) {
  const preparedContacts = [];
  let i = 0;
  
  contacts.forEach((person) => {
    if (person.names && person.names.length > 0 && person.phoneNumbers && person.phoneNumbers.length > 0) {
      preparedContacts.push({
        id: i,
        text: person.names[0].displayName,
        phone: person.phoneNumbers[0].value
      });
      i++;
    }
  });
  
  return preparedContacts;
}

/**
 * Create a Google contact group
 * @param {OAuth2Client} auth - OAuth2 client
 * @param {string} group - Group name
 * @returns {Promise<string>} - Resource name of created group
 */
async function createGroup(auth, group) {
  try {
    const service = google.people({ version: 'v1', auth });
    
    console.log(`Creating group "${group}"...`);
    const res = await service.contactGroups.create({
      requestBody: {
        contactGroup: {
          name: group
        }
      }
    });
    
    const addedGroup = res.data;
    
    // Handle case where group already exists (status 409)
    if (res.status === 409) {
      console.log(`Group "${group}" already exists, fetching existing group...`);
      const res0 = await service.contactGroups.list({
        pageSize: 1000
      });
      
      const groups = res0.data.contactGroups;
      for (const recievedGroup of groups) {
        if (recievedGroup.name === group) {
          console.log(`Found existing group: ${recievedGroup.resourceName}`);
          return recievedGroup.resourceName;
        }
      }
    }
    
    console.log(`Group created: ${addedGroup.resourceName}`);
    return addedGroup.resourceName;
  } catch (error) {
    console.error(`Error creating group "${group}":`, error);
    throw error;
  }
}

/**
 * Add a person to Google contacts
 * @param {OAuth2Client} auth - OAuth2 client
 * @param {Object} contact - Contact info {name, phone}
 * @param {string} resourceName - Optional group resource name
 * @returns {Promise<Object>} - Added person data
 */
async function addPerson(auth, contact, resourceName) {
  try {
    const service = google.people({ version: 'v1', auth });
    
    console.log(`Adding contact: ${contact.name} (${contact.phone})`);
    
    const requestBody = {
      names: [{
        givenName: contact.name,
      }],
      phoneNumbers: [{
        value: contact.phone,
      }]
    };
    
    // Add group membership if provided
    if (resourceName) {
      requestBody.memberships = [{
        contactGroupMembership: {
          contactGroupResourceName: resourceName
        }
      }];
    }
    
    const res = await service.people.createContact({
      requestBody
    });
    
    console.log(`Contact added: ${res.data.resourceName}`);
    return res.data;
  } catch (error) {
    console.error(`Error adding contact ${contact.name}:`, error);
    throw error;
  }
}

/**
 * Get contacts from Google
 * @param {string} source - Source identifier for token
 * @returns {Promise<Array>} - Array of contacts
 */
export async function getContacts(source) {
  console.log(`Fetching contacts using source: ${source}`);
  try {
    const client = await authorize(source);
    
    const service = google.people({ version: 'v1', auth: client });
    let connections = [];
    let nextPageToken = null;
    
    console.log('Fetching contacts with pagination...');
    
    // Fetch all contacts with pagination
    do {
      const res = await service.people.connections.list({
        resourceName: 'people/me',
        pageSize: 1000,
        pageToken: nextPageToken,
        personFields: 'names,emailAddresses,phoneNumbers',
      });
      
      if (res.data.connections) {
        console.log(`Fetched ${res.data.connections.length} contacts in this page`);
        connections = connections.concat(res.data.connections);
      }
      
      nextPageToken = res.data.nextPageToken;
    } while (nextPageToken);
    
    console.log(`Total contacts fetched: ${connections.length}`);
    
    const preparedContacts = prepareContacts(connections);
    console.log(`Processed ${preparedContacts.length} valid contacts with names and phone numbers`);
    
    return preparedContacts;
  } catch (error) {
    console.error('Error fetching contacts:', error);
    throw error;
  }
}

/**
 * Add a single contact to Google
 * @param {string} source - Source identifier for token
 * @param {Object} person - Contact info {name, phone}
 * @returns {Promise<Object>} - Added contact
 */
export async function addContact(source, person) {
  console.log(`Adding contact using source: ${source}`);
  try {
    const client = await authorize(source);
    const addedPerson = await addPerson(client, person);
    return addedPerson;
  } catch (error) {
    console.error('Error adding contact:', error);
    throw error;
  }
}

/**
 * Add multiple contacts to Google
 * @param {string} source - Source identifier for token
 * @param {Array} persons - Array of contacts
 * @param {string} group - Group name
 * @returns {Promise<Array>} - Added contacts
 */
export async function addContacts(source, persons, group) {
  console.log(`Adding ${persons.length} contacts using source: ${source}`);
  try {
    const client = await authorize(source);
    let resourceName;
    
    // Create or get group if specified
    if (group) {
      console.log(`Using group: ${group}_Appointments`);
      resourceName = await createGroup(client, group + "_Appointments");
    }
    
    // Add each person
    const addedPersons = [];
    for (const person of persons) {
      const addedPerson = await addPerson(client, person, resourceName);
      addedPersons.push(addedPerson);
    }
    
    console.log(`Successfully added ${addedPersons.length} contacts`);
    return addedPersons;
  } catch (error) {
    console.error('Error adding contacts:', error);
    throw error;
  }
}