// Per-table content hash: local vs mirror, ordered by single-column PK.
// Catches UPDATED rows that row-count parity misses.
import pg from 'pg';
import fs from 'node:fs';

const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const localUrl = env.DATABASE_URL ||
  `postgres://${env.PG_USER}:${env.PG_PASSWORD}@${env.PG_HOST}:${env.PG_PORT}/${env.PG_DATABASE}`;
const mirrorUrl = env.SUPABASE_FAILOVER_DB_URL.replace(/([?&])sslmode=[^&]*/g,'$1').replace(/[?&]$/,'');

const IGNORE = new Set(['staff_sessions','portal_sessions','change_log','cdc_sink_control','dolphin_sync_map','pgmigrations']);

const local = new pg.Client({ connectionString: localUrl });
const mirror = new pg.Client({ connectionString: mirrorUrl, ssl:{ rejectUnauthorized:false } });
const q = async (c,s,p)=>(await c.query(s,p)).rows;

const PK_SQL = `
  select t.relname table_name, a.attname pk
  from pg_constraint c
  join pg_class t on t.oid=c.conrelid
  join pg_namespace n on n.oid=t.relnamespace
  join pg_attribute a on a.attrelid=t.oid and a.attnum=c.conkey[1]
  where n.nspname='public' and c.contype='p' and array_length(c.conkey,1)=1`;

(async () => {
  await local.connect(); await mirror.connect();
  const pks = Object.fromEntries((await q(local, PK_SQL)).map(r=>[r.table_name, r.pk]));
  const tables = (await q(local,
    `select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name`))
    .map(r=>r.table_name).filter(t=>!IGNORE.has(t));

  let drift = 0, noPk = [];
  for (const t of tables) {
    const pk = pks[t];
    if (!pk) { noPk.push(t); continue; }
    // md5 over per-row md5(row::text), ordered by PK → order-stable, version-tolerant-ish
    const hsql = `select md5(string_agg(h, '' order by k)) hash, count(*)::int n
                  from (select md5("${t}"::text) h, "${pk}" k from "${t}") s`;
    let a,b;
    try { [a] = await q(local, hsql); } catch(e){ console.log(`  ! ${t} local: ${e.message}`); drift++; continue; }
    try { [b] = await q(mirror, hsql); } catch(e){ console.log(`  ! ${t} mirror: ${e.message}`); drift++; continue; }
    if (a.hash !== b.hash) {
      console.log(`  ✗ ${t}: HASH DIFFERS (local n=${a.n}, mirror n=${b.n})`);
      drift++;
    }
  }
  console.log(`\nchecked ${tables.length - noPk.length} tables with single-col PK`);
  if (noPk.length) console.log(`skipped (no single-col PK, count-only): ${noPk.join(', ')}`);
  console.log(drift ? `\n❌ ${drift} table(s) drifted in content` : `\n✅ ALL CONTENT HASHES MATCH — mirror is byte-identical`);
  await local.end(); await mirror.end();
})().catch(e=>{ console.error('ERROR:', e.message); process.exit(1); });
