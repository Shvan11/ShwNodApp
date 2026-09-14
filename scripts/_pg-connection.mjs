/**
 * The ONE place the DB scripts resolve a local PostgreSQL connection.
 *
 * WHY THIS EXISTS: `config/pg-connection.ts` is the app's documented SSoT and accepts
 * `DATABASE_URL` **or** the discrete `PG_*` block, with the discrete vars winning PER FIELD
 * (CLAUDE.md). The scripts did neither consistently — seven of them read `PG_*` only (so on a
 * DATABASE_URL-only deployment they connected with `host: undefined` and fell back to libpq's
 * defaults: localhost / the unix socket / `$PGDATABASE`), and two read the URL FIRST, inverting the
 * app's precedence. `db-migrate-check.mjs` is wired as `predb:migrate`, so the guard rail built
 * after the 2026-07-30 ledger near-miss could certify one database while `db:migrate` wrote to
 * another. This helper makes every script agree with the app.
 *
 * MIRROR NOTE: this is a hand-kept JS mirror of `resolvePgConnection` in
 * `config/pg-connection.ts` (the scripts are plain `.mjs` run by bare `node`, so they cannot import
 * the TypeScript module). `config/pg-connection.test.ts` asserts the two agree field-for-field —
 * change one and that test tells you to change the other.
 */
import dotenv from 'dotenv';

// Scripts are run directly by `node`, not through config/config.ts, so they must load .env
// themselves. `quiet` suppresses dotenv 17's banner (which would pollute eval'd script output).
dotenv.config({ path: '.env', quiet: true });
if (process.env.NODE_ENV === 'development') {
  dotenv.config({ path: '.env.development', override: true, quiet: true });
}

/** Parse the pieces we need out of a libpq URI. Never throws — an unparseable value yields {}. */
export function parseDatabaseUrl(url) {
  if (!url) return {};
  try {
    const u = new URL(url);
    const port = u.port ? Number.parseInt(u.port, 10) : undefined;
    const database = decodeURIComponent(u.pathname.replace(/^\//, ''));
    return {
      host: u.hostname ? decodeURIComponent(u.hostname) : undefined,
      port: Number.isFinite(port) ? port : undefined,
      database: database || undefined,
      user: u.username ? decodeURIComponent(u.username) : undefined,
      password: u.password ? decodeURIComponent(u.password) : undefined,
      sslmode: u.searchParams.get('sslmode') ?? undefined,
      application_name: u.searchParams.get('application_name') ?? undefined,
    };
  } catch {
    return {};
  }
}

/** libpq `sslmode` → what `pg` understands. `undefined` = don't pass the key at all. */
export function sslFromMode(mode) {
  switch (String(mode ?? '').trim().toLowerCase()) {
    case '':
    case 'allow':
    case 'prefer':
      return undefined;
    case 'disable':
      return false;
    case 'require':
      return { rejectUnauthorized: false };
    case 'verify-ca':
    case 'verify-full':
      return { rejectUnauthorized: true };
    default:
      return undefined;
  }
}

/** Resolve the LOCAL connection exactly as the app does. Discrete `PG_*` win per field. */
export function resolveLocalPg(env = process.env) {
  const url = parseDatabaseUrl(env.DATABASE_URL);
  const portRaw = env.PG_PORT ? Number.parseInt(env.PG_PORT, 10) : NaN;
  const port = Number.isFinite(portRaw) ? portRaw : undefined;
  const ssl = sslFromMode(env.PG_SSLMODE || env.PGSSLMODE || url.sslmode);
  const applicationName = env.PG_APPLICATION_NAME || url.application_name;

  return {
    host: env.PG_HOST || url.host || 'localhost',
    port: port ?? url.port ?? 5432,
    database: env.PG_DATABASE || url.database || 'shwan_test',
    user: env.PG_USER || url.user || 'shwan_app',
    password: env.PG_PASSWORD || url.password || '',
    ...(ssl === undefined ? {} : { ssl }),
    ...(applicationName ? { application_name: applicationName } : {}),
  };
}

/** The same connection as a libpq URI (for tools that take a connection string, e.g. pg_dump). */
export function localPgUrl(env = process.env) {
  const c = resolveLocalPg(env);
  const enc = encodeURIComponent;
  return `postgres://${enc(c.user)}:${enc(c.password)}@${c.host}:${c.port}/${enc(c.database)}`;
}
