/**
 * Phase 10 — READ-ONLY drift finder. Pinpoints exactly how the sandbox PG (shwan_test) differs
 * from live production SQL Server (ShwanNew) on key keyed tables, and checks that the PG-only
 * enhancement tables reference only PersonIDs that exist in production (FK-safety for the copy).
 *
 * Strictly SELECT-only on both sides. Run:
 *   $env:DB_DATABASE='ShwanNew'; $env:PG_DATABASE='shwan_test'; npx tsx scripts/diff-sandbox-vs-prod.ts
 */
import { getPool } from '../services/database/pool.js';
import { getPgPool } from '../services/database/kysely.js';
import config from '../config/config.js';
import ResourceManager from '../services/core/ResourceManager.js';

async function intSet(query: () => Promise<number[]>): Promise<Set<number>> {
  return new Set(await query());
}

async function main(): Promise<void> {
  if (config.database.database !== 'ShwanNew') throw new Error(`Set DB_DATABASE=ShwanNew (got ${config.database.database})`);
  if (config.databasePg.database !== 'shwan_test') throw new Error(`Set PG_DATABASE=shwan_test (got ${config.databasePg.database})`);

  const mssql = await getPool();
  const pg = getPgPool();

  // ── Patients: who is in sandbox but not prod (and vice versa) ──
  const prodPatients = await intSet(async () => {
    const { recordset } = await mssql.request().query<{ id: number }>(`SELECT PersonID AS id FROM dbo.tblpatients`);
    return recordset.map((r) => r.id);
  });
  const sbPatients = await intSet(async () => {
    const { rows } = await pg.query<{ id: number }>(`SELECT "PersonID" AS id FROM "tblpatients"`);
    return rows.map((r) => r.id);
  });
  const sbOnly = [...sbPatients].filter((id) => !prodPatients.has(id));
  const prodOnly = [...prodPatients].filter((id) => !sbPatients.has(id));
  console.log(`tblpatients — prod ${prodPatients.size}, sandbox ${sbPatients.size}`);
  console.log(`  sandbox-only PersonIDs (${sbOnly.length}): ${sbOnly.join(', ') || '(none)'}`);
  console.log(`  prod-only    PersonIDs (${prodOnly.length}): ${prodOnly.join(', ') || '(none)'}`);
  for (const id of sbOnly) {
    const { rows } = await pg.query(`SELECT "PersonID","FirstName","LastName","Phone","DateofBirth" FROM "tblpatients" WHERE "PersonID"=$1`, [id]);
    console.log(`    sandbox-only patient ${id}: ${JSON.stringify(rows[0])}`);
  }

  // ── Aligner sets: which set IDs differ (the orphan cleanup) ──
  const prodSets = await intSet(async () => {
    const { recordset } = await mssql.request().query<{ id: number }>(`SELECT AlignerSetID AS id FROM dbo.tblAlignerSets`);
    return recordset.map((r) => r.id);
  });
  const sbSets = await intSet(async () => {
    const { rows } = await pg.query<{ id: number }>(`SELECT "AlignerSetID" AS id FROM "tblAlignerSets"`);
    return rows.map((r) => r.id);
  });
  const setsProdOnly = [...prodSets].filter((id) => !sbSets.has(id));
  const setsSbOnly = [...sbSets].filter((id) => !prodSets.has(id));
  console.log(`\ntblAlignerSets — prod ${prodSets.size}, sandbox ${sbSets.size}`);
  console.log(`  prod-only SetIDs (in prod, removed from sandbox): ${setsProdOnly.join(', ') || '(none)'}`);
  console.log(`  sandbox-only SetIDs: ${setsSbOnly.join(', ') || '(none)'}`);

  // ── Enhancement FK-safety: every tblTimePoints.PersonID must exist in PROD patients ──
  const { rows: tpPersons } = await pg.query<{ id: number }>(`SELECT DISTINCT "PersonID" AS id FROM "tblTimePoints" WHERE "PersonID" IS NOT NULL`);
  const tpMissingInProd = tpPersons.map((r) => r.id).filter((id) => !prodPatients.has(id));
  console.log(`\ntblTimePoints references ${tpPersons.length} distinct PersonIDs`);
  console.log(`  PersonIDs NOT in prod patients (would break FK if copied onto prod base): ${tpMissingInProd.join(', ') || '(none) ✅'}`);

  await ResourceManager.gracefulShutdown('diff-sandbox-vs-prod');
  process.exit(0);
}

void main().catch((err) => { console.error('Diff failed:', err); process.exit(1); });
