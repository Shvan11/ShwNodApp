/**
 * Telegram MTProto user-login manager (for Settings → Integrations).
 *
 * Re-authenticating the clinic's Telegram *user account* (the one `sendgramfile`
 * uploads through) is an interactive flow: request a code → submit the code →
 * optionally a 2FA password. The same connected `TelegramClient` must survive
 * across those HTTP requests (the `phoneCodeHash` is bound to it), so we hold a
 * single in-progress login at module scope. On success the resulting session
 * string is persisted via `setGramSession` (the `options` table) so the sender
 * picks it up with no env change / restart.
 *
 * Admin-only — wired behind `authorize(['admin'])` in the route.
 */
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { computeCheck } from 'telegram/Password.js';
import config from '../../config/config.js';
import { log } from '../../utils/logger.js';
import { getGramSession, setGramSession, clearGramSession } from './telegram.js';

export interface TelegramAccount {
  username: string | null;
  phone: string | null;
  firstName: string | null;
}

export interface TelegramStatus {
  /** API id/hash present (without these nothing Telegram works). */
  configured: boolean;
  /** A session string is stored. */
  hasSession: boolean;
  /** The stored session is currently authorized (verified live). */
  authorized: boolean;
  account: TelegramAccount | null;
  /** A login is mid-flow (code/password awaited). */
  pending: boolean;
  error: string | null;
}

interface PendingAuth {
  client: TelegramClient;
  phoneNumber: string;
  phoneCodeHash: string;
  createdAt: number;
}

// A single in-progress login at a time is plenty for an admin tool.
let pending: PendingAuth | null = null;
const PENDING_TTL_MS = 5 * 60 * 1000;

function creds(): { apiId: number; apiHash: string } | null {
  const apiId = config.telegram.apiId;
  const apiHash = config.telegram.apiHash;
  if (!apiId || !apiHash) return null;
  return { apiId, apiHash };
}

function newClient(session: string): TelegramClient {
  const c = creds();
  if (!c) {
    throw new Error(
      'Telegram API credentials are not configured (TELEGRAM_API_ID / TELEGRAM_API_HASH).'
    );
  }
  return new TelegramClient(new StringSession(session), c.apiId, c.apiHash, {
    connectionRetries: 3,
    timeout: 20000,
    autoReconnect: false, // one-shot clients — no background update loop to leak
    requestRetries: 2,
  });
}

