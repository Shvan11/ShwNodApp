/**
 * Google Contacts OAuth 2.0 (Authorization Code, offline access) — connect/status/
 * disconnect for the message-recipient phone book, managed from
 * Settings → Integrations.
 *
 * Replaces the previous `@google-cloud/local-auth` flow, which opened a browser +
 * loopback consent server ON THE SERVER. That can never complete on the headless
 * Windows service, so the feature only ever worked on the already-refreshed path:
 * once a refresh token was revoked there was no in-app way to reconnect.
 *
 * Shape mirrors services/google-drive/oauth.ts, with two deliberate differences:
 *
 * 1. **Multi-account.** Contacts are pulled from several distinct Google accounts
 *    (`shared/google-contacts-accounts.ts`), so every operation is keyed by
 *    account id and tokens live one row per account (`google_contacts:<id>`).
 *
 * 2. **Client credentials are resolved, not assumed** (see resolveClient below).
 *    A refresh token is bound to the OAuth client that issued it, so an install
 *    carrying pre-existing `tokens/*.json` grants must keep using the client from
 *    its `credentials.json` — pairing those tokens with a different client id
 *    fails `invalid_client` on the very first refresh.
 */
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { cwd } from 'node:process';
import { OAuth2Client } from 'google-auth-library';
import config from '../../config/config.js';
import { log } from '../../utils/logger.js';
import {
  GOOGLE_CONTACT_ACCOUNTS,
  googleContactAccountLabel,
} from '../../shared/google-contacts-accounts.js';
import {
  clearGoogleContactsTokens,
  getGoogleContactsTokens,
  listGoogleContactsTokens,
  saveGoogleContactsTokens,
} from '../database/queries/google-contacts-queries.js';

/** Read-only is all the phone book needs; the retired local-auth flow asked for read-write. */
const SCOPES = ['https://www.googleapis.com/auth/contacts.readonly'];

/** Legacy on-disk artefacts of the retired local-auth flow (still present on existing installs). */
const LEGACY_CREDENTIALS_PATH = join(cwd(), 'credentials.json');
const LEGACY_TOKEN_DIR = join(cwd(), 'tokens');

// ---------------------------------------------------------------------------
// Errors — mapped to HTTP status by the /api/google route
// ---------------------------------------------------------------------------

export type GoogleContactsErrorCode = 'not_configured' | 'unknown_account' | 'not_connected';

/** A caller-actionable auth failure (as opposed to a transient Google API error). */
export class GoogleContactsAuthError extends Error {
  constructor(
    public readonly code: GoogleContactsErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'GoogleContactsAuthError';
  }
}

// ---------------------------------------------------------------------------
// Client credential resolution
// ---------------------------------------------------------------------------

interface ResolvedClient {
  clientId: string;
  clientSecret: string;
  /**
   * Where the credentials came from. `credentials.json` installs are pre-existing
   * ones whose stored refresh tokens are bound to that client.
   */
  source: 'env' | 'credentials.json';
  /**
   * Google OAuth client type. Only a **web** client can complete the browser
   * redirect flow; a desktop ("installed") client accepts loopback redirects only,
   * so it can refresh existing grants but cannot be reconnected through the UI.
   */
  type: 'web' | 'installed';
}

interface LegacyCredentialsFile {
  installed?: { client_id?: string; client_secret?: string };
  web?: { client_id?: string; client_secret?: string };
}

let cachedClient: ResolvedClient | null | undefined;

/**
 * Resolve the OAuth client to use, preferring a pre-existing `credentials.json`.
 *
 * Order matters and is NOT the usual env-wins: an install that already holds
 * grants issued by the credentials.json client must keep using it, or every
 * refresh of those imported tokens fails. Explicit `GOOGLE_CONTACTS_*` env vars
 * still win over both, so an operator can migrate to a web client deliberately.
 */
