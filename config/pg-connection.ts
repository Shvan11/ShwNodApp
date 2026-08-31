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
 */

export interface PgConnectionSettings {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

interface PgConnectionParts {
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
}

/** The environment keys this reads — narrowed so a test can pass a plain object. */
export interface PgEnv {
  DATABASE_URL?: string;
  PG_HOST?: string;
  PG_PORT?: string;
  PG_DATABASE?: string;
  PG_USER?: string;
  PG_PASSWORD?: string;
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

  return {
    host: env.PG_HOST || url.host || 'localhost',
    port: port ?? url.port ?? 5432,
    database: env.PG_DATABASE || url.database || 'shwan_test',
    user: env.PG_USER || url.user || 'shwan_app',
    password: env.PG_PASSWORD || url.password || '',
  };
}
