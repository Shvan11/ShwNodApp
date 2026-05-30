/**
 * Phase 10 pre-ETL gate — READ-ONLY schema-parity diff between production SQL Server (ShwanNew)
 * and the freshly-migrated PG target (shwan). The PG DDL was hand-authored from the *test clone*
 * (ShwanNew_Test), which may have drifted from live production — so before ETL we must prove every
 * production table + column has a PG home (else etl-mssql-to-pg.ts silently drops it).
 *
 * The ETL intersects columns CASE-SENSITIVELY (srcColSet.has(pgCol.name)); a casing mismatch =
 * silent column loss. This check flags that too.
 *
 * Strictly SELECT-only on both sides. Run:
 *   $env:DB_DATABASE='ShwanNew'; $env:PG_DATABASE='shwan'; npx tsx scripts/check-schema-parity.ts
 */
import { getPool } from '../services/database/pool.js';
import { getPgPool } from '../services/database/kysely.js';
import config from '../config/config.js';
import ResourceManager from '../services/core/ResourceManager.js';

const EXPECTED_SRC = 'ShwanNew';
const EXPECTED_DST = 'shwan';

// PG-only tables that are intentionally not sourced from SQL Server.
const PG_ONLY_TABLES = new Set(['pgmigrations', 'staff_sessions', 'portal_sessions']);

// Production columns intentionally dropped in the PG schema (Phase-2 deviations) — expected, not loss.
const INTENTIONAL_DROPPED_COLS = new Set([
  'tblpatients.Age',            // getdate()-based computed → app-computed
  'tblInvoice.SysEndTime',      // temporal period end → dropped
  'tblappointments.SSMA_TimeStamp', // rowversion → dropped
]);

interface Col { name: string; type: string; generated: boolean }

async function main(): Promise<void> {
  if (config.database.database !== EXPECTED_SRC)
    throw new Error(`Source DB resolved '${config.database.database}', expected '${EXPECTED_SRC}'. Set DB_DATABASE=ShwanNew.`);
  if (config.databasePg.database !== EXPECTED_DST)
    throw new Error(`Target DB resolved '${config.databasePg.database}', expected '${EXPECTED_DST}'. Set PG_DATABASE=shwan.`);

  const mssql = await getPool();
  const pg = getPgPool();

  // ── Source (prod) tables + columns ────────────────────────────────────────
  const { recordset: srcCols } = await mssql.request().query<{
    TABLE_NAME: string; COLUMN_NAME: string; DATA_TYPE: string;
  }>(`SELECT c.TABLE_NAME, c.COLUMN_NAME, c.DATA_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS c
      JOIN INFORMATION_SCHEMA.TABLES t ON t.TABLE_NAME = c.TABLE_NAME AND t.TABLE_SCHEMA = c.TABLE_SCHEMA
      WHERE c.TABLE_SCHEMA = 'dbo' AND t.TABLE_TYPE = 'BASE TABLE'`);
  const srcTables = new Map<string, Col[]>();
  for (const r of srcCols) {
    if (!srcTables.has(r.TABLE_NAME)) srcTables.set(r.TABLE_NAME, []);
    srcTables.get(r.TABLE_NAME)!.push({ name: r.COLUMN_NAME, type: r.DATA_TYPE, generated: false });
  }

  // ── Target (PG shwan) tables + columns ────────────────────────────────────
  const { rows: dstCols } = await pg.query<{
    table_name: string; column_name: string; data_type: string; is_generated: string;
  }>(`SELECT table_name, column_name, data_type, is_generated
      FROM information_schema.columns c
      WHERE table_schema = 'public'
        AND EXISTS (SELECT 1 FROM information_schema.tables t
                    WHERE t.table_schema='public' AND t.table_name=c.table_name AND t.table_type='BASE TABLE')`);
  const dstTables = new Map<string, Col[]>();
  for (const r of dstCols) {
    if (PG_ONLY_TABLES.has(r.table_name)) continue;
    if (!dstTables.has(r.table_name)) dstTables.set(r.table_name, []);
    dstTables.get(r.table_name)!.push({ name: r.column_name, type: r.data_type, generated: r.is_generated === 'ALWAYS' });
  }

  // Case-insensitive lookup of PG table name (SQL Server identifiers are case-insensitive).
  const dstByLower = new Map<string, string>();
  for (const t of dstTables.keys()) dstByLower.set(t.toLowerCase(), t);
  const srcByLower = new Map<string, string>();
  for (const t of srcTables.keys()) srcByLower.set(t.toLowerCase(), t);

  console.log(`Source (prod ShwanNew): ${srcTables.size} base tables`);
  console.log(`Target (PG shwan):      ${dstTables.size} ETL-target tables (excl. session/pgmigrations)\n`);

  const lossRisks: string[] = [];
  const info: string[] = [];

  // 1. Production tables with NO PG target → DATA LOSS.
  for (const [t] of srcTables) {
    if (!dstByLower.has(t.toLowerCase())) lossRisks.push(`TABLE prod-only (no PG target): dbo.${t}`);
  }
  // 2. PG tables with NO production source → ETL can't load them (flag, usually new/derived).
  for (const [t] of dstTables) {
    if (!srcByLower.has(t.toLowerCase())) info.push(`TABLE PG-only (no prod source, ETL will error/skip): ${t}`);
  }

  // 3. Column-level diff for shared tables.
  for (const [srcT, sCols] of srcTables) {
    const dstT = dstByLower.get(srcT.toLowerCase());
    if (!dstT) continue;
    const dCols = dstTables.get(dstT)!;
    const dExact = new Set(dCols.map((c) => c.name));
    const dLower = new Map(dCols.map((c) => [c.name.toLowerCase(), c]));

    for (const sc of sCols) {
      const key = `${srcT}.${sc.name}`;
      if (dExact.has(sc.name)) continue; // exact match — ETL will load it
      const ci = dLower.get(sc.name.toLowerCase());
      if (ci) {
        // present but different casing → ETL's case-sensitive intersect would DROP it
        lossRisks.push(`COLUMN casing mismatch (ETL would drop): prod ${srcT}.${sc.name} vs PG ${dstT}."${ci.name}"`);
      } else if (INTENTIONAL_DROPPED_COLS.has(key)) {
        info.push(`COLUMN intentionally dropped (OK): ${key} (${sc.type})`);
      } else {
        lossRisks.push(`COLUMN prod-only (no PG home — would be dropped): ${key} (${sc.type})`);
      }
    }
    // PG columns with no prod source (informational — derived/new; ETL skips).
    const sLower = new Set(sCols.map((c) => c.name.toLowerCase()));
    for (const dc of dCols) {
      if (!sLower.has(dc.name.toLowerCase())) {
        info.push(`COLUMN PG-only ${dc.generated ? '(GENERATED)' : ''}: ${dstT}.${dc.name} (${dc.type})`);
      }
    }
  }

  if (info.length) {
    console.log('ℹ️  Informational (expected differences):');
    for (const m of info.sort()) console.log(`   ${m}`);
    console.log('');
  }
  if (lossRisks.length) {
    console.log(`❌ ${lossRisks.length} DATA-LOSS RISK(S) — resolve before ETL:`);
    for (const m of lossRisks.sort()) console.log(`   ${m}`);
  } else {
    console.log('✅ Schema parity OK — every production table & column has a PG home (case-exact). Safe to ETL.');
  }

  await ResourceManager.gracefulShutdown('check-schema-parity');
  process.exit(lossRisks.length ? 1 : 0);
}

void main().catch((err) => {
  console.error('Schema-parity check failed:', err);
  process.exit(1);
});
