/**
 * Tests for the Google Contacts phone-book cache.
 *
 * Without it, every open of a recipient dropdown re-crawled the account's entire connections list
 * (pageSize 1000, every page) after a token refresh — seconds of latency and a stack of People API
 * round trips per open, per account, against a per-project quota.
 *
 * The invalidation half matters more than the TTL half: a reconnect can be a DIFFERENT Google
 * account, so serving the previous account's contacts afterwards would be wrong, not merely stale.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONTACTS_CACHE_TTL_MS,
  getCachedContacts,
  invalidateContactsCache,
  setCachedContacts,
} from './contacts-cache.js';

const contacts = (phone: string) => [{ id: 'people/1#0', text: 'Ahmed', phone }];

beforeEach(() => {
  vi.useFakeTimers();
  invalidateContactsCache();
});
afterEach(() => vi.useRealTimers());

describe('contacts cache', () => {
  it('returns nothing for an account never fetched', () => {
    expect(getCachedContacts('shw')).toBeNull();
  });

  it('serves what was stored, within the TTL', () => {
    setCachedContacts('shw', contacts('0770'));
    vi.advanceTimersByTime(CONTACTS_CACHE_TTL_MS - 1);
    expect(getCachedContacts('shw')).toEqual(contacts('0770'));
  });

  it('expires exactly at the TTL', () => {
    setCachedContacts('shw', contacts('0770'));
    vi.advanceTimersByTime(CONTACTS_CACHE_TTL_MS);
    expect(getCachedContacts('shw')).toBeNull();
  });

  it('keeps accounts separate', () => {
    setCachedContacts('shw', contacts('0770'));
    setCachedContacts('cli', contacts('0781'));
    expect(getCachedContacts('shw')?.[0].phone).toBe('0770');
    expect(getCachedContacts('cli')?.[0].phone).toBe('0781');
  });

  it('invalidates one account without touching the other', () => {
    setCachedContacts('shw', contacts('0770'));
    setCachedContacts('cli', contacts('0781'));
    invalidateContactsCache('shw');
    expect(getCachedContacts('shw')).toBeNull();
    expect(getCachedContacts('cli')).not.toBeNull();
  });

  it('invalidates everything when given no account', () => {
    setCachedContacts('shw', contacts('0770'));
    setCachedContacts('cli', contacts('0781'));
    invalidateContactsCache();
    expect(getCachedContacts('shw')).toBeNull();
    expect(getCachedContacts('cli')).toBeNull();
  });

  it('serves the NEW account after a reconnect overwrites the slot', () => {
    setCachedContacts('cli', contacts('0770'));
    invalidateContactsCache('cli'); // what exchangeCode()/disconnect() do
    setCachedContacts('cli', contacts('0781'));
    expect(getCachedContacts('cli')?.[0].phone).toBe('0781');
  });
});
