/**
 * Tests for the shared OAuth helpers.
 *
 * `isInvalidGrantError` previously existed as byte-identical copies in the Drive and Contacts
 * modules. The failure mode of that duplication is specific: whichever copy learns a new gaxios
 * error shape first, the others keep classifying a REVOKED grant as transient — so their Settings
 * card goes on claiming "Connected" while every call fails, which this codebase already shipped
 * once. One implementation, one set of tests.
 */
import { describe, expect, it } from 'vitest';
import { credentialsToTokenRow, generateState, isInvalidGrantError } from './oauth.js';

describe('isInvalidGrantError', () => {
  it('detects the structured gaxios shape', () => {
    const err = Object.assign(new Error('Request failed'), {
      response: { data: { error: 'invalid_grant' } },
    });
    expect(isInvalidGrantError(err)).toBe(true);
  });

  it('detects it in the message when the response body is absent', () => {
    expect(isInvalidGrantError(new Error('invalid_grant: Token has been expired or revoked.'))).toBe(true);
    expect(isInvalidGrantError(new Error('Invalid_Grant'))).toBe(true);
  });

  it('does NOT fire on an unrelated failure (which must stay retryable)', () => {
    expect(isInvalidGrantError(new Error('ECONNRESET'))).toBe(false);
    expect(
      isInvalidGrantError(
        Object.assign(new Error('nope'), { response: { data: { error: 'invalid_client' } } })
      )
    ).toBe(false);
  });

  it('tolerates non-Error values', () => {
    expect(isInvalidGrantError('invalid_grant')).toBe(false);
    expect(isInvalidGrantError(null)).toBe(false);
    expect(isInvalidGrantError(undefined)).toBe(false);
  });
});

describe('credentialsToTokenRow', () => {
  it('maps a full credentials object', () => {
    const row = credentialsToTokenRow({
      access_token: 'at',
      refresh_token: 'rt',
      token_type: 'Bearer',
      scope: 'a b',
      expiry_date: 1_700_000_000_000,
    });
    expect(row).toEqual({
      accessToken: 'at',
      refreshToken: 'rt',
      tokenType: 'Bearer',
      scope: 'a b',
      expiresAt: new Date(1_700_000_000_000),
    });
  });

  it('keeps the existing refresh token when a refresh does not rotate one', () => {
    // Google emits refresh_token only on the initial grant; without the fallback a plain
    // access-token refresh would persist null and orphan the grant.
    expect(credentialsToTokenRow({ access_token: 'at2' }, 'existing-rt').refreshToken).toBe('existing-rt');
  });

  it('prefers a freshly-issued refresh token over the fallback', () => {
    expect(credentialsToTokenRow({ refresh_token: 'rotated' }, 'old').refreshToken).toBe('rotated');
  });

  it('defaults an absent expiry to roughly an hour out', () => {
    const before = Date.now();
    const { expiresAt } = credentialsToTokenRow({ access_token: 'at' });
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + 3_599_000);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 3_600_000);
  });

  it('defaults token_type and nulls a missing scope', () => {
    const row = credentialsToTokenRow({});
    expect(row.tokenType).toBe('Bearer');
    expect(row.scope).toBeNull();
    expect(row.refreshToken).toBeNull();
  });
});

describe('generateState', () => {
  it('is URL-safe and unguessable', () => {
    const s = generateState();
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(s.length).toBeGreaterThanOrEqual(22); // 16 bytes base64url
    expect(new Set(Array.from({ length: 50 }, generateState)).size).toBe(50);
  });
});
