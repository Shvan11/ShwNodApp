/**
 * Types for the scripts' PG connection resolver (the .mjs mirror of
 * `config/pg-connection.ts`). Exists so `config/pg-connection.test.ts` — the test that
 * pins the mirror against the app's resolver — can import it under `strict`.
 */
export interface ScriptPgConnection {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: false | { rejectUnauthorized: boolean };
  application_name?: string;
}

export function parseDatabaseUrl(url: string | undefined): {
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  sslmode?: string;
  application_name?: string;
};

export function sslFromMode(mode: string | undefined): false | { rejectUnauthorized: boolean } | undefined;

export function resolveLocalPg(env?: Record<string, string | undefined>): ScriptPgConnection;

export function localPgUrl(env?: Record<string, string | undefined>): string;
