/**
 * Phase 6 ETL — copy all data from the live SQL Server sandbox (ShwanNew_Test) into the
 * local PostgreSQL sandbox (shwan_test). Re-runnable: it truncates every target table first.
 *
 * Strategy (order-independent, no hand-maintained FK graph):
 *   1. Introspect the PG catalog for the table set, per-table columns (skipping GENERATED
 *      ALWAYS computed cols), identity columns, and every FK definition.
 *   2. DROP all FK constraints, TRUNCATE every table (RESTART IDENTITY).
 *   3. For each table, read all rows from SQL Server and bulk-insert into PG with
 *      type-correct coercion that preserves wall-clock semantics (mssql runs useUTC:false):
 *        date      -> 'YYYY-MM-DD' string (utils/date.ts#toDateOnly — no UTC day-shift)
 *        time      -> 'HH:MM:SS.mmm' local
 *        timestamp -> 'YYYY-MM-DD HH:MM:SS.mmm' local (no tz, matches the column type)
 *        boolean   -> JS boolean (mssql bit already arrives as boolean)
 *        uuid      -> string (NULL for empty)
 *   4. RE-ADD every FK constraint — this VALIDATES referential integrity end-to-end.
 *   5. setval() every identity sequence to MAX(col) so future inserts don't collide.
 *   6. Verify: per-table row-count parity + a spot-check sum (tblInvoice.Amountpaid).
 *
 * Reads via the existing mssql pool (services/database/pool.ts, useUTC:false); writes via a
 * raw pg pool (services/database/kysely.ts#getPgPool, connects as shwan_app, the db owner).
 *
 * Run (PowerShell):  npx tsx scripts/etl-mssql-to-pg.ts
 *      (bash):       npx tsx scripts/etl-mssql-to-pg.ts
 * DB_DRIVER is irrelevant here — both connections are opened explicitly.
 */
import { getPool } from '../services/database/pool.js';
import { getPgPool } from '../services/database/kysely.js';
import { toDateOnly } from '../utils/date.js';
import ResourceManager from '../services/core/ResourceManager.js';

interface PgColumn {
  name: string;
  dataType: string; // information_schema.columns.data_type
  isIdentity: boolean;
}

const SCHEMA = 'public';
const EXCLUDE_TABLES = new Set(['pgmigrations']); // node-pg-migrate's own tracker

/** Two-digit / millisecond pad helpers for local wall-clock formatting. */
function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/** Local 'YYYY-MM-DD HH:MM:SS.mmm' — feeds a `timestamp WITHOUT time zone` column verbatim. */
function toLocalTimestamp(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
  );
}

