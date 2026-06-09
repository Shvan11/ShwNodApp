/**
 * Reverse CDC v2 — operational helper (no psql on this host). Drives BOTH databases via node-postgres:
 *   - LOCAL  from PG_HOST/PG_PORT/PG_DATABASE/PG_USER/PG_PASSWORD (.env)
 *   - SUPABASE from SUPABASE_FAILOVER_DB_URL (.env), TLS like the app (rejectUnauthorized:false)
 *
 * Subcommands:
 *   state                       backlog + sink_control on both DBs
 *   parity [t1 t2 …]            compare max(id) local vs supabase for reverse-set tables (sample if none)
 *   exec-supa  <file.sql>       run a .sql file against SUPABASE (multi-statement, no params)
 *   exec-local <file.sql>       run a .sql file against LOCAL
 *   sql-local  "<sql>"          ad-hoc query on LOCAL  (prints rows as JSON)
 *   sql-supa   "<sql>"          ad-hoc query on SUPABASE
 *
 * Read-only by default; the exec and sql subcommands do exactly what you pass. NOT wired into the app.
 */
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import dotenv from 'dotenv';

dotenv.config({ quiet: true }); // suppress dotenv 17's promotional banner
const { Pool } = pg;

function stripSslMode(s) {
  return s
    .replace(/([?&])sslmode=[^&]*/gi, '$1')
    .replace(/\?&/g, '?')
    .replace(/&&/g, '&')
    .replace(/[?&]$/g, '');
}

function localPool() {
  return new Pool({
    host: process.env.PG_HOST,
    port: Number(process.env.PG_PORT ?? 5432),
    database: process.env.PG_DATABASE,
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    max: 2,
    connectionTimeoutMillis: 10_000,
  });
}

function supaPool() {
  const url = process.env.SUPABASE_FAILOVER_DB_URL;
  if (!url) throw new Error('SUPABASE_FAILOVER_DB_URL not set');
  return new Pool({
    connectionString: stripSslMode(url),
    ssl: { rejectUnauthorized: false },
    max: 2,
    connectionTimeoutMillis: 15_000,
  });
}

const REVERSE_SET_SQL = `
  SELECT col.table_name AS tbl
    FROM information_schema.columns col
    JOIN information_schema.tables t
      ON t.table_schema=col.table_schema AND t.table_name=col.table_name AND t.table_type='BASE TABLE'
   WHERE col.table_schema='public' AND col.column_name='updated_at'
     AND col.table_name NOT IN ('change_log','cdc_sink_control','pgmigrations','staff_sessions','portal_sessions','dolphin_sync_map')
   ORDER BY col.table_name`;

async function pkOf(pool, tbl) {
  const { rows } = await pool.query(
    `SELECT a.attname AS pk
       FROM pg_index i
       JOIN pg_class c ON c.oid=i.indrelid
       JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public'
       JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=i.indkey[0]
      WHERE c.relname=$1 AND i.indisprimary AND array_length(i.indkey::int[],1)=1`,
    [tbl]
  );
  return rows[0]?.pk;
}

async function state() {
  const local = localPool();
  let supa;
  try {
    const lc = (await local.query(`SELECT sink,enabled,stale,backlog FROM cdc_sink_control
      LEFT JOIN LATERAL (SELECT count(*)::int backlog FROM change_log cl WHERE cl.sink=cdc_sink_control.sink) b ON true
      ORDER BY sink`)).rows;
    console.log('LOCAL cdc_sink_control:', JSON.stringify(lc));
    try {
      supa = supaPool();
      const sc = (await supa.query(`SELECT sink,enabled,stale,backlog FROM cdc_sink_control
        LEFT JOIN LATERAL (SELECT count(*)::int backlog FROM change_log cl WHERE cl.sink=cdc_sink_control.sink) b ON true
        ORDER BY sink`)).rows;
      console.log('SUPA  cdc_sink_control:', JSON.stringify(sc));
    } catch (e) {
      console.log('SUPA  cdc_sink_control: <error>', e.message);
    }
  } finally {
    await local.end();
    if (supa) await supa.end();
  }
}

async function parity(tables) {
  const local = localPool();
  const supa = supaPool();
  try {
    let list = tables;
    if (!list.length) list = (await local.query(REVERSE_SET_SQL)).rows.map((r) => r.tbl);
    let mismatches = 0;
    for (const tbl of list) {
      const pk = await pkOf(local, tbl);
      if (!pk) {
        console.log(`${tbl}: no single PK — skip`);
        continue;
      }
      // Cast MAX to text so citext/text PKs (e.g. options.option_name) don't trip COALESCE typing.
      const lm = (await local.query(`SELECT MAX(${JSON.stringify(pk)})::text AS m FROM ${JSON.stringify(tbl)}`)).rows[0].m ?? '∅';
      let sm = 'ERR';
      try {
        sm = (await supa.query(`SELECT MAX(${JSON.stringify(pk)})::text AS m FROM ${JSON.stringify(tbl)}`)).rows[0].m ?? '∅';
      } catch (e) {
        sm = 'ERR:' + e.message;
      }
      const ok = String(lm) === String(sm);
      if (!ok) mismatches++;
      console.log(`${ok ? 'OK ' : '!! '} ${tbl}.${pk}  local=${lm}  supa=${sm}`);
    }
    console.log(`\nparity: ${mismatches} mismatch(es) over ${list.length} table(s)`);
    process.exitCode = mismatches === 0 ? 0 : 2;
  } finally {
    await local.end();
    await supa.end();
  }
}

async function execFile(which, file) {
  const sql = await readFile(file, 'utf8');
  const pool = which === 'supa' ? supaPool() : localPool();
  try {
    await pool.query(sql); // multi-statement simple-query; dollar-quoted DO blocks OK
    console.log(`✓ applied ${file} to ${which.toUpperCase()}`);
  } finally {
    await pool.end();
  }
}

async function adhoc(which, sql) {
  const pool = which === 'supa' ? supaPool() : localPool();
  try {
    const r = await pool.query(sql);
    if (Array.isArray(r)) for (const x of r) console.log(JSON.stringify(x.rows ?? x.command));
    else console.log(JSON.stringify(r.rows ?? r.command));
  } finally {
    await pool.end();
  }
}

const [cmd, ...args] = process.argv.slice(2);
const run = {
  state: () => state(),
  parity: () => parity(args),
  'exec-supa': () => execFile('supa', args[0]),
  'exec-local': () => execFile('local', args[0]),
  'sql-local': () => adhoc('local', args[0]),
  'sql-supa': () => adhoc('supa', args[0]),
}[cmd];
if (!run) {
  console.error('usage: node scripts/reverse-sync-ops.mjs <state|parity|exec-supa|exec-local|sql-local|sql-supa> [args]');
  process.exit(1);
}
run().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
