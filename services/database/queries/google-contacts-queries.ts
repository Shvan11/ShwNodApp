/**
 * Token persistence for the Google Contacts OAuth integration (message-recipient
 * phone book).
 *
 * Unlike Drive/3Shape — one row per provider — Contacts holds one row PER GOOGLE
 * ACCOUNT, keyed `provider='google_contacts:<accountId>'` (see
 * shared/google-contacts-accounts.ts). `integration_oauth_tokens.provider` is a
 * free-text PK, so the multi-account fan-out needs no DDL.
 *
 * The table is LOCAL-ONLY (no cdc_capture trigger) so the clinic's OAuth tokens
 * never replicate to the Supabase mirror. Written only by
 * services/google-contacts/oauth.ts + contacts.ts; never exposed to the client.
 */
import { getKysely } from '../kysely.js';
import { log } from '../../../utils/logger.js';

const PROVIDER_PREFIX = 'google_contacts';

/** Token-store key for an account id. */
function providerKey(accountId: string): string {
  return `${PROVIDER_PREFIX}:${accountId}`;
}

/**
 * Decoded token row. `type` (not interface) so it stays assignable wherever a
 * structural shape is expected. `expiresAt` is a Date (the `timestamp` parser).
 */
export type GoogleContactsTokens = {
  accessToken: string;
  refreshToken: string | null;
  tokenType: string;
  scope: string | null;
  expiresAt: Date;
  /**
   * The Google address this grant actually belongs to, read back from the People
   * API at connect time. NULL for a grant predating the column (or one imported
   * from the retired on-disk `tokens/*.json`) — it fills in on the next connect.
   */
  accountEmail: string | null;
};

/** Read one account's stored tokens, or null when that account isn't connected. */
export async function getGoogleContactsTokens(
  accountId: string
): Promise<GoogleContactsTokens | null> {
  try {
    const row = await getKysely()
      .selectFrom('integration_oauth_tokens')
      .selectAll()
      .where('provider', '=', providerKey(accountId))
      .executeTakeFirst();
    if (!row) return null;
    return {
      accessToken: row.access_token,
      refreshToken: row.refresh_token,
      tokenType: row.token_type,
      scope: row.scope,
      expiresAt: row.expires_at as Date,
      accountEmail: row.account_email,
    };
  } catch (error) {
    log.error('Error reading Google Contacts tokens', {
      accountId,
      error: (error as Error).message,
    });
    throw error;
  }
}

/**
 * Every connected account's tokens, keyed by account id — one query for the
 * Settings → Integrations card rather than N round-trips.
 */
export async function listGoogleContactsTokens(): Promise<Map<string, GoogleContactsTokens>> {
  try {
    const rows = await getKysely()
      .selectFrom('integration_oauth_tokens')
      .selectAll()
      .where('provider', 'like', `${PROVIDER_PREFIX}:%`)
      .execute();
    return new Map(
      rows.map((row) => [
        row.provider.slice(PROVIDER_PREFIX.length + 1),
        {
          accessToken: row.access_token,
          refreshToken: row.refresh_token,
          tokenType: row.token_type,
          scope: row.scope,
          expiresAt: row.expires_at as Date,
          accountEmail: row.account_email,
        },
      ])
    );
  } catch (error) {
    log.error('Error listing Google Contacts tokens', { error: (error as Error).message });
    throw error;
  }
}

/** Upsert one account's tokens (after a code exchange or a rotated refresh token). */
export async function saveGoogleContactsTokens(
  accountId: string,
  tokens: GoogleContactsTokens
): Promise<void> {
  const values = {
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    token_type: tokens.tokenType,
    scope: tokens.scope,
    expires_at: tokens.expiresAt,
    account_email: tokens.accountEmail,
  };
  try {
    await getKysely()
      .insertInto('integration_oauth_tokens')
      .values({ provider: providerKey(accountId), ...values })
      .onConflict((oc) => oc.column('provider').doUpdateSet({ ...values, updated_at: new Date() }))
      .execute();
  } catch (error) {
    log.error('Error saving Google Contacts tokens', {
      accountId,
      error: (error as Error).message,
    });
    throw error;
  }
}

/**
 * Which registered account slot (if any) already holds a grant for `email`.
 *
 * Guards the connect callback: the consent URL cannot force a particular Google account, so a staff
 * member signed into the wrong one would otherwise file that grant under whichever slot they
 * clicked Connect on, silently shadowing the other. Returns the slot's account id, or null when the
 * address is unclaimed. `account_email` is citext, so the comparison is case-insensitive.
 */
export async function findAccountIdByEmail(email: string): Promise<string | null> {
  const row = await getKysely()
    .selectFrom('integration_oauth_tokens')
    .select('provider')
    .where('provider', 'like', `${PROVIDER_PREFIX}:%`)
    .where('account_email', '=', email)
    .executeTakeFirst();
  return row ? row.provider.slice(PROVIDER_PREFIX.length + 1) : null;
}

/** Remove one account's tokens (disconnect, or a detected invalid_grant). */
export async function clearGoogleContactsTokens(accountId: string): Promise<void> {
  try {
    await getKysely()
      .deleteFrom('integration_oauth_tokens')
      .where('provider', '=', providerKey(accountId))
      .execute();
  } catch (error) {
    log.error('Error clearing Google Contacts tokens', {
      accountId,
      error: (error as Error).message,
    });
    throw error;
  }
}
