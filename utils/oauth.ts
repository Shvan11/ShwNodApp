/**
 * Shared OAuth helpers for the three integrations that run the authorization-code flow —
 * Google Drive (aligner-PDF storage), Google Contacts (the message-recipient phone book), and
 * 3Shape Unite (PKCE). Each used to carry its own copy of all of this: `isInvalidGrantError` was
 * byte-identical between the two Google modules, `generateState` existed three times as two
 * different implementations, and the token-row expiry mapping was written out in three places.
 *
 * That duplication has a real failure mode rather than just being untidy: whichever copy of
 * `isInvalidGrantError` learns about a new gaxios error shape first, the others keep classifying a
 * REVOKED grant as a transient failure — so their Settings card goes on claiming "Connected" while
 * every call fails, which is the exact bug the Contacts integration already shipped once.
 *
 * Deliberately dependency-free (node crypto + the google-auth-library `Credentials` TYPE only) so
 * it stays importable from any of the three without dragging a service graph along.
 */
import crypto from 'node:crypto';
import type { Credentials } from 'google-auth-library';

/** Default access-token lifetime to assume when a provider returns no explicit expiry. */
const DEFAULT_EXPIRY_MS = 3600_000;

/**
 * Random anti-CSRF `state` for an authorization request. base64url so it survives a query string
 * untouched; 16 bytes = 128 bits, well past guessing range for a value that lives for one redirect.
 */
export function generateState(): string {
  return crypto.randomBytes(16).toString('base64url');
}

/**
 * Detect a provider's "this refresh token is no longer valid" signal across the shapes googleapis /
 * gaxios throw it in — a structured `response.data.error`, or only the message text.
 *
 * Callers must treat a true here as PERMANENT (clear the stored grant, tell the user to reconnect),
 * never as transient — retrying an invalid_grant just burns quota and leaves the UI lying about
 * being connected.
 */
export function isInvalidGrantError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const withResponse = err as { response?: { data?: { error?: string } } };
  if (withResponse.response?.data?.error === 'invalid_grant') return true;
  return /invalid_grant/i.test(err.message);
}

/** The persisted shape shared by every `integration_oauth_tokens` row. */
export interface StoredOAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  tokenType: string;
  scope: string | null;
  expiresAt: Date;
}

/**
 * Map a google-auth-library `Credentials` onto the stored token row.
 *
 * `fallbackRefresh` covers the common refresh case: Google emits `refresh_token` only on the
 * initial grant (or an occasional rotation), never on a plain access-token refresh, so without it a
 * refresh would persist `null` and orphan the grant. `expiry_date` missing falls back to an hour
 * out, which only costs one early refresh attempt if the real lifetime was shorter.
 */
export function credentialsToTokenRow(
  tokens: Credentials,
  fallbackRefresh?: string | null
): StoredOAuthTokens {
  return {
    accessToken: tokens.access_token || '',
    refreshToken: tokens.refresh_token ?? fallbackRefresh ?? null,
    tokenType: tokens.token_type || 'Bearer',
    scope: tokens.scope ?? null,
    expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : new Date(Date.now() + DEFAULT_EXPIRY_MS),
  };
}
