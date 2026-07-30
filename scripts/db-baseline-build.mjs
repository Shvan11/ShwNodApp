/**
 * Author a SQUASHED baseline migration from the live schema.
 *
 *   node --env-file=.env scripts/db-baseline-build.mjs migrations/pg/<ts>_baseline-<date>.sql
 *
 * Run this ONLY when deliberately squashing the migration history (it replaces every
 * prior migration file). Regenerating it casually will clobber a baseline that other
 * deployments have already been stamped against — see docs/db-migrations.md.
 *
 * A raw `pg_dump --schema-only` is NOT directly usable as a node-pg-migrate migration.
 * The transformations below are the whole reason this script exists:
 *
 *  1. `\restrict` / `\unrestrict` — psql meta-commands (new in pg_dump 18). Migrations
 *     run through the `pg` driver, not psql, so these are hard syntax errors.
 *  2. `SELECT pg_catalog.set_config('search_path', '', false)` — an EMPTY search_path.
 *     pg_dump schema-qualifies everything so the dump itself survives, but it would also
 *     break node-pg-migrate's own unqualified `INSERT INTO pgmigrations` bookkeeping in
 *     the same session.
 *  3. `SET transaction_timeout` — PostgreSQL 18+ only; dropped so the baseline still
 *     applies on a 17.x deployment.
 *  4. `CREATE SCHEMA extensions` → `IF NOT EXISTS` (idempotent re-run).
 *  5. pg_stat_statements is wrapped so a non-superuser install can skip it: unlike
 *     citext / pg_trgm it is NOT a trusted extension, so a fresh clinic install running
 *     migrations as the app role would otherwise die on a monitoring-only dependency.
 *  6. A GUARD is prepended that hard-refuses to run against a database that already has
 *     an application schema — the actual disaster prevention.
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import pg from 'pg';

const out = process.argv[2];
if (!out) {
  console.error('usage: node --env-file=.env scripts/db-baseline-build.mjs <output.sql>');
  process.exit(2);
}

// ---------------------------------------------------------------- raw schema
const dump = spawnSync(process.execPath, ['scripts/db-baseline-dump.mjs'], {
  env: process.env,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
if (dump.status !== 0) {
  console.error(dump.stderr || `dump failed (${dump.status})`);
  process.exit(1);
}

const dropLine = (l) =>
  l.startsWith('\\restrict') ||
  l.startsWith('\\unrestrict') ||
  l.includes("set_config('search_path'") ||
  l.startsWith('SET transaction_timeout');

let schema = dump.stdout
  .split(/\r?\n/)
  .filter((l) => !dropLine(l))
  .join('\n')
  .replace(/^CREATE SCHEMA extensions;$/m, 'CREATE SCHEMA IF NOT EXISTS extensions;')
  // pg_stat_statements: monitoring only, and not a trusted extension.
  .replace(
    /^CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;$/m,
    `DO $do$
BEGIN
  EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions';
EXCEPTION WHEN insufficient_privilege OR undefined_file THEN
  RAISE NOTICE 'pg_stat_statements skipped (needs superuser / not available) — monitoring only, app schema unaffected';
END
$do$;`
  )
  .trim();

// ---------------------------------------------------------------- live seed rows
const c = new pg.Client({
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT ?? 5432),
  database: process.env.PG_DATABASE,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
});
await c.connect();
const q = async (sql) => (await c.query(sql)).rows;
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;

const sinks = await q(`SELECT sink FROM cdc_sink_control ORDER BY sink`);
const vita = await q(`SELECT shade FROM shade_vita_classic ORDER BY id`);
const master = await q(`SELECT shade FROM shade_3d_master ORDER BY id`);
const slides = await q(
  `SELECT name, kind, config::text FROM slideshow_configs WHERE person_id IS NULL ORDER BY id`
);
await c.end();

const wrap = (vals, per) => {
  const out = [];
  for (let i = 0; i < vals.length; i += per) out.push('  ' + vals.slice(i, i + per).join(', '));
  return out.join(',\n');
};

const seed = `-- ===========================================================================
-- SEED — carried forward from the migrations this baseline replaces.
--
-- Only PRODUCT data lives here: sync-infra rows and controlled vocabularies that
-- every deployment needs. Deliberately NOT seeded:
--   * \`labs\` — the retired labs-normalization migration derived it from THIS clinic's
--     expense_subcategories, so it is per-clinic data, not a product default.
--   * \`options\` beyond the two below, and every clinical lookup table — those come
--     from a deployment's own data load, and \`options\` holds live secrets
--     (e.g. the Telegram gram_session) that must never sit in the repo.
-- Every statement is idempotent so a re-run cannot duplicate rows.
-- ===========================================================================

-- CDC sink registry. Inserted with the column defaults (enabled = false); the sync
-- engine flips \`enabled\` at boot. \`reverse\` is absent on purpose — its control row
-- lives on the SUPABASE side (see docs/sync-cdc.md).
INSERT INTO public.cdc_sink_control (sink) VALUES
${wrap(sinks.map((r) => `(${lit(r.sink)})`), 6)}
  ON CONFLICT (sink) DO NOTHING;

-- WhatsApp group defaults (from the retired seed-whatsapp-group-options migration).
INSERT INTO public.options (option_name, option_value) VALUES
  ('whatsapp_send_to_group', 'true'),
  ('whatsapp_group_name', 'Shwan Orthodontics')
  ON CONFLICT (option_name) DO NOTHING;

-- VITA Classic shade vocabulary.
INSERT INTO public.shade_vita_classic (shade) VALUES
${wrap(vita.map((r) => `(${lit(r.shade)})`), 8)}
  ON CONFLICT DO NOTHING;

-- VITA 3D-Master shade vocabulary.
INSERT INTO public.shade_3d_master (shade) VALUES
${wrap(master.map((r) => `(${lit(r.shade)})`), 7)}
  ON CONFLICT DO NOTHING;

-- Clinic-wide slideshow templates (person_id NULL = generic recipe).
${slides
  .map(
    (s) => `INSERT INTO public.slideshow_configs (person_id, name, kind, config)
SELECT NULL, ${lit(s.name)}, ${lit(s.kind)}, ${lit(s.config)}::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM public.slideshow_configs WHERE person_id IS NULL AND name = ${lit(s.name)}
);`
  )
  .join('\n\n')}`;

// ---------------------------------------------------------------- assemble
const gitSha = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
const stamp = new Date().toISOString().slice(0, 10);

const header = `-- ===========================================================================
-- SQUASHED BASELINE — the full application schema as of ${stamp}.
--
-- Generated by scripts/db-baseline-build.mjs from the live database (pg_dump
-- --schema-only --no-owner --no-privileges). The live schema is the source of truth;
-- this file is its checked-in reproduction.
--
-- WHY THIS EXISTS
-- The pgmigrations ledger had drifted completely away from migrations/pg: the ledger
-- held 20 rows naming files that no longer existed, while all 21 files on disk —
-- including a 4,466-line full-schema baseline — were unrecorded. \`db:migrate\` therefore
-- wanted to REPLAY the entire schema over a live clinic database; only node-pg-migrate's
-- order check stood between that and a production disaster. This squash collapses the
-- history to one file whose applied-state is truthfully recorded.
--
-- It replaces these 21 files, whose contents remain in git history at ${gitSha || '<pre-squash commit>'}:
--   1781200000000_baseline-schema           1782200000000_expenses-is-monthly
--   1781800000000_alerts-active-partial-index
--   1781800100000_appointments-drid-appdate-index
--   1781800200000_messageid-partial-index   1782300000000_shade-tables
--   1781800300000_expense-lookup-name-ar    1782400000000_rename-bridge-to-crown-bridge
--   1781800400000_patient-type-name-ar      1782500000000_labs-normalization
--   1781800500000_employee-commission-pct   1782600000000_slideshow-configs
--   1781900000000_integration-oauth-tokens  1782700000000_lab-cases
--   1781900100000_drop-redundant-prefix-indexes
--   1782000000000_role-registry             1782800000000_announcements-and-portal-activity
--   1782100000000_approval-requests         1782900000000_mirror-approvals-slideshow
--                                           1782900000000_portal-case-submissions
--                                           1783000000000_drop-invoice-actual-columns
--
-- SCOPE — what a fresh database gets from this file
-- Structure: 80 tables, all constraints/indexes, the 2 app functions (cdc_capture,
-- set_updated_at), all 99 CDC/updated_at triggers, and the 24 reverse-sync sequences
-- that carry INCREMENT BY 2 (local ODD ids / Supabase EVEN — see docs/sync-cdc.md).
-- Extensions citext + pg_trgm are created; pg_stat_statements is attempted and skipped
-- without superuser. Clinical lookup tables arrive EMPTY — seeding a brand-new clinic's
-- vocabularies is a separate data-load step, exactly as it was before this squash.
--
-- ⚠️ NEVER run this against a populated database. The guard below enforces that. If a
-- deployment's ledger loses its rows, RE-STAMP it (\`npm run db:baseline:stamp\`) — do
-- not re-run this file.
--
-- ⚠️ Supabase mirror: this is the LOCAL schema. The mirror is maintained separately
-- (migrations/supabase/) and differs only by the documented sync-infra asymmetries.
-- ===========================================================================

-- Up Migration

-- ---------------------------------------------------------------------------
-- GUARD — refuse to replay the schema over an existing deployment.
-- ---------------------------------------------------------------------------
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'patients') THEN
    RAISE EXCEPTION 'Baseline refused: this database already has an application schema'
      USING DETAIL = 'public.patients exists, so this is an existing deployment, not a fresh install. Replaying the baseline here is exactly the accident this guard was added to stop.',
            HINT   = 'If the pgmigrations ledger is missing rows, run: npm run db:baseline:stamp';
  END IF;
END
$guard$;

`;

const footer = `

-- Down Migration
-- A squashed baseline has no meaningful down: reversing it means dropping every table
-- in the deployment. Reset by restoring a dump instead.
DO $nodown$
BEGIN
  RAISE EXCEPTION 'Refusing to reverse the squashed baseline — restore a database dump instead';
END
$nodown$;
`;

writeFileSync(out, header + schema + '\n\n' + seed + footer, 'utf8');
console.log(`wrote ${out}`);
console.log(`  schema lines: ${schema.split('\n').length}`);
console.log(`  seed: ${sinks.length} sinks, ${vita.length} vita, ${master.length} 3d-master, ${slides.length} slideshow templates`);
