/**
 * READ-ONLY migration-ledger drift detector.  `npm run db:check`
 *
 * This exists because of a near-miss on 2026-07-30: the `pgmigrations` ledger held 20
 * rows naming files that had been deleted, while all 21 files actually on disk —
 * including a full 4,466-line schema baseline — were unrecorded. `db:migrate` was
 * therefore one `--no-check-order` away from replaying the entire schema over a live
 * clinic database. Nothing in the toolchain reported that state; this script does.
 *
 * Run it before and after any migration work, and on any deployment that looks off.
 * Exits non-zero on drift so it can gate a deploy script.
 *
 * It never writes. To REPAIR a ledger that lost its rows, use db-baseline-stamp.mjs.
 */
import { readdirSync } from 'node:fs';
import pg from 'pg';

const MIGRATIONS_DIR = 'migrations/pg';

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => f.replace(/\.sql$/, ''))
  .sort();

const c = new pg.Client({
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT ?? 5432),
  database: process.env.PG_DATABASE,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
});
await c.connect();

const { rows: ledgerExists } = await c.query(
  `SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'pgmigrations'`
);
if (ledgerExists.length === 0) {
  console.error('✗ no pgmigrations table — this database has never been migrated.');
  await c.end();
  process.exit(1);
}

const { rows } = await c.query(`SELECT name, run_on FROM pgmigrations ORDER BY id`);
await c.end();

const recorded = rows.map((r) => r.name).sort();
const recordedSet = new Set(recorded);
const fileSet = new Set(files);
const highWater = recorded.at(-1) ?? ''; // newest APPLIED migration

const ghosts = recorded.filter((n) => !fileSet.has(n)); // in ledger, file gone
const unrecorded = files.filter((n) => !recordedSet.has(n)); // on disk, never recorded

// An unrecorded file is only NORMAL if it sorts after everything already applied —
// that is a migration waiting its turn. One that sorts BEFORE the high-water mark was
// either applied out-of-band or slipped in behind history, and running it is unsafe.
const pending = unrecorded.filter((n) => n > highWater);
const behind = unrecorded.filter((n) => n <= highWater);

console.log(`migration files on disk : ${files.length}`);
console.log(`rows in pgmigrations    : ${recorded.length}`);

let bad = false;

if (ghosts.length) {
  bad = true;
  console.error(`\n✗ ${ghosts.length} GHOST row(s) — recorded as applied but the file no longer exists:`);
  ghosts.forEach((n) => console.error(`    ${n}`));
  console.error('  → history was rewritten (squashed/deleted) without re-stamping the ledger.');
  console.error('  → fix: npm run db:baseline:stamp');
}

if (behind.length) {
  bad = true;
  console.error(`\n✗ ${behind.length} file(s) UNRECORDED but older than the newest applied migration`);
  console.error(`  (high-water mark: ${highWater}):`);
  behind.forEach((n) => console.error(`    ${n}`));
  console.error('  → `db:migrate` would try to RUN these. If their DDL is already in the database');
  console.error('    (applied out-of-band) that can be destructive — this is how a full schema');
  console.error('    baseline ends up replaying over a live clinic. Verify before migrating.');
}

if (ghosts.length && recorded.length && unrecorded.length === files.length) {
  console.error('\n✗✗ DISJOINT ledger: nothing on disk is recorded and nothing recorded is on disk.');
  console.error('   This is the 2026-07-30 failure mode. Do NOT run db:migrate.');
  console.error('   Fix: squash to a verified baseline, then `npm run db:baseline:stamp`.');
}

if (!bad) {
  if (pending.length) {
    console.log(`\n✓ ledger consistent — ${pending.length} migration(s) pending, all newer than history:`);
    pending.forEach((n) => console.log(`    ${n}`));
    console.log('  `npm run db:migrate` will apply them.');
  } else {
    console.log(`\n✓ ledger matches disk — ${files.length} file(s), all recorded, no ghosts.`);
    const last = rows.at(-1);
    if (last) console.log(`  latest: ${last.name} (applied ${new Date(last.run_on).toISOString().slice(0, 10)})`);
    console.log('  `npm run db:migrate` is safe to run and will be a no-op.');
  }
}

if (bad) {
  console.error('\nRefusing to certify this ledger. `npm run db:migrate` runs this check first');
  console.error('(predb:migrate) and will not proceed until the drift above is resolved.');
}

process.exitCode = bad ? 1 : 0;
