// One-off: diff local `shwan` (PG18) vs Supabase failover mirror (PG17).
// Reports schema drift (tables/columns/constraints/indexes) + content drift (row counts).
// Ignores: session tables, sync/migration infra, and the PG18 named-NOT-NULL artifact.
import pg from 'pg';
import fs from 'node:fs';

// --- load .env ---
const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const localUrl = env.DATABASE_URL ||
  `postgres://${env.PG_USER}:${env.PG_PASSWORD}@${env.PG_HOST}:${env.PG_PORT}/${env.PG_DATABASE}`;
const mirrorUrl = env.SUPABASE_FAILOVER_DB_URL;
if (!mirrorUrl) { console.error('SUPABASE_FAILOVER_DB_URL missing'); process.exit(1); }

// Tables that are intentionally NOT mirrored / are infra-only.
const IGNORE_TABLES = new Set([
  'staff_sessions', 'portal_sessions',           // session tables (the "except 3")
  'change_log', 'cdc_sink_control', 'dolphin_sync_map', // sync infra (local-only)
  'pgmigrations',                                 // migration bookkeeping
]);

const cleanMirrorUrl = mirrorUrl.replace(/([?&])sslmode=[^&]*/g, '$1').replace(/[?&]$/, '');
const local = new pg.Client({ connectionString: localUrl });
const mirror = new pg.Client({ connectionString: cleanMirrorUrl, ssl: { rejectUnauthorized: false } });

async function q(client, sql, params) { return (await client.query(sql, params)).rows; }

const TABLES_SQL = `
  select table_name from information_schema.tables
  where table_schema='public' and table_type='BASE TABLE'
  order by table_name`;

const COLUMNS_SQL = `
  select table_name, column_name, data_type, udt_name, is_nullable,
         column_default, is_identity, identity_generation, character_maximum_length,
         numeric_precision, numeric_scale
  from information_schema.columns
  where table_schema='public'
  order by table_name, ordinal_position`;

// contype='n' (named NOT NULL) excluded — PG18 catalogs it, PG17 doesn't.
const CONSTRAINTS_SQL = `
  select c.conname, t.relname as table_name, c.contype,
         pg_get_constraintdef(c.oid) as def
  from pg_constraint c
  join pg_class t on t.oid=c.conrelid
  join pg_namespace n on n.oid=t.relnamespace
  where n.nspname='public' and c.contype <> 'n'
  order by t.relname, c.conname`;

const INDEXES_SQL = `
  select tablename as table_name, indexname, indexdef
  from pg_indexes where schemaname='public'
  order by tablename, indexname`;

function colKey(c) {
  return [c.table_name, c.column_name, c.udt_name, c.is_nullable,
    (c.column_default||'').replace(/::[a-z ]+/gi,''), c.is_identity,
    c.character_maximum_length, c.numeric_precision, c.numeric_scale].join('|');
}

function diffSets(localArr, mirrorArr, keyFn, label) {
  const lm = new Map(localArr.map(x => [keyFn(x), x]));
  const mm = new Map(mirrorArr.map(x => [keyFn(x), x]));
  const onlyLocal = [...lm.keys()].filter(k => !mm.has(k));
  const onlyMirror = [...mm.keys()].filter(k => !lm.has(k));
  console.log(`\n=== ${label} ===`);
  console.log(`local: ${lm.size}  mirror: ${mm.size}`);
  if (!onlyLocal.length && !onlyMirror.length) { console.log('  ✓ identical'); return true; }
  for (const k of onlyLocal) console.log(`  - ONLY LOCAL : ${k}`);
  for (const k of onlyMirror) console.log(`  + ONLY MIRROR: ${k}`);
  return false;
}

(async () => {
  await local.connect();
  await mirror.connect();
  const [lv] = await q(local, 'show server_version');
  const [mv] = await q(mirror, 'show server_version');
  console.log(`local PG ${lv.server_version} | mirror PG ${mv.server_version}`);

  let ok = true;

  // 1. Tables
  const lt = (await q(local, TABLES_SQL)).map(r => r.table_name).filter(t => !IGNORE_TABLES.has(t));
  const mt = (await q(mirror, TABLES_SQL)).map(r => r.table_name).filter(t => !IGNORE_TABLES.has(t));
  ok &= diffSets(lt.map(t=>({t})), mt.map(t=>({t})), x=>x.t, 'TABLES (excl. session+infra)');

  // 2. Columns
  const lc = (await q(local, COLUMNS_SQL)).filter(c => !IGNORE_TABLES.has(c.table_name));
  const mc = (await q(mirror, COLUMNS_SQL)).filter(c => !IGNORE_TABLES.has(c.table_name));
  ok &= diffSets(lc, mc, colKey, 'COLUMNS');

  // 3. Constraints (excl. named NOT NULL)
  const lcon = (await q(local, CONSTRAINTS_SQL)).filter(c => !IGNORE_TABLES.has(c.table_name));
  const mcon = (await q(mirror, CONSTRAINTS_SQL)).filter(c => !IGNORE_TABLES.has(c.table_name));
  ok &= diffSets(lcon, mcon, c => `${c.table_name}|${c.def}`, 'CONSTRAINTS (excl. NOT NULL)');

  // 4. Indexes
  const li = (await q(local, INDEXES_SQL)).filter(c => !IGNORE_TABLES.has(c.table_name));
  const mi = (await q(mirror, INDEXES_SQL)).filter(c => !IGNORE_TABLES.has(c.table_name));
  // normalize: drop schema-qualification differences
  const idxKey = x => `${x.table_name}|${x.indexdef.replace(/ ON public\./,' ON ').replace(/USING /,'USING ')}`;
  ok &= diffSets(li, mi, idxKey, 'INDEXES');

  // 5. Row counts per shared table
  console.log('\n=== ROW COUNTS ===');
  const shared = lt.filter(t => mt.includes(t)).sort();
  let countDrift = 0;
  for (const t of shared) {
    const [a] = await q(local, `select count(*)::int n from "${t}"`);
    const [b] = await q(mirror, `select count(*)::int n from "${t}"`);
    if (a.n !== b.n) { console.log(`  ✗ ${t}: local=${a.n} mirror=${b.n} (Δ${a.n-b.n})`); countDrift++; }
  }
  if (!countDrift) console.log(`  ✓ all ${shared.length} tables match on row count`);
  else ok = 0;

  console.log(`\n${ok ? '✅ MIRROR IS IDENTICAL (schema + row counts)' : '❌ DRIFT DETECTED — see above'}`);
  await local.end(); await mirror.end();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
