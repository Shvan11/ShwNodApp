/**
 * 3Shape Unite OAuth 2.0 (Authorization Code + PKCE) — token lifecycle.
 *
 * Public client (NO secret) against `identity.3shape.com`. This module owns all
 * `identity.3shape.com` HTTP and the token store: build the authorize URL, exchange
 * the code, refresh, and hand out a live access token. Token issuance is the only
 * cloud touch in the whole integration; everything else (client.ts) is LAN-local.
 *
 * Tokens persist in the LOCAL-ONLY `integration_oauth_tokens` table (never synced,
 * never sent to the client). Refresh is centralized in getValidAccessToken() and
 * single-flighted so concurrent callers share one refresh round-trip.
 */
import crypto from 'node:crypto';
import fetch from 'node-fetch';
import config from '../../config/config.js';
import { log } from '../../utils/logger.js';
import { describeFetchError } from '../../utils/fetch-timeout.js';
import { ThreeShapeError } from './errors.js';
import { tokenError, tokenResponse, type TokenResponse } from './dtos.js';
import {
  clearThreeShapeTokens,
  getThreeShapeTokens,
  saveThreeShapeTokens,
} from '../database/queries/threeshape-queries.js';

// Refresh this many ms before the access token actually expires (clock skew + RTT).
const EXPIRY_SKEW_MS = 60_000;

/**
 * Hard cap on an identity.3shape.com round trip.
 *
 * node-fetch v3 dropped its `timeout` option, so without an explicit signal there is NO bound: a
 * refused connection fails fast, but a firewall that DROPS rather than rejects hangs for the OS TCP
 * timeout (~75s+) — past Express's own 30s requestTimeout, so the caller gets a generic timeout
 * instead of the friendly 'unreachable' message this module works to produce.
 */
const TOKEN_TIMEOUT_MS = 15_000;

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** PKCE code_verifier — base64url(32 random bytes). */
export function generateVerifier(): string {
  return base64url(crypto.randomBytes(32));
}

/** PKCE code_challenge = base64url(SHA256(ascii(verifier))). */
export function challengeFromVerifier(verifier: string): string {
  return base64url(crypto.createHash('sha256').update(verifier).digest());
}

// Anti-CSRF `state` is shared with the Google integrations (utils/oauth.ts) — the same 16 random
// bytes, base64url. `base64url()` above stays local because PKCE also needs it for the challenge.
export { generateState } from '../../utils/oauth.js';

type RequiredOAuthConfig = {
  clientId: string;
  authority: string;
  scopes: string;
  redirectUri: string;
};

function requireOAuthConfig(): RequiredOAuthConfig {
  const c = config.threeshape;
  if (!c.clientId) {
    throw new ThreeShapeError('not_configured', '3Shape is not configured (set THREESHAPE_CLIENT_ID).');
  }
  return { clientId: c.clientId, authority: c.authority, scopes: c.scopes, redirectUri: c.redirectUri };
}

/** Is the OAuth flow configured enough to start? */
export function isConfigured(): boolean {
  return Boolean(config.threeshape.clientId);
}

/** Build the `/connect/authorize` URL to 302 the browser to. */
export function buildAuthorizeUrl(state: string, challenge: string): string {
  const c = requireOAuthConfig();
  const params = new URLSearchParams({
    client_id: c.clientId,
    response_type: 'code',
    scope: c.scopes,
    redirect_uri: c.redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    response_mode: 'query',
    state,
  });
  return `${c.authority}/connect/authorize?${params.toString()}`;
}

