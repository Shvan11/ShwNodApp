/**
 * Token persistence for the Google Drive OAuth integration (aligner PDF storage).
 *
 * One row in `integration_oauth_tokens` keyed `provider='google_drive'`. This table
 * is LOCAL-ONLY (no cdc_capture trigger) so the clinic's OAuth tokens never
 * replicate to the Supabase mirror — see
 * migrations/pg/1781900000000_integration-oauth-tokens.sql. Written only by
 * services/google-drive/oauth.ts; never exposed to the client.
 */
import { getKysely } from '../kysely.js';
import { log } from '../../../utils/logger.js';

const PROVIDER = 'google_drive';

/**
 * Decoded token row. `type` (not interface) so it stays assignable wherever a
 * structural shape is expected. `expiresAt` is a Date (the `timestamp` parser).
 */
export type GoogleDriveTokens = {
  accessToken: string;
  refreshToken: string | null;
  tokenType: string;
  scope: string | null;
  expiresAt: Date;
};

/** Read the stored Google Drive tokens, or null when not connected. */
export async function getGoogleDriveTokens(): Promise<GoogleDriveTokens | null> {
  try {
    const row = await getKysely()
      .selectFrom('integration_oauth_tokens')
      .selectAll()
      .where('provider', '=', PROVIDER)
      .executeTakeFirst();
    if (!row) return null;
    return {
      accessToken: row.access_token,
      refreshToken: row.refresh_token,
      tokenType: row.token_type,
      scope: row.scope,
      expiresAt: row.expires_at as Date,
    };
  } catch (error) {
    log.error('Error reading Google Drive tokens', { error: (error as Error).message });
    throw error;
  }
}

/** Upsert the Google Drive tokens (after a code exchange or a rotated refresh token). */
export async function saveGoogleDriveTokens(tokens: GoogleDriveTokens): Promise<void> {
  const values = {
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    token_type: tokens.tokenType,
    scope: tokens.scope,
    expires_at: tokens.expiresAt,
  };
  try {
    await getKysely()
      .insertInto('integration_oauth_tokens')
      .values({ provider: PROVIDER, ...values })
      .onConflict((oc) =>
        oc.column('provider').doUpdateSet({ ...values, updated_at: new Date() })
      )
      .execute();
  } catch (error) {
    log.error('Error saving Google Drive tokens', { error: (error as Error).message });
    throw error;
  }
}

/** Remove the stored Google Drive tokens (disconnect, or a detected invalid_grant). */
export async function clearGoogleDriveTokens(): Promise<void> {
  try {
    await getKysely()
      .deleteFrom('integration_oauth_tokens')
      .where('provider', '=', PROVIDER)
      .execute();
  } catch (error) {
    log.error('Error clearing Google Drive tokens', { error: (error as Error).message });
    throw error;
  }
}
