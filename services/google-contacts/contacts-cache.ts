/**
 * In-process cache for the Google Contacts phone book, one entry per connected account.
 *
 * Deliberately its OWN module rather than living in contacts.ts: oauth.ts must invalidate the cache
 * whenever a grant changes (connect / disconnect / detected invalid_grant), and contacts.ts already
 * imports oauth.ts — putting the cache in contacts.ts would close an import cycle between the two.
 * ESM tolerates that cycle today only because nothing is used at module top level, which is a
 * fragile thing to rely on. A leaf module with no imports of its own can't participate in one.
 *
 * Scope is per-process and per-account, and the data is a phone book the clinic already has — no
 * cross-tenant concern, and a restart simply re-fetches.
 */
import type { PreparedContact } from './contacts.js';

/**
 * How long a fetched phone book stays good.
 *
 * Every open of a recipient dropdown used to re-crawl the account's ENTIRE connections list —
 * `pageSize: 1000`, every page, after a token refresh — because nothing cached it at any layer.
 * That is seconds of latency and a stack of People API round trips per open, per account, against
 * a quota that is per-project rather than per-clinic once this ships to many centers. A contact
 * list changes on human timescales, so a few minutes of staleness costs nothing; the `refresh`
 * flag bypasses it when someone has just added a number.
 */
export const CONTACTS_CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  at: number;
  contacts: PreparedContact[];
}

const cache = new Map<string, CacheEntry>();

/** The cached phone book for `source`, or null when absent or past its TTL. */
export function getCachedContacts(source: string): PreparedContact[] | null {
  const entry = cache.get(source);
  if (!entry || Date.now() - entry.at >= CONTACTS_CACHE_TTL_MS) return null;
  return entry.contacts;
}

/** Store a freshly-crawled phone book for `source`. */
export function setCachedContacts(source: string, contacts: PreparedContact[]): void {
  cache.set(source, { at: Date.now(), contacts });
}

/**
 * Drop a cached phone book (or all of them). Called whenever a grant changes — a reconnect may be
 * a different Google account entirely, so serving the previous account's contacts would be wrong,
 * not merely stale.
 */
export function invalidateContactsCache(source?: string): void {
  if (source) cache.delete(source);
  else cache.clear();
}