export async function resolveClient(): Promise<ResolvedClient | null> {
  if (cachedClient !== undefined) return cachedClient;

  const envId = config.googleContacts.clientId;
  const envSecret = config.googleContacts.clientSecret;
  if (config.googleContacts.explicit && envId && envSecret) {
    cachedClient = { clientId: envId, clientSecret: envSecret, source: 'env', type: 'web' };
    return cachedClient;
  }

  try {
    const raw = await fs.readFile(LEGACY_CREDENTIALS_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as LegacyCredentialsFile;
    const type: 'web' | 'installed' = parsed.web ? 'web' : 'installed';
    const key = parsed.web ?? parsed.installed;
    if (key?.client_id && key.client_secret) {
      cachedClient = {
        clientId: key.client_id,
        clientSecret: key.client_secret,
        source: 'credentials.json',
        type,
      };
      return cachedClient;
    }
  } catch {
    // No credentials.json (a fresh install) — fall through to the env fallback.
  }

  cachedClient =
    envId && envSecret
      ? { clientId: envId, clientSecret: envSecret, source: 'env', type: 'web' }
      : null;
  return cachedClient;
}

/** Drop the memoized client so a config/credentials change takes effect without a restart. */
export function resetResolvedClient(): void {
  cachedClient = undefined;
}

/** Is the OAuth client configured enough to refresh or start a connect flow? */
export async function isConfigured(): Promise<boolean> {
  return (await resolveClient()) !== null;
}

/** The redirect URI this server will send Google back to (must be registered on the client). */
export function getRedirectUri(): string {
  return config.googleContacts.redirectUri;
}

// ---------------------------------------------------------------------------
// Legacy token import (one-time, per account)
// ---------------------------------------------------------------------------

interface LegacyTokenFile {
  refresh_token?: string;
  access_token?: string;
  expiry_date?: number;
}

/**
 * Adopt a pre-existing `tokens/<accountId>_token.json` grant into the token store.
 *
 * Existing installs already hold working refresh tokens on disk; without this they
 * would lose the contacts phone book the moment this code ships and would have to
 * re-consent every account by hand. Idempotent — the DB row it writes means the
 * next call short-circuits before reaching here. The file is left in place (read
 * only) so the change stays reversible.
 */
async function importLegacyToken(accountId: string): Promise<boolean> {
  const tokenPath = join(LEGACY_TOKEN_DIR, `${accountId}_token.json`);
  let parsed: LegacyTokenFile;
  try {
    parsed = JSON.parse(await fs.readFile(tokenPath, 'utf-8')) as LegacyTokenFile;
  } catch {
    return false; // No legacy grant for this account — normal on a fresh install.
  }

  if (!parsed.refresh_token) {
    log.warn('[GoogleContacts] legacy token file has no refresh_token — ignoring', {
      accountId,
      tokenPath,
    });
    return false;
  }

  await saveGoogleContactsTokens(accountId, {
    accessToken: parsed.access_token ?? '',
    refreshToken: parsed.refresh_token,
    tokenType: 'Bearer',
    // The legacy file records no scope; leave it null rather than assert one.
    scope: null,
    // Force a refresh on first use — the stored access token is almost certainly stale.
    expiresAt: parsed.expiry_date ? new Date(parsed.expiry_date) : new Date(0),
  });
  log.info('[GoogleContacts] imported legacy on-disk grant into the token store', {
    accountId,
    tokenPath,
  });
  return true;
}

// ---------------------------------------------------------------------------
// Authorized client
// ---------------------------------------------------------------------------

/**
 * Build an OAuth2 client for one account, loading (or importing) its stored grant.
 * Rotated refresh tokens are persisted so a restart never needs a re-consent.
 *
 * @throws GoogleContactsAuthError when unconfigured or that account isn't connected.
 */
export async function getAuthorizedClient(accountId: string): Promise<OAuth2Client> {
  const resolved = await resolveClient();
  if (!resolved) {
    throw new GoogleContactsAuthError(
      'not_configured',
      'Google Contacts is not configured on this server. Set GOOGLE_CONTACTS_CLIENT_ID and GOOGLE_CONTACTS_CLIENT_SECRET (or provide credentials.json).'
    );
  }

  let tokens = await getGoogleContactsTokens(accountId);
  if (!tokens?.refreshToken && (await importLegacyToken(accountId))) {
    tokens = await getGoogleContactsTokens(accountId);
  }
  if (!tokens?.refreshToken) {
    throw new GoogleContactsAuthError(
      'not_connected',
      `“${googleContactAccountLabel(accountId)}” is not connected to Google Contacts. Connect it in Settings → Integrations.`
    );
  }

  const client = new OAuth2Client(resolved.clientId, resolved.clientSecret, getRedirectUri());
  client.setCredentials({
    refresh_token: tokens.refreshToken,
    access_token: tokens.accessToken || undefined,
    expiry_date: tokens.expiresAt.getTime(),
  });

  // Google emits refresh_token only on the initial grant or an occasional rotation,
  // never on a plain access-token refresh — so this fires rarely. Best-effort; it
  // must never throw into caller code.
  client.on('tokens', (issued) => {
    if (!issued.refresh_token) return;
    saveGoogleContactsTokens(accountId, {
      accessToken: issued.access_token || '',
      refreshToken: issued.refresh_token,
      tokenType: issued.token_type || 'Bearer',
      scope: issued.scope ?? null,
      expiresAt: issued.expiry_date ? new Date(issued.expiry_date) : new Date(Date.now() + 3600_000),
    }).catch((error: unknown) => {
      log.error('[GoogleContacts] failed to persist rotated refresh token', {
        accountId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });

  return client;
}

// ---------------------------------------------------------------------------
// Connect flow
// ---------------------------------------------------------------------------

/** Random anti-CSRF `state`. */
export function generateState(): string {
  return crypto.randomBytes(16).toString('base64url');
}

/** Build the Google consent-screen URL to 302 the browser to, for one account. */
export async function buildAuthorizeUrl(accountId: string, state: string): Promise<string> {
  const resolved = await resolveClient();
  if (!resolved) {
    throw new GoogleContactsAuthError(
      'not_configured',
      'Google Contacts is not configured on this server.'
    );
  }
  const client = new OAuth2Client(resolved.clientId, resolved.clientSecret, getRedirectUri());
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent', // force a refresh token even on a re-consent
    state,
  });
}

/** Exchange an authorization code for tokens and persist them (the callback step). */
export async function exchangeCode(accountId: string, code: string): Promise<void> {
  const resolved = await resolveClient();
  if (!resolved) {
    throw new GoogleContactsAuthError(
      'not_configured',
      'Google Contacts is not configured on this server.'
    );
  }
  const client = new OAuth2Client(resolved.clientId, resolved.clientSecret, getRedirectUri());
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. Revoke this app's access at " +
        'https://myaccount.google.com/permissions and try connecting again.'
    );
  }
  await saveGoogleContactsTokens(accountId, {
    accessToken: tokens.access_token || '',
    refreshToken: tokens.refresh_token,
    tokenType: tokens.token_type || 'Bearer',
    scope: tokens.scope ?? null,
    expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : new Date(Date.now() + 3600_000),
  });
  log.info('[GoogleContacts] OAuth tokens stored', { accountId });
}

// ---------------------------------------------------------------------------
// Status / disconnect
// ---------------------------------------------------------------------------

export interface GoogleContactsAccountStatus {
  id: string;
  label: string;
  connected: boolean;
  expiresAt: string | null;
  scope: string | null;
}

export interface GoogleContactsStatus {
  /** OAuth client id/secret resolvable — grants can be refreshed. */
  configured: boolean;
  /** Where those credentials came from, or null when unconfigured. */
  credentialsSource: 'env' | 'credentials.json' | null;
  /**
   * The resolved client is a web client, so the browser connect flow can complete.
   * False for a desktop ("installed") client — existing grants keep refreshing, but
   * reconnecting needs a web client configured via env.
   */
  connectSupported: boolean;
  /** The redirect URI that must be registered on the OAuth client. */
  redirectUri: string;
  accounts: GoogleContactsAccountStatus[];
}

/** Status for the Settings → Integrations card. Deliberately no live People call. */
export async function getStatus(): Promise<GoogleContactsStatus> {
  const resolved = await resolveClient();
  const stored = await listGoogleContactsTokens();
  return {
    configured: resolved !== null,
    credentialsSource: resolved?.source ?? null,
    connectSupported: resolved?.type === 'web',
    redirectUri: getRedirectUri(),
    accounts: GOOGLE_CONTACT_ACCOUNTS.map((account) => {
      const tokens = stored.get(account.id);
      return {
        id: account.id,
        label: account.label,
        connected: Boolean(tokens?.refreshToken),
        expiresAt: tokens ? tokens.expiresAt.toISOString() : null,
        scope: tokens?.scope ?? null,
      };
    }),
  };
}

/** Disconnect one account — drop its stored tokens. */
export async function disconnect(accountId: string): Promise<void> {
  await clearGoogleContactsTokens(accountId);
  log.info('[GoogleContacts] disconnected (tokens cleared)', { accountId });
}

/** Detect Google's "refresh token no longer valid" error across the shapes gaxios throws it in. */
export function isInvalidGrantError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const withResponse = err as { response?: { data?: { error?: string } } };
  if (withResponse.response?.data?.error === 'invalid_grant') return true;
  return /invalid_grant/i.test(err.message);
}

/**
 * A People call failed with invalid_grant — the stored refresh token was revoked or
 * expired. Drop it so the Settings card immediately reflects "not connected"
 * instead of silently failing on every subsequent contacts fetch.
 */
export async function handleInvalidGrant(accountId: string): Promise<void> {
  await clearGoogleContactsTokens(accountId);
  log.warn('[GoogleContacts] refresh token invalid — cleared stored tokens, reconnect required', {
    accountId,
  });
}