/** POST the token endpoint (no client-auth header — public PKCE client). */
async function postToken(body: URLSearchParams): Promise<TokenResponse> {
  const c = requireOAuthConfig();
  let res;
  try {
    res = await fetch(`${c.authority}/connect/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
  } catch (err) {
    // An AbortError here is the timeout above, which is the same operational condition as a refused
    // connection from the caller's point of view — both mean "couldn't talk to 3Shape".
    const detail = describeFetchError(err, TOKEN_TIMEOUT_MS);
    throw new ThreeShapeError('unreachable', `Could not reach the 3Shape identity service: ${detail}`);
  }
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = tokenError.safeParse(json);
    const code = parsed.success ? parsed.data.error : `http_${res.status}`;
    const desc = parsed.success ? parsed.data.error_description : undefined;
    throw new ThreeShapeError(code, desc || `3Shape token request failed (${code}).`, res.status);
  }
  return tokenResponse.parse(json);
}

/** Persist a token response; keep the existing refresh token if none came back. */
async function persist(tok: TokenResponse, fallbackRefresh?: string | null): Promise<void> {
  await saveThreeShapeTokens({
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token ?? fallbackRefresh ?? null,
    tokenType: tok.token_type || 'Bearer',
    scope: tok.scope ?? null,
    expiresAt: new Date(Date.now() + tok.expires_in * 1000),
  });
}

/** Exchange an authorization code for tokens (the callback step). */
export async function exchangeCode(code: string, verifier: string): Promise<void> {
  const c = requireOAuthConfig();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: c.redirectUri,
    client_id: c.clientId,
    code_verifier: verifier,
  });
  await persist(await postToken(body));
  log.info('[3Shape] OAuth tokens stored');
}

let refreshInFlight: Promise<string> | null = null;

async function runRefresh(refreshToken: string): Promise<string> {
  const c = requireOAuthConfig();
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: c.clientId,
  });
  try {
    await persist(await postToken(body), refreshToken);
  } catch (err) {
    if (err instanceof ThreeShapeError && err.code === 'invalid_grant') {
      // Refresh token revoked/expired — drop everything and force a re-login.
      await clearThreeShapeTokens();
      throw new ThreeShapeError(
        'reconnect_required',
        'The 3Shape session is no longer valid — reconnect in Settings → Integrations.'
      );
    }
    throw err;
  }
  const fresh = await getThreeShapeTokens();
  if (!fresh) {
    throw new ThreeShapeError('reconnect_required', 'Reconnect to 3Shape in Settings → Integrations.');
  }
  log.info('[3Shape] access token refreshed');
  return fresh.accessToken;
}

/** A live access token, refreshing (once, shared across callers) when near expiry. */
export async function getValidAccessToken(): Promise<string> {
  const tokens = await getThreeShapeTokens();
  if (!tokens) {
    throw new ThreeShapeError('not_connected', 'Not connected to 3Shape — connect in Settings → Integrations.');
  }
  if (Date.now() < tokens.expiresAt.getTime() - EXPIRY_SKEW_MS) {
    return tokens.accessToken;
  }
  if (!tokens.refreshToken) {
    throw new ThreeShapeError(
      'reconnect_required',
      'The 3Shape session expired — reconnect in Settings → Integrations.'
    );
  }
  if (!refreshInFlight) {
    refreshInFlight = runRefresh(tokens.refreshToken).finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

export interface ThreeShapeStatus {
  /** clientId + Web Service URL both set. */
  configured: boolean;
  /** A refreshable grant is stored (does NOT ping the workstation). */
  connected: boolean;
  /** Access-token expiry as ISO string, or null. */
  expiresAt: string | null;
  /** Granted scopes, or null. */
  scopes: string | null;
}

/** Status for the Settings → Integrations card. Deliberately no live WORK_PC call. */
export async function getStatus(): Promise<ThreeShapeStatus> {
  const c = config.threeshape;
  const tokens = await getThreeShapeTokens();
  return {
    configured: Boolean(c.clientId && c.webServiceBase),
    // A row with no refresh token is NOT connected: once its access token expires,
    // getValidAccessToken() throws reconnect_required on every call. Reporting "Connected" there
    // left staff with no reason to click the one button that fixes it. Matches Drive/Contacts.
    connected: Boolean(tokens?.refreshToken),
    expiresAt: tokens ? tokens.expiresAt.toISOString() : null,
    scopes: tokens?.scope ?? null,
  };
}

/** Disconnect — drop the stored tokens. */
export async function disconnect(): Promise<void> {
  await clearThreeShapeTokens();
  log.info('[3Shape] disconnected (tokens cleared)');
}
