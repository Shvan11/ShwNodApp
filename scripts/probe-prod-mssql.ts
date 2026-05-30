/**
 * Phase 10 pre-flight — READ-ONLY probe of the live production SQL Server (ShwanNew).
 *
 * Verifies the migration host can reach production read-only and captures an INDEPENDENT
 * per-table row-count baseline (written to scripts/.prod-baseline.json) used afterwards to
 * prove the PG copy is exact. Strictly SELECT-only — never writes to ShwanNew.
 *
 * Run:  $env:DB_DATABASE='ShwanNew'; npx tsx scripts/probe-prod-mssql.ts
 * (The DB_DATABASE shell override redirects the mssql pool from the sandbox to prod; the
 *  base .env is loaded without dotenv `override`, so the shell value wins.)
 */
import { writeFileSync } from 'node:fs';
import { getPool } from '../services/database/pool.js';
import config from '../config/config.js';
import ResourceManager from '../services/core/ResourceManager.js';

const EXPECTED_DB = 'ShwanNew';

async function main(): Promise<void> {
  // Guard: refuse to run unless explicitly pointed at production ShwanNew.
  if (config.database.database !== EXPECTED_DB) {
    throw new Error(
      `Refusing to probe: resolved DB is '${config.database.database}', expected '${EXPECTED_DB}'. ` +
      `Set DB_DATABASE=ShwanNew before running.`,
    );
  }

  const pool = await getPool();

  // Identity — prove we are on the live production instance/database.
  const { recordset: idRows } = await pool.request().query<{
    db: string; srv: string; ver: string;
  }>(`SELECT DB_NAME() AS db, CAST(SERVERPROPERTY('ServerName') AS varchar(256)) AS srv, @@VERSION AS ver`);
  const id = idRows[0];
  console.log(`Connected: server='${id.srv}'  database='${id.db}'`);
  console.log(`Version: ${id.ver.split('\n')[0].trim()}\n`);
  if (id.db !== EXPECTED_DB) throw new Error(`DB_NAME() is '${id.db}', not '${EXPECTED_DB}' — aborting.`);

  // Every base table in dbo + its row count (sysindexes is exact for heaps/clustered).
  const { recordset: tableRows } = await pool.request().query<{ TABLE_NAME: string }>(
    `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_TYPE = 'BASE TABLE' AND TABLE_SCHEMA = 'dbo' ORDER BY TABLE_NAME`,
  );

  const baseline: Record<string, number> = {};
  let total = 0;
  for (const { TABLE_NAME } of tableRows) {
    const { recordset } = await pool
      .request()
      .query<{ n: number }>(`SELECT COUNT_BIG(*) AS n FROM [dbo].[${TABLE_NAME}]`);
    const n = Number(recordset[0].n);
    baseline[TABLE_NAME] = n;
    total += n;
    console.log(`  ${TABLE_NAME.padEnd(40)} ${n.toLocaleString()}`);
  }

  // A money checksum independent of counts.
  const { recordset: sumRows } = await pool.request().query<{ s: string }>(
    `SELECT ISNULL(SUM(CAST(Amountpaid AS bigint)), 0) AS s FROM [dbo].[tblInvoice]`,
  );
  const amountpaidSum = String(sumRows[0].s);

  console.log(`\n${tableRows.length} base tables, ${total.toLocaleString()} total rows.`);
  console.log(`SUM(tblInvoice.Amountpaid) = ${amountpaidSum}`);

  writeFileSync(
    'scripts/.prod-baseline.json',
    JSON.stringify({ database: id.db, server: id.srv, capturedTableCount: tableRows.length, total, amountpaidSum, baseline }, null, 2),
  );
  console.log('\n✅ Baseline written to scripts/.prod-baseline.json (read-only; ShwanNew untouched).');

  await ResourceManager.gracefulShutdown('probe-prod-mssql');
  process.exit(0);
}

void main().catch((err) => {
  console.error('Probe failed:', err);
  process.exit(1);
});
