/**
 * Resolve the PostgreSQL connection settings from the environment.
 *
 * Extracted from config.ts so it is reachable from a unit test — config.ts validates and throws at
 * import time, which makes anything inside it untestable in isolation.
 *
 * WHY THIS EXISTS: the boot schema accepts `DATABASE_URL` *or* the discrete `PG_*` block, and its
 * own failure message tells the operator so. But `config.databasePg` only ever read the discrete
 * vars, with defaults of `localhost:5432`, database `shwan_test`, user `shwan_app`, and an empty
 * password. Since `databasePg` is the single source every pool builds from — the app pool in
 * services/database/kysely.ts AND the reverse CDC sink's own dedicated write pool — a deployment
 * that followed the validator's instructions and set only DATABASE_URL passed validation and then
 * silently connected to those defaults. That is squarely on the commercial multi-deployment path.
 *
 * The URL's QUERY PARAMETERS matter for the same reason. `sslmode` is the one that decides whether
 * the connection is encrypted at all: a deployment pointing DATABASE_URL at a managed PostgreSQL
 * (`?sslmode=require`) would otherwise have had that stripped here and connected in the clear —
 * or, on a server that mandates TLS, failed to connect with a message about the server, not us.
 * `application_name` is carried through too (it is what shows up in `pg_stat_activity`). Everything
 * else in the query string is deliberately ignored; the pool's own timeouts are set in config.ts.
 */

/**
 * What `pg` accepts for `ssl`: `false` (plaintext), or an object controlling CA verification.
 * `undefined` means "don't pass the key at all", i.e. the driver default (no TLS).
 */
export type PgSslSetting = false | { rejectUnauthorized: boolean } | undefined;

export interface PgConnectionSettings {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  /** Present only when an sslmode was given — see `sslFromMode`. */
  ssl?: PgSslSetting;
  /** Present only when set; shows up in `pg_stat_activity.application_name`. */
  application_name?: string;
}

interface PgConnectionParts {
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  sslmode?: string;
  application_name?: string;
}

/** The environment keys this reads — narrowed so a test can pass a plain object. */
export interface PgEnv {
  DATABASE_URL?: string;
  PG_HOST?: string;
  PG_PORT?: string;
  PG_DATABASE?: string;
  PG_USER?: string;
  PG_PASSWORD?: string;
  /** libpq's name, so an operator can set it the way every other PG tool expects. */
  PGSSLMODE?: string;
  PG_SSLMODE?: string;
  PG_APPLICATION_NAME?: string;
}

/**
 * Translate a libpq `sslmode` into what `pg` understands.
 *
 * `require` encrypts but does NOT verify the server certificate (that is exactly libpq's
 * definition); only `verify-ca`/`verify-full` verify. `allow`/`prefer` describe a negotiation the
 * driver cannot perform, so they resolve to no TLS — the same as leaving sslmode unset, which is
 * what a plain local connection wants.
 */
export function sslFromMode(mode: string | undefined, onWarn?: (message: string) => void): PgSslSetting {
  switch ((mode ?? '').trim().toLowerCase()) {
    case '':
      return undefined;
    case 'disable':
      return false;
    case 'allow':
    case 'prefer':
      return undefined;
    case 'require':
      return { rejectUnauthorized: false };
    case 'verify-ca':
    case 'verify-full':
      return { rejectUnauthorized: true };
    default:
      onWarn?.(`Unknown sslmode '${mode}' — connecting without TLS`);
      return undefined;
  }
}

/**
 * Parse the pieces we need out of a libpq URI connection string. Never throws — an unparseable
 * value falls back to the discrete vars (and `onWarn` lets the caller log it), because failing to
 * boot over a malformed optional override would be worse than the fallback.
 */
export function parseDatabaseUrl(
  url: string | undefined,
  onWarn?: (message: string) => void
): PgConnectionParts {
  if (!url) return {};
  try {
    const u = new URL(url);
    const port = u.port ? Number.parseInt(u.port, 10) : undefined;
    const database = decodeURIComponent(u.pathname.replace(/^\//, ''));
    return {
      sslmode: u.searchParams.get('sslmode') ?? undefined,
      application_name: u.searchParams.get('application_name') ?? undefined,
      host: u.hostname ? decodeURIComponent(u.hostname) : undefined,
      port: Number.isFinite(port) ? port : undefined,
      database: database || undefined,
      // Credentials are percent-encoded in a URI, so a password containing `@` or `/` only comes
      // back correct after decoding.
      user: u.username ? decodeURIComponent(u.username) : undefined,
      password: u.password ? decodeURIComponent(u.password) : undefined,
    };
  } catch {
    onWarn?.('DATABASE_URL could not be parsed as a URL — falling back to the PG_* vars');
    return {};
  }
}

/**
 * Merge the two supported forms into one connection.
 *
 * Discrete vars win PER FIELD, so a partial override behaves predictably — e.g. a DATABASE_URL
 * template from a deployment tool alongside a PG_PASSWORD injected from a secret store.
 */
export function resolvePgConnection(
  env: PgEnv,
  onWarn?: (message: string) => void
): PgConnectionSettings {
  const url = parseDatabaseUrl(env.DATABASE_URL, onWarn);
  const portRaw = env.PG_PORT ? Number.parseInt(env.PG_PORT, 10) : NaN;
  const port = Number.isFinite(portRaw) ? portRaw : undefined;
  const sslmode = env.PG_SSLMODE || env.PGSSLMODE || url.sslmode;
  const ssl = sslFromMode(sslmode, onWarn);
  const applicationName = env.PG_APPLICATION_NAME || url.application_name;

  return {
    host: env.PG_HOST || url.host || 'localhost',
    port: port ?? url.port ?? 5432,
    database: env.PG_DATABASE || url.database || 'shwan_test',
    user: env.PG_USER || url.user || 'shwan_app',
    password: env.PG_PASSWORD || url.password || '',
    // Spread-in so an unset mode leaves the keys off entirely and `pg` keeps its own defaults.
    ...(ssl === undefined ? {} : { ssl }),
    ...(applicationName ? { application_name: applicationName } : {}),
  };
}
