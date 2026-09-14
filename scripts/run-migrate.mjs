/**
 * `node-pg-migrate` launcher that resolves the database the SAME way the app and
 * `npm run db:check` do.  `npm run db:migrate [-- <extra args>]`
 *
 * WHY THIS EXISTS: `db:migrate` used to be a bare `node-pg-migrate up -m migrations/pg`.
 * node-pg-migrate bundles its own dotenv and reads `DATABASE_URL` (plus libpq's `PGHOST`
 * family) — it knows nothing about this app's discrete `PG_*` block or about
 * `.env.development`. The guard wired as `predb:migrate` (`scripts/db-migrate-check.mjs`)
 * resolves through `scripts/_pg-connection.mjs` instead, where discrete `PG_*` win per
 * field. Two resolvers, one command: on any machine where they disagree the guard
 * certifies one database while the migrator writes another — which is exactly the hazard
 * the 2026-07-30 ledger near-miss produced the guard for, one layer down.
 *
 * Concretely, without this file:
 *   - a deployment with only `PG_*` set (no `DATABASE_URL`) has the guard check the real
 *     clinic DB while node-pg-migrate silently falls back to libpq defaults — localhost,
 *     the unix socket, `$PGDATABASE`, `$USER`;
 *   - with `NODE_ENV=development`, `_pg-connection.mjs` applies `.env.development` as an
 *     override and node-pg-migrate does not, so the two can name different databases.
 *
 * So: resolve once, here, and hand node-pg-migrate a fully-specified `DATABASE_URL`.
 * dotenv never overrides an already-set variable, so its own load is then a no-op.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { resolveLocalPg, localPgUrl } from './_pg-connection.mjs';

// Resolve the CLI through the package root rather than by path: node-pg-migrate's
// `exports` map rewrites "./bin/*" to "./bin/*.js", so asking for the file by its real
// name resolves to `node-pg-migrate.js.js`. package.json is always exported.
const require = createRequire(import.meta.url);
const pkgRoot = dirname(require.resolve('node-pg-migrate/package.json'));
const bin = join(pkgRoot, require('node-pg-migrate/package.json').bin['node-pg-migrate']);

const target = resolveLocalPg();
// Host/port/database only — never the URL itself, which carries the password.
console.log(`▶ migrating ${target.user}@${target.host}:${target.port}/${target.database}`);

const args = process.argv.slice(2);
// Default to this repo's migration directory unless the caller named one.
if (!args.includes('-m') && !args.includes('--migrations-dir')) args.push('-m', 'migrations/pg');

const child = spawn(process.execPath, [bin, ...args], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: localPgUrl() },
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
child.on('error', (err) => {
  console.error(`✗ could not start node-pg-migrate: ${err.message}`);
  process.exit(1);
});
