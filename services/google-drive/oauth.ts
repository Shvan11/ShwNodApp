/**
 * Google Drive OAuth 2.0 (Authorization Code, offline access) — connect/status/
 * disconnect for the aligner-PDF Drive integration, managed from
 * Settings → Integrations.
 *
 * The interactive connect flow itself is browser redirects under
 * `/api/admin/google-drive` (auth-url/callback in routes/admin.ts) — kept at that
 * existing path rather than the `/api/auth/<provider>` convention used by 3Shape,
 * because it's the redirect URI already registered against this Google Cloud OAuth
 * client; changing it would require a matching change in Google Cloud Console.
 *
 * Tokens persist in the LOCAL-ONLY `integration_oauth_tokens` table (never synced,
 * never sent to the client) — same table as the 3Shape integration, keyed by a
 * different `provider`. See services/threeshape/oauth.ts for the sibling pattern.
 */
import config from '../../config/config.js';
import { log } from '../../utils/logger.js';
import { credentialsToTokenRow, generateState, isInvalidGrantError } from '../../utils/oauth.js';
import driveClient from './google-drive-client.js';
import {
  clearGoogleDriveTokens,
  getGoogleDriveTokens,
  saveGoogleDriveTokens,
} from '../database/queries/google-drive-queries.js';

// The anti-CSRF `state` generator and the invalid-grant classifier are shared with the other OAuth
// integrations (utils/oauth.ts — they used to be per-provider copies). Re-exported so this module
// stays the single façade for the Drive integration and call sites keep the `googleDriveOAuth.x` form.
export { generateState, isInvalidGrantError };

/** Is the OAuth client configured enough to start the connect flow? */
export function isConfigured(): boolean {
  return Boolean(config.googleDrive.clientId && config.googleDrive.clientSecret);
}

/** Build the Google consent-screen URL to 302 the browser to. */
export function buildAuthorizeUrl(state: string): string {
  if (!driveClient.oauth2Client) {
    driveClient.initialize();
  }
  if (!driveClient.oauth2Client) {
    throw new Error('Google Drive is not configured on this server.');
  }
  return driveClient.getAuthUrl(state);
}

/** Exchange an authorization code for tokens and persist them (the callback step). */
export async function exchangeCode(code: string): Promise<void> {
  const tokens = await driveClient.getTokensFromCode(code);
  if (!tokens.refresh_token) {
    throw new Error(
      'Google did not return a refresh token. Revoke this app\'s access at ' +
        'https://myaccount.google.com/permissions and try connecting again.'
    );
  }
  await saveGoogleDriveTokens(credentialsToTokenRow(tokens));
  await driveClient.loadStoredCredentials();
  log.info('[GoogleDrive] OAuth tokens stored');
}

export interface GoogleDriveStatus {
  /** OAuth client id/secret configured. */
  configured: boolean;
  /** Tokens are stored (does NOT make a live Drive call). */
  connected: boolean;
  /** GOOGLE_DRIVE_FOLDER_ID is set. */
  folderConfigured: boolean;
  /** Last-known access-token expiry as ISO string, or null. */
  expiresAt: string | null;
  /** Granted OAuth scope, or null. */
  scope: string | null;
}

/** Status for the Settings → Integrations card. Deliberately no live Drive call. */
export async function getStatus(): Promise<GoogleDriveStatus> {
  const tokens = await getGoogleDriveTokens();
  return {
    configured: isConfigured(),
    connected: Boolean(tokens?.refreshToken),
    folderConfigured: Boolean(config.googleDrive.folderId),
    expiresAt: tokens ? tokens.expiresAt.toISOString() : null,
    scope: tokens?.scope ?? null,
  };
}

/**
 * Disconnect — drop the stored tokens AND de-authorize the live client.
 *
 * The `loadStoredCredentials()` call is what makes this real rather than cosmetic: it re-reads the
 * (now empty) store and clears the singleton's in-memory credentials, falling back to the env
 * refresh token if one is configured. Without that second step the Settings card flipped to "not
 * connected" while `driveClient` kept the cleared refresh token in memory and went on uploading
 * until the service was restarted.
 */
export async function disconnect(): Promise<void> {
  await clearGoogleDriveTokens();
  await driveClient.loadStoredCredentials();
  log.info('[GoogleDrive] disconnected (tokens cleared)');
}

/**
 * A Drive call failed with invalid_grant — the stored refresh token was revoked or
 * expired. Drop it so the Settings card immediately reflects "not connected"
 * instead of silently failing on every subsequent upload, and drop it from the live
 * client too so the next call fails loudly instead of retrying a dead token.
 */
export async function handleInvalidGrant(): Promise<void> {
  await clearGoogleDriveTokens();
  await driveClient.loadStoredCredentials();
  log.warn('[GoogleDrive] refresh token invalid — cleared stored tokens, reconnect required');
}
