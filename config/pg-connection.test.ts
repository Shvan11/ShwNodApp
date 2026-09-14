/**
 * Tests for PostgreSQL connection resolution.
 *
 * The bug these pin: config.ts's boot schema accepts `DATABASE_URL` OR the discrete `PG_*` block
 * and its failure message says so, but `databasePg` only ever read the discrete vars. Since that
 * object is what every pg pool is built from — the app pool AND the reverse CDC sink's dedicated
 * write pool — a DATABASE_URL-only deployment booted clean and then silently connected to
 * `localhost:5432/shwan_test` as `shwan_app` with an empty password.
 */
import { describe, expect, it, vi } from 'vitest';
import { parseDatabaseUrl, resolvePgConnection, sslFromMode } from './pg-connection.js';
// The DB scripts are plain .mjs run by bare `node`, so they cannot import the TS
// module above; scripts/_pg-connection.mjs is a hand-kept mirror of it. This import
// is what keeps the two honest — see the drift test at the bottom of this file.
import { resolveLocalPg } from '../scripts/_pg-connection.mjs';

describe('resolvePgConnection', () => {
  it('uses DATABASE_URL when only it is set — the regression', () => {
    expect(
      resolvePgConnection({ DATABASE_URL: 'postgres://app_user:s3cret@db.internal:6543/clinic' })
    ).toEqual({
      host: 'db.internal',
      port: 6543,
      database: 'clinic',
      user: 'app_user',
      password: 's3cret',
    });
  });

  it('uses the discrete PG_* block when only it is set', () => {
    expect(
      resolvePgConnection({
        PG_HOST: '127.0.0.1',
        PG_PORT: '5432',
        PG_DATABASE: 'shwan',
        PG_USER: 'shwan_app',
        PG_PASSWORD: 'pw',
      })
    ).toEqual({ host: '127.0.0.1', port: 5432, database: 'shwan', user: 'shwan_app', password: 'pw' });
  });

  it('lets a discrete var win PER FIELD over DATABASE_URL', () => {
    // The deployment shape this supports: a URL template from the deploy tool, with the password
    // injected separately from a secret store.
    const resolved = resolvePgConnection({
      DATABASE_URL: 'postgres://app_user:placeholder@db.internal:6543/clinic',
      PG_PASSWORD: 'from-secret-store',
    });
    expect(resolved.password).toBe('from-secret-store');
    expect(resolved.host).toBe('db.internal');
    expect(resolved.database).toBe('clinic');
  });

  it('falls back to the local defaults when nothing is set', () => {
    expect(resolvePgConnection({})).toEqual({
      host: 'localhost',
      port: 5432,
      database: 'shwan_test',
      user: 'shwan_app',
      password: '',
    });
  });

  it('defaults the port to 5432 when the URL omits it', () => {
    expect(resolvePgConnection({ DATABASE_URL: 'postgres://u:p@host/db' }).port).toBe(5432);
  });

  it('ignores a non-numeric PG_PORT rather than yielding NaN', () => {
    // NaN is not nullish, so a naive `?? url.port` would have propagated it into the pool.
    expect(resolvePgConnection({ PG_PORT: 'not-a-port', DATABASE_URL: 'postgres://u:p@h:7000/d' }).port)
      .toBe(7000);
    expect(resolvePgConnection({ PG_PORT: '' }).port).toBe(5432);
  });
});

describe('sslmode handling', () => {
  it('carries sslmode out of the DATABASE_URL query string', () => {
    // Previously every query parameter was parsed away, so a managed-PG deployment
    // that asked for TLS connected in the clear.
    expect(
      resolvePgConnection({ DATABASE_URL: 'postgres://u:p@db.example:5432/clinic?sslmode=require' })
    ).toMatchObject({ host: 'db.example', ssl: { rejectUnauthorized: false } });
  });

  it('verifies the certificate only for verify-ca/verify-full', () => {
    expect(sslFromMode('require')).toEqual({ rejectUnauthorized: false });
    expect(sslFromMode('verify-ca')).toEqual({ rejectUnauthorized: true });
    expect(sslFromMode('verify-full')).toEqual({ rejectUnauthorized: true });
    expect(sslFromMode('disable')).toBe(false);
    expect(sslFromMode('prefer')).toBeUndefined();
    expect(sslFromMode(undefined)).toBeUndefined();
  });

  it('warns on an unknown sslmode instead of guessing', () => {
    const onWarn = vi.fn();
    expect(sslFromMode('sortof', onWarn)).toBeUndefined();
    expect(onWarn).toHaveBeenCalledOnce();
  });

  it('omits the ssl key entirely when no mode is given', () => {
    expect(resolvePgConnection({ PG_HOST: 'localhost' })).not.toHaveProperty('ssl');
  });

  it('lets PG_SSLMODE win over the URL, like every other field', () => {
    expect(
      resolvePgConnection({
        DATABASE_URL: 'postgres://u:p@db.example/clinic?sslmode=require',
        PG_SSLMODE: 'disable',
      })
    ).toMatchObject({ ssl: false });
  });

  it('carries application_name through', () => {
    expect(
      resolvePgConnection({ DATABASE_URL: 'postgres://u:p@db.example/clinic?application_name=shwan' })
    ).toMatchObject({ application_name: 'shwan' });
  });
});

describe('parseDatabaseUrl', () => {
  it('percent-decodes credentials so a password with @ or / survives', () => {
    const parts = parseDatabaseUrl('postgres://us%40er:p%2Fss%40word@h:5432/db');
    expect(parts.user).toBe('us@er');
    expect(parts.password).toBe('p/ss@word');
  });

  it('warns and falls back instead of throwing on a malformed URL', () => {
    const onWarn = vi.fn();
    expect(parseDatabaseUrl('not a url', onWarn)).toEqual({});
    expect(onWarn).toHaveBeenCalledOnce();
  });

  it('returns nothing for an absent URL, without warning', () => {
    const onWarn = vi.fn();
    expect(parseDatabaseUrl(undefined, onWarn)).toEqual({});
    expect(onWarn).not.toHaveBeenCalled();
  });
});

describe('scripts/_pg-connection.mjs mirrors config/pg-connection.ts', () => {
  // The seven DB scripts used to read PG_* only (so a DATABASE_URL-only deployment
  // silently got libpq's defaults) and two read the URL FIRST, inverting the app's
  // precedence — including `db-migrate-check.mjs`, which is wired as `predb:migrate`
  // and could therefore certify a DIFFERENT database than `db:migrate` writes to.
  // They all call `resolveLocalPg` now; these cases pin it to the app's resolver.
  const cases: Array<Record<string, string>> = [
    { DATABASE_URL: 'postgres://app_user:s3cret@db.internal:6543/clinic' },
    { PG_HOST: '127.0.0.1', PG_PORT: '5432', PG_DATABASE: 'shwan', PG_USER: 'shwan_app', PG_PASSWORD: 'pw' },
    { DATABASE_URL: 'postgres://u:p@db.example:5432/clinic?sslmode=require', PG_PASSWORD: 'from-secret-store' },
    { DATABASE_URL: 'postgres://u:p@db.example/clinic?sslmode=verify-full&application_name=shwan' },
    { PG_HOST: 'h', PG_PORT: 'not-a-number', PG_DATABASE: 'd', PG_USER: 'u', PG_PASSWORD: 'p' },
    {},
  ];

  it.each(cases)('agrees field-for-field on %o', (env) => {
    expect(resolveLocalPg(env)).toEqual(resolvePgConnection(env));
  });
});
