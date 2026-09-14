/**
 * Dump the live PostgreSQL schema to stdout via pg_dump.
 *
 * Used to author a squashed baseline migration (see migrations/pg/*_baseline-*.sql).
 * Credentials come from the environment (run with `node --env-file=.env`) and are
 * passed to pg_dump through PGPASSWORD, never on the command line.
 *
 *   node --env-file=.env scripts/db-baseline-dump.mjs           > out.sql   # local
 *   node --env-file=.env scripts/db-baseline-dump.mjs --db=NAME > out.sql   # other db
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolveLocalPg } from './_pg-connection.mjs';

const PG_DUMP_CANDIDATES = [
  'C:/Program Files/PostgreSQL/18/bin/pg_dump.exe',
  'C:/Program Files/PostgreSQL/17/bin/pg_dump.exe',
  'pg_dump',
];
const pgDump = PG_DUMP_CANDIDATES.find((p) => p === 'pg_dump' || existsSync(p));
if (!pgDump) {
  console.error('pg_dump not found — checked:\n  ' + PG_DUMP_CANDIDATES.join('\n  '));
  process.exit(2);
}

// Connection resolved the way the app does it (DATABASE_URL or PG_*, discrete wins
// per field) — see scripts/_pg-connection.mjs.
const LOCAL = resolveLocalPg();
const dbArg = process.argv.find((a) => a.startsWith('--db='));
const database = dbArg ? dbArg.slice('--db='.length) : LOCAL.database;

const args = [
  '--schema-only',
  '--no-owner', // portable across deployments: no ALTER ... OWNER TO shwan_app
  '--no-privileges', // GRANTs are a per-deployment concern, not app schema
  // Deliberately NO `--schema=public`: extensions are DATABASE-level objects, so that
  // filter silently drops the `CREATE EXTENSION citext / pg_trgm` lines — and citext
  // columns + trigram indexes make those mandatory for a fresh install.
  '-h', LOCAL.host,
  '-p', String(LOCAL.port),
  '-U', LOCAL.user,
  '-d', database,
];

const r = spawnSync(pgDump, args.filter((a) => a !== '--no-comments=false'), {
  env: { ...process.env, PGPASSWORD: LOCAL.password },
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});

if (r.error) {
  console.error(`failed to run ${pgDump}: ${r.error.message}`);
  process.exit(2);
}
if (r.status !== 0) {
  console.error(r.stderr || `pg_dump exited ${r.status}`);
  process.exit(r.status ?? 1);
}
process.stdout.write(r.stdout);
