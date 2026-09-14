/**
 * Prove a squashed baseline is a faithful reproduction of the live schema.
 *
 *   node --env-file=.env scripts/db-baseline-verify.mjs migrations/pg/<baseline>.sql
 *
 * Builds a throwaway database from the baseline's Up section, dumps both schemas, and
 * diffs them. A clean diff is what makes re-stamping the ledger safe: it proves a FRESH
 * deployment built from this one file lands on exactly the schema production runs.
 *
 * Needs a superuser to CREATE DATABASE (the app role has neither SUPERUSER nor
 * CREATEDB). The password is read from disk and passed via PGPASSWORD — never logged.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import pg from 'pg';
import { resolveLocalPg } from './_pg-connection.mjs';

const baselineFile = process.argv[2];
if (!baselineFile) {
  console.error('usage: node --env-file=.env scripts/db-baseline-verify.mjs <baseline.sql>');
  process.exit(2);
}

const SCRATCH = 'shwan_baseline_check';
const SUPER_PW_FILE = 'C:/pg18-migration/super_pw.txt';
const PG_DUMP = 'C:/Program Files/PostgreSQL/18/bin/pg_dump.exe';

if (!existsSync(SUPER_PW_FILE)) {
  console.error(`superuser password file not found: ${SUPER_PW_FILE}`);
  process.exit(2);
}
const superPw = readFileSync(SUPER_PW_FILE, 'utf8').trim();
// Host/port/database come from the same resolution the app uses (DATABASE_URL or
// PG_*, discrete wins per field); the USER here is deliberately the superuser.
const LOCAL = resolveLocalPg();
const HOST = LOCAL.host;
const PORT = LOCAL.port;
const LIVE = LOCAL.database;

const admin = (db) =>
  new pg.Client({ host: HOST, port: PORT, database: db, user: 'postgres', password: superPw });

const dumpSchema = (db) => {
  const r = spawnSync(
    PG_DUMP,
    ['--schema-only', '--no-owner', '--no-privileges', '-h', HOST, '-p', String(PORT), '-U', 'postgres', '-d', db],
    { env: { ...process.env, PGPASSWORD: superPw }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );
  if (r.status !== 0) throw new Error(`pg_dump ${db} failed: ${r.stderr}`);
  return r.stdout;
};

// Comments carry the random \restrict token and "Dumped from database version" noise;
// strip anything that is not an executable statement line so the diff is semantic.
const normalize = (sql) =>
  sql
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter(
      (l) =>
        l.trim() !== '' &&
        !l.startsWith('--') &&
        !l.startsWith('\\restrict') &&
        !l.startsWith('\\unrestrict') &&
        !l.startsWith('SET ') &&
        !l.includes("set_config('search_path'")
    )
    .join('\n');

// ------------------------------------------------------------------ rebuild scratch
let a = admin('postgres');
await a.connect();
await a.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
await a.query(`CREATE DATABASE ${SCRATCH}`);
await a.end();
console.log(`created scratch database ${SCRATCH}`);

// ------------------------------------------------------------------ apply baseline Up
const full = readFileSync(baselineFile, 'utf8');
const upStart = full.indexOf('-- Up Migration');
const downStart = full.indexOf('-- Down Migration');
if (upStart < 0 || downStart < 0) throw new Error('baseline is missing Up/Down markers');
const up = full.slice(upStart + '-- Up Migration'.length, downStart);

let s = admin(SCRATCH);
await s.connect();
let applyError = null;
try {
  await s.query(up);
  console.log('baseline Up applied to scratch database');
} catch (e) {
  applyError = e;
  console.error(`\n✗ baseline FAILED to apply: ${e.message}`);
  if (e.position) {
    const upto = up.slice(0, Number(e.position));
    console.error(`  at line ~${upto.split('\n').length} of the Up section`);
  }
}
await s.end();

if (applyError) {
  const c = admin('postgres');
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
  await c.end();
  process.exit(1);
}

// ------------------------------------------------------------------ diff
const liveDump = normalize(dumpSchema(LIVE));
const scratchDump = normalize(dumpSchema(SCRATCH));

const liveLines = liveDump.split('\n');
const scratchLines = scratchDump.split('\n');
const onlyLive = liveLines.filter((l) => !scratchLines.includes(l));
const onlyScratch = scratchLines.filter((l) => !liveLines.includes(l));

console.log(`\nlive    (${LIVE}): ${liveLines.length} statement lines`);
console.log(`scratch (${SCRATCH}): ${scratchLines.length} statement lines`);

if (onlyLive.length === 0 && onlyScratch.length === 0) {
  console.log('\n✓ IDENTICAL — a fresh database built from this baseline matches production exactly.');
} else {
  console.log(`\n△ differences: ${onlyLive.length} only-in-live, ${onlyScratch.length} only-in-scratch`);
  if (onlyLive.length) console.log('\nONLY IN LIVE:\n' + onlyLive.slice(0, 40).map((l) => '  - ' + l).join('\n'));
  if (onlyScratch.length) console.log('\nONLY IN SCRATCH:\n' + onlyScratch.slice(0, 40).map((l) => '  + ' + l).join('\n'));
}

// ------------------------------------------------------------------ guard test
s = admin(SCRATCH);
await s.connect();
let guardFired = false;
try {
  await s.query(up); // scratch now HAS the schema — the guard must refuse
} catch (e) {
  guardFired = /already has an application schema/.test(e.message);
  console.log(
    guardFired
      ? `\n✓ GUARD works — re-running the baseline over a populated database was refused:\n    "${e.message}"`
      : `\n✗ GUARD did not fire as expected; got: ${e.message}`
  );
}
if (!guardFired) console.log('\n✗ GUARD FAILED — the baseline did not refuse a populated database!');
await s.end();

// ------------------------------------------------------------------ cleanup
const c = admin('postgres');
await c.connect();
await c.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
await c.end();
console.log(`\ndropped scratch database ${SCRATCH}`);

const ok = onlyLive.length === 0 && onlyScratch.length === 0 && guardFired;
process.exitCode = ok ? 0 : 1;