/** Fully tear a client down (destroy stops the update loop, unlike disconnect). */
async function teardown(client: TelegramClient): Promise<void> {
  try {
    await Promise.race([
      client.destroy(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('destroy timeout')), 5000)),
    ]);
  } catch (err) {
    log.warn('[TelegramAuth] client teardown issue', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function getAccount(client: TelegramClient): Promise<TelegramAccount> {
  const me = (await client.getMe()) as Api.User;
  return {
    username: me.username ?? null,
    phone: me.phone ?? null,
    firstName: me.firstName ?? null,
  };
}

function humanizeAuthError(raw: string): string {
  const msg = raw || 'Unknown error';
  if (msg.includes('PHONE_NUMBER_INVALID'))
    return 'Invalid phone number. Include the country code (e.g. +9647XXXXXXXX).';
  if (msg.includes('PHONE_CODE_INVALID')) return 'The code you entered is incorrect.';
  if (msg.includes('PHONE_CODE_EXPIRED')) return 'The code expired — request a new one.';
  if (msg.includes('PASSWORD_HASH_INVALID')) return 'Incorrect two-factor password.';
  if (msg.includes('SESSION_PASSWORD_NEEDED')) return 'Two-factor password required.';
  if (msg.includes('AUTH_KEY_UNREGISTERED'))
    return 'The saved session is no longer authorized — please log in again.';
  if (msg.includes('FLOOD_WAIT')) return 'Too many attempts. Wait a while before trying again.';
  return msg;
}

function requirePending(): PendingAuth {
  if (!pending) throw new Error('No login in progress — request a code first.');
  if (Date.now() - pending.createdAt > PENDING_TTL_MS) {
    void cancelLogin();
    throw new Error('Login timed out — request a new code.');
  }
  return pending;
}

/** Save the session from a completed login and clean up the pending client. */
async function finalize(p: PendingAuth): Promise<TelegramAccount | null> {
  let account: TelegramAccount | null = null;
  try {
    account = await getAccount(p.client);
  } catch {
    /* account fetch is best-effort; the session is already valid */
  }
  const sessionString = String(p.client.session.save());
  await setGramSession(sessionString);
  await teardown(p.client);
  pending = null;
  log.info('[TelegramAuth] login complete; session persisted', {
    username: account?.username ?? null,
  });
  return account;
}

/** Live status for the Integrations panel. Verifies the stored session if present. */
export async function getStatus(): Promise<TelegramStatus> {
  const configured = creds() !== null;
  const session = await getGramSession();
  const hasSession = Boolean(session);
  const base: TelegramStatus = {
    configured,
    hasSession,
    authorized: false,
    account: null,
    pending: pending !== null,
    error: null,
  };
  if (!configured || !hasSession) return base;

  let client: TelegramClient | null = null;
  try {
    client = newClient(session);
    await client.connect();
    const account = await getAccount(client);
    return { ...base, authorized: true, account };
  } catch (err) {
    return { ...base, error: humanizeAuthError(err instanceof Error ? err.message : String(err)) };
  } finally {
    if (client) await teardown(client);
  }
}

/** Step 1 — request a login code for `phoneNumber` (international format). */
export async function startLogin(phoneNumber: string): Promise<void> {
  const c = creds();
  if (!c) {
    throw new Error(
      'Telegram API credentials are not configured (TELEGRAM_API_ID / TELEGRAM_API_HASH).'
    );
  }
  const phone = (phoneNumber || '').trim();
  if (!phone) throw new Error('Phone number is required.');

  await cancelLogin(); // drop any stale in-flight login

  const client = newClient('');
  try {
    await client.connect();
    const { phoneCodeHash } = await client.sendCode(
      { apiId: c.apiId, apiHash: c.apiHash },
      phone
    );
    const pendingEntry = { client, phoneNumber: phone, phoneCodeHash, createdAt: Date.now() };
    pending = pendingEntry;
    // Auto-teardown if the admin abandons the login without submitting a code.
    setTimeout(() => { if (pending === pendingEntry) void cancelLogin(); }, PENDING_TTL_MS);
    log.info('[TelegramAuth] login code requested', { phone });
  } catch (err) {
    await teardown(client);
    throw new Error(humanizeAuthError(err instanceof Error ? err.message : String(err)), {
      cause: err,
    });
  }
}

/** Step 2 — submit the received code. May report that a 2FA password is needed. */
export async function submitCode(
  code: string
): Promise<{ authorized: boolean; passwordNeeded: boolean; account: TelegramAccount | null }> {
  const p = requirePending();
  const phoneCode = (code || '').trim();
  if (!phoneCode) throw new Error('Code is required.');

  try {
    await p.client.invoke(
      new Api.auth.SignIn({
        phoneNumber: p.phoneNumber,
        phoneCodeHash: p.phoneCodeHash,
        phoneCode,
      })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('SESSION_PASSWORD_NEEDED')) {
      return { authorized: false, passwordNeeded: true, account: null };
    }
    throw new Error(humanizeAuthError(msg), { cause: err });
  }
  const account = await finalize(p);
  return { authorized: true, passwordNeeded: false, account };
}

/** Step 3 (only if 2FA enabled) — submit the cloud password. */
export async function submitPassword(
  password: string
): Promise<{ authorized: boolean; account: TelegramAccount | null }> {
  const p = requirePending();
  if (!password) throw new Error('Password is required.');

  try {
    const pwd = await p.client.invoke(new Api.account.GetPassword());
    const check = await computeCheck(pwd, password);
    await p.client.invoke(new Api.auth.CheckPassword({ password: check }));
  } catch (err) {
    throw new Error(humanizeAuthError(err instanceof Error ? err.message : String(err)), {
      cause: err,
    });
  }
  const account = await finalize(p);
  return { authorized: true, account };
}

/** Abort an in-progress login (closes the held client). */
export async function cancelLogin(): Promise<void> {
  if (!pending) return;
  const client = pending.client;
  pending = null;
  await teardown(client);
}

/** Log out: invalidate the session server-side (best effort) and clear it locally. */
export async function logout(): Promise<void> {
  await cancelLogin();
  const session = await getGramSession();
  if (session && creds()) {
    let client: TelegramClient | null = null;
    try {
      client = newClient(session);
      await client.connect();
      await client.invoke(new Api.auth.LogOut());
    } catch (err) {
      log.warn('[TelegramAuth] remote logout failed; clearing local session anyway', {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      if (client) await teardown(client);
    }
  }
  await clearGramSession();
  log.info('[TelegramAuth] session cleared');
}
