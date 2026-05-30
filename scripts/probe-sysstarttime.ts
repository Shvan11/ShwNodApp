/**
 * One-off probe: confirm tblInvoice.SysStartTime is byte-faithful end-to-end across the
 * SQL Server → PostgreSQL migration, and that the report's '...Z' string is identical on both.
 *
 *   OLD (mssql, ShwanNew_Test): raw SysStartTime read via getPool() (useUTC:false), then the
 *        SAME local-component '...Z' formatting that routes/api/reports.routes.ts applied.
 *   NEW (pg,    shwan_test):    report-queries.getDailyInvoices() -> already a '...Z' string.
 *
 * Run:  npx tsx scripts/probe-sysstarttime.ts [YYYY-MM-DD]
 */
import { getPool } from '../services/database/pool.js';
import { getPgPool } from '../services/database/kysely.js';
import ResourceManager from '../services/core/ResourceManager.js';

const DATE = process.argv[2] ?? '2017-11-27';

const pad = (n: number) => String(n).padStart(2, '0');

/** Replicate the ORIGINAL reports.routes.ts mapper: local components of the tedious Date + 'Z'. */
function legacyZ(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}Z`
  );
}

async function main(): Promise<void> {
  const mssql = await getPool();
  const pg = getPgPool();

  // OLD: raw proc-equivalent select against the intact SQL Server sandbox.
  const { recordset: oldRows } = await mssql
    .request()
    .input('d', DATE)
    .query<{ invoiceID: number; SysStartTime: Date }>(
      `SELECT invoiceID, SysStartTime FROM dbo.tblInvoice WHERE Dateofpayment = @d ORDER BY invoiceID`,
    );

  // NEW: what PG stores, plus the report's to_char '...Z' (mirrors report-queries.getDailyInvoices).
  const { rows: newRows } = await pg.query<{ invoiceID: number; raw: string; z: string }>(
    `SELECT "invoiceID",
            to_char("SysStartTime", 'YYYY-MM-DD HH24:MI:SS.MS')      AS raw,
            to_char("SysStartTime", 'YYYY-MM-DD"T"HH24:MI:SS"Z"')    AS z
     FROM "tblInvoice" WHERE "Dateofpayment" = $1::date ORDER BY "invoiceID"`,
    [DATE],
  );

  const newById = new Map(newRows.map((r) => [r.invoiceID, r]));

  console.log(`\nSysStartTime probe for Dateofpayment=${DATE} — ${oldRows.length} invoice(s)\n`);
  console.log('invoiceID | OLD mssql wall-clock        | OLD app .Z string      | NEW pg wall-clock       | NEW report .Z string   | match');
  console.log('-'.repeat(120));

  let mismatches = 0;
  for (const o of oldRows) {
    const n = newById.get(o.invoiceID);
    const oldWall = `${o.SysStartTime.getFullYear()}-${pad(o.SysStartTime.getMonth() + 1)}-${pad(o.SysStartTime.getDate())} ${pad(o.SysStartTime.getHours())}:${pad(o.SysStartTime.getMinutes())}:${pad(o.SysStartTime.getSeconds())}`;
    const oldZ = legacyZ(o.SysStartTime);
    const newZ = n?.z ?? '(missing)';
    const ok = oldZ === newZ;
    if (!ok) mismatches++;
    console.log(
      `${String(o.invoiceID).padEnd(9)} | ${oldWall.padEnd(27)} | ${oldZ.padEnd(22)} | ${String(n?.raw ?? '(missing)').padEnd(23)} | ${newZ.padEnd(22)} | ${ok ? '✅' : '❌'}`,
    );
  }

  console.log('-'.repeat(120));
  console.log(
    mismatches === 0
      ? `\n✅ All ${oldRows.length} SysStartTime '...Z' strings identical OLD(app) vs NEW(report). End-to-end faithful.\n`
      : `\n❌ ${mismatches}/${oldRows.length} mismatched.\n`,
  );

  await ResourceManager.gracefulShutdown('probe');
  process.exit(mismatches ? 1 : 0);
}

void main().catch((err) => {
  console.error('probe fatal:', err);
  process.exit(1);
});
