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
import crypto from 'node:crypto';
import config from '../../config/config.js';
import { log } from '../../utils/logger.js';
import driveClient from './google-drive-client.js';
import {
  clearGoogleDriveTokens,
  getGoogleDriveTokens,
  saveGoogleDriveTokens,
} from '../database/queries/google-drive-queries.js';

/** Is the OAuth client configured enough to start the connect flow? */
export function isConfigured(): boolean {
  return Boolean(config.googleDrive.clientId && config.googleDrive.clientSecret);
}

/** Random anti-CSRF `state`. */
export function generateState(): string {
  return crypto.randomBytes(16).toString('base64url');
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
  await saveGoogleDriveTokens({
    accessToken: tokens.access_token || '',
    refreshToken: tokens.refresh_token,
    tokenType: tokens.token_type || 'Bearer',
    scope: tokens.scope ?? null,
    expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : new Date(Date.now() + 3600_000),
  });
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

/** Disconnect — drop the stored tokens (falls back to the env token, if any). */
export async function disconnect(): Promise<void> {
  await clearGoogleDriveTokens();
  await driveClient.loadStoredCredentials();
  log.info('[GoogleDrive] disconnected (tokens cleared)');
}

/** Detect Google's "refresh token no longer valid" error across the shapes googleapis/gaxios throw it in. */
export function isInvalidGrantError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const withResponse = err as { response?: { data?: { error?: string } } };
  if (withResponse.response?.data?.error === 'invalid_grant') return true;
  return /invalid_grant/i.test(err.message);
}

/**
 * A Drive call failed with invalid_grant — the stored refresh token was revoked or
 * expired. Drop it so the Settings card immediately reflects "not connected"
 * instead of silently failing on every subsequent upload.
 */
export async function handleInvalidGrant(): Promise<void> {
  await clearGoogleDriveTokens();
  log.warn('[GoogleDrive] refresh token invalid — cleared stored tokens, reconnect required');
}
