/**
 * Re-stamp the migration ledger against the squashed baseline.  `npm run db:baseline:stamp`
 *
 * Records the baseline as ALREADY APPLIED without executing a single line of its DDL —
 * the correct repair when a deployment's schema is current but `pgmigrations` does not
 * say so (the 2026-07-30 drift). It is the action the baseline's own guard tells you to
 * take instead of re-running the file.
 *
 * Safety:
 *   - refuses unless the schema really is present (public.patients must exist), so it
 *     can never mark an EMPTY database as migrated;
 *   - refuses if more than one baseline-looking file is present;
 *   - dumps the existing ledger rows to C:\DBBackup before touching them;
 *   - replaces the ledger contents in ONE transaction.
 *
 * Pass --dry-run to see the plan without writing.
 */
import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import pg from 'pg';

const MIGRATIONS_DIR = 'migrations/pg';
const BACKUP_DIR = 'C:/DBBackup';
const dryRun = process.argv.includes('--dry-run');

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => f.replace(/\.sql$/, ''))
  .sort();

const baselines = files.filter((f) => /_baseline-/.test(f));
if (baselines.length !== 1) {
  console.error(
    `expected exactly one *_baseline-* file in ${MIGRATIONS_DIR}, found ${baselines.length}:\n  ` +
      baselines.join('\n  ')
  );
  process.exit(2);
}
const baseline = baselines[0];
// Anything newer than the baseline is a real post-baseline migration and must stay
// unrecorded so db:migrate still applies it.
const postBaseline = files.filter((f) => f > baseline);

const c = new pg.Client({
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT ?? 5432),
  database: process.env.PG_DATABASE,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
});
await c.connect();

const { rows: hasSchema } = await c.query(
  `SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'patients'`
);
if (hasSchema.length === 0) {
  console.error('✗ refusing to stamp: public.patients does not exist, so this database has');
  console.error('  no application schema. An empty database must be built by RUNNING the');
  console.error('  baseline (npm run db:migrate), not by stamping it as applied.');
  await c.end();
  process.exit(1);
}

await c.query(`CREATE TABLE IF NOT EXISTS public.pgmigrations (
  id serial PRIMARY KEY, name varchar(255) NOT NULL, run_on timestamp NOT NULL)`);
const { rows: before } = await c.query(`SELECT id, name, run_on FROM pgmigrations ORDER BY id`);

console.log(`baseline file      : ${baseline}`);
console.log(`ledger rows now    : ${before.length}`);
before.forEach((r) => console.log(`    ${r.name}`));
console.log(`will become        : ${baseline}`);
if (postBaseline.length) {
  console.log(`left UNrecorded (post-baseline, db:migrate will apply them):`);
  postBaseline.forEach((n) => console.log(`    ${n}`));
}

if (dryRun) {
  console.log('\n--dry-run: nothing written.');
  await c.end();
  process.exit(0);
}

if (before.length) {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const out = `${BACKUP_DIR}/pgmigrations-before-stamp-${stamp}.sql`;
  writeFileSync(
    out,
    `-- pgmigrations ledger contents replaced by scripts/db-baseline-stamp.mjs\n` +
      `-- Restore with: DELETE FROM pgmigrations; then run these inserts.\n\n` +
      before
        .map(
          (r) =>
            `INSERT INTO public.pgmigrations (name, run_on) VALUES ('${r.name.replace(/'/g, "''")}', '${new Date(r.run_on).toISOString()}');`
        )
        .join('\n') +
      '\n',
    'utf8'
  );
  console.log(`\nledger backed up to ${out}`);
}

try {
  await c.query('BEGIN');
  await c.query('DELETE FROM public.pgmigrations');
  await c.query(`INSERT INTO public.pgmigrations (name, run_on) VALUES ($1, now())`, [baseline]);
  const { rows: after } = await c.query(`SELECT name FROM pgmigrations ORDER BY id`);
  if (after.length !== 1 || after[0].name !== baseline) {
    throw new Error(`unexpected post-stamp ledger: ${JSON.stringify(after)}`);
  }
  await c.query('COMMIT');
  console.log(`\n✓ ledger stamped: 1 row (${baseline})`);
} catch (e) {
  await c.query('ROLLBACK');
  console.error(`✗ ROLLED BACK: ${e.message}`);
  process.exitCode = 1;
}
await c.end();