/** Local 'HH:MM:SS.mmm' — mssql `time` arrives as a 1970-epoch Date carrying the wall-clock time. */
function toLocalTime(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** Coerce one SQL Server cell to a PG-bindable value, keyed by the PG column's data_type. */
function coerce(value: unknown, dataType: string): unknown {
  if (value === null || value === undefined) return null;
  switch (dataType) {
    case 'date': {
      const s = toDateOnly(value as Date | string);
      return s === '' ? null : s;
    }
    case 'time without time zone':
      return value instanceof Date ? toLocalTime(value) : value;
    case 'timestamp without time zone':
      return value instanceof Date ? toLocalTimestamp(value) : value;
    case 'boolean':
      return typeof value === 'boolean' ? value : value === 1 || value === '1' || value === true;
    case 'uuid':
      return value === '' ? null : value;
    case 'character':
      return value; // fixed-width codes (char(2)) — keep exact, do NOT trim
    default:
      // citext / text / character varying: SQL Server char(n) source columns arrive
      // space-PADDED (e.g. 'IQD       '). PG text comparison is trailing-space-SENSITIVE
      // (SQL Server's char `=` is not), so `Currency = 'IQD'` would never match. Trim
      // trailing spaces to replicate SQL Server's effective semantics. Only spaces are
      // stripped (char padding); newlines/tabs in free-text are preserved.
      return typeof value === 'string' ? value.replace(/ +$/, '') : value;
  }
}

async function main(): Promise<void> {
  const mssql = await getPool();
  const pg = getPgPool();

  console.log('Phase 6 ETL — SQL Server (ShwanNew_Test) → PostgreSQL (shwan_test)\n');

  // ── 1. Introspect the PG target ─────────────────────────────────────────────
  const { rows: tableRows } = await pg.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name`,
    [SCHEMA],
  );
  const tables = tableRows.map((r) => r.table_name).filter((t) => !EXCLUDE_TABLES.has(t));

  const { rows: colRows } = await pg.query<{
    table_name: string; column_name: string; data_type: string; is_identity: string; is_generated: string;
  }>(
    `SELECT table_name, column_name, data_type, is_identity, is_generated
     FROM information_schema.columns WHERE table_schema = $1`,
    [SCHEMA],
  );
  const pgColumns = new Map<string, PgColumn[]>();
  for (const c of colRows) {
    if (c.is_generated === 'ALWAYS') continue; // STORED computed cols — never insert
    if (!pgColumns.has(c.table_name)) pgColumns.set(c.table_name, []);
    pgColumns.get(c.table_name)!.push({
      name: c.column_name, dataType: c.data_type, isIdentity: c.is_identity === 'YES',
    });
  }

  // FK definitions, so we can drop then re-add (the re-add validates referential integrity).
  const { rows: fkRows } = await pg.query<{ tbl: string; conname: string; def: string }>(
    `SELECT conrelid::regclass::text AS tbl, conname, pg_get_constraintdef(oid) AS def
     FROM pg_constraint WHERE contype = 'f' AND connamespace = $1::regnamespace`,
    [SCHEMA],
  );
  console.log(`Target: ${tables.length} tables, ${fkRows.length} foreign keys.\n`);

  // ── 2. Drop FKs + truncate ──────────────────────────────────────────────────
  for (const fk of fkRows) {
    await pg.query(`ALTER TABLE ${fk.tbl} DROP CONSTRAINT "${fk.conname}"`);
  }
  console.log(`Dropped ${fkRows.length} FK constraints.`);
  const truncList = tables.map((t) => `"${t}"`).join(', ');
  await pg.query(`TRUNCATE TABLE ${truncList} RESTART IDENTITY`);
  console.log('Truncated all target tables.\n');

  // ── 3. Copy each table ───────────────────────────────────────────────────────
  const counts: { table: string; src: number; dst: number }[] = [];
  const errors: string[] = [];

  for (const table of tables) {
    const pgCols = pgColumns.get(table) ?? [];
    if (pgCols.length === 0) { console.log(`  • ${table}: no insertable columns, skipped`); continue; }

    // Intersect with SQL Server's actual columns (PG may have dropped/added some).
    const { recordset: srcColRows } = await mssql
      .request()
      .input('t', table)
      .query<{ COLUMN_NAME: string }>(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @t AND TABLE_SCHEMA = 'dbo'`,
      );
    const srcColSet = new Set(srcColRows.map((r) => r.COLUMN_NAME));
    const cols = pgCols.filter((c) => srcColSet.has(c.name));
    const skipped = pgCols.filter((c) => !srcColSet.has(c.name)).map((c) => c.name);
    if (cols.length === 0) {
      errors.push(`${table}: none of the PG columns exist in the SQL Server source`);
      console.log(`  ❌ ${table}: no matching source columns`);
      continue;
    }

    const selectList = cols.map((c) => `[${c.name}]`).join(', ');
    const { recordset: srcRows } = await mssql
      .request()
      .query<Record<string, unknown>>(`SELECT ${selectList} FROM [dbo].[${table}]`);

    try {
      await insertRows(pg, table, cols, srcRows);
      const { rows: cntRows } = await pg.query<{ n: string }>(`SELECT count(*)::text AS n FROM "${table}"`);
      const dst = Number(cntRows[0].n);
      counts.push({ table, src: srcRows.length, dst });
      const flag = dst === srcRows.length ? '✅' : '⚠️ ';
      const note = skipped.length ? ` (skipped PG-only cols: ${skipped.join(', ')})` : '';
      console.log(`  ${flag} ${table}: ${srcRows.length} → ${dst}${note}`);
    } catch (err) {
      errors.push(`${table}: ${(err as Error).message}`);
      console.log(`  ❌ ${table}: ${(err as Error).message}`);
    }
  }

  // ── 4. Re-add FKs (validates referential integrity) ──────────────────────────
  console.log('\nRe-adding foreign keys (validates referential integrity)…');
  let fkOk = 0;
  for (const fk of fkRows) {
    try {
      await pg.query(`ALTER TABLE ${fk.tbl} ADD CONSTRAINT "${fk.conname}" ${fk.def}`);
      fkOk++;
    } catch (err) {
      errors.push(`FK ${fk.conname} on ${fk.tbl}: ${(err as Error).message}`);
      console.log(`  ❌ FK ${fk.conname} on ${fk.tbl}: ${(err as Error).message}`);
    }
  }
  console.log(`  Re-added ${fkOk}/${fkRows.length} FK constraints.`);

  // ── 5. Reset identity sequences ──────────────────────────────────────────────
  console.log('\nResetting identity sequences to MAX(col)…');
  let seqCount = 0;
  for (const table of tables) {
    for (const c of pgColumns.get(table) ?? []) {
      if (!c.isIdentity) continue;
      // setval(seq, MAX, true) → next nextval is MAX+1; if table empty, setval(seq, 1, false) → next is 1.
      await pg.query(
        `SELECT setval(
           pg_get_serial_sequence($1, $2),
           COALESCE((SELECT MAX("${c.name}") FROM "${table}"), 1),
           (SELECT COUNT(*) FROM "${table}") > 0
         )`,
        [`"${table}"`, c.name],
      );
      seqCount++;
    }
  }
  console.log(`  Reset ${seqCount} identity sequences.`);

  // ── 6. Verify ─────────────────────────────────────────────────────────────────
  const mismatches = counts.filter((c) => c.src !== c.dst);
  const totalSrc = counts.reduce((s, c) => s + c.src, 0);
  const totalDst = counts.reduce((s, c) => s + c.dst, 0);
  console.log(`\nRow totals: source ${totalSrc} → target ${totalDst}.`);

  // Spot-check: sum(tblInvoice.Amountpaid) must match exactly.
  try {
    const { recordset: msSum } = await mssql.request().query<{ s: number }>(
      `SELECT ISNULL(SUM(CAST(Amountpaid AS bigint)), 0) AS s FROM [dbo].[tblInvoice]`,
    );
    const { rows: pgSum } = await pg.query<{ s: string }>(
      `SELECT COALESCE(SUM("Amountpaid")::text, '0') AS s FROM "tblInvoice"`,
    );
    const ok = String(msSum[0].s) === pgSum[0].s;
    console.log(`Spot-check SUM(tblInvoice.Amountpaid): mssql=${msSum[0].s} pg=${pgSum[0].s} ${ok ? '✅' : '❌'}`);
    if (!ok) errors.push('tblInvoice.Amountpaid sum mismatch');
  } catch (err) {
    errors.push(`spot-check sum: ${(err as Error).message}`);
  }

  if (mismatches.length) {
    console.log('\n⚠️  Row-count mismatches:');
    for (const m of mismatches) console.log(`   ${m.table}: src ${m.src} ≠ dst ${m.dst}`);
  }
  if (errors.length) {
    console.log(`\n❌ ETL completed with ${errors.length} error(s):`);
    for (const e of errors) console.log(`   - ${e}`);
  } else {
    console.log('\n✅ ETL complete — all tables loaded, FKs validated, sequences reset.');
  }

  await ResourceManager.gracefulShutdown('etl');
  process.exit(errors.length ? 1 : 0);
}

/** Chunked multi-row parameterized INSERT (keeps the bound-param count well under PG's 65535 cap). */
async function insertRows(
  pg: import('pg').Pool,
  table: string,
  cols: PgColumn[],
  rows: Record<string, unknown>[],
): Promise<void> {
  if (rows.length === 0) return;
  const colList = cols.map((c) => `"${c.name}"`).join(', ');
  const maxRowsPerChunk = Math.max(1, Math.floor(60000 / cols.length));

  for (let i = 0; i < rows.length; i += maxRowsPerChunk) {
    const chunk = rows.slice(i, i + maxRowsPerChunk);
    const params: unknown[] = [];
    const tuples: string[] = [];
    for (const row of chunk) {
      const placeholders: string[] = [];
      for (const c of cols) {
        params.push(coerce(row[c.name], c.dataType));
        placeholders.push(`$${params.length}`);
      }
      tuples.push(`(${placeholders.join(', ')})`);
    }
    await pg.query(`INSERT INTO "${table}" (${colList}) VALUES ${tuples.join(', ')}`, params);
  }
}

void main().catch((err) => {
  console.error('ETL fatal error:', err);
  process.exit(1);
});
