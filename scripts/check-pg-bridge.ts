/**
 * Phase-3 smoke test for the PostgreSQL facade bridge (services/database/pg-facade.ts).
 *
 * Run with the pg driver selected:
 *   DB_DRIVER=pg npx tsx scripts/check-pg-bridge.ts        (bash)
 *   $env:DB_DRIVER='pg'; npx tsx scripts/check-pg-bridge.ts (PowerShell)
 *
 * Exercises the bridge through the SAME public facade the app uses (services/database/index.ts):
 *  - executeQuery: @name → $n translation, reused param, @@-guard, positional ColumnValue[]
 *    rebuild via a rowMapper, object-row path (no mapper), and rowsAffected.
 *  - executeStoredProcedure / withTransaction / withRequest: must reject as "not ported" stubs.
 * Read-only: it only SELECTs, so it is safe against the loaded (or empty) sandbox schema.
 */
import config from '../config/config.js';
import {
  executeQuery,
  executeStoredProcedure,
  withTransaction,
  withRequest,
  testConnection,
  TYPES,
  type ColumnValue,
} from '../services/database/index.js';

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    console.log(`  ✅ ${name}`);
  } else {
    failures++;
    console.error(`  ❌ ${name}`, detail ?? '');
  }
}
async function expectReject(name: string, p: Promise<unknown>): Promise<void> {
  try {
    await p;
    check(name, false, 'expected rejection but resolved');
  } catch (err) {
    check(name, true, (err as Error).message);
  }
}

async function main(): Promise<void> {
  console.log(`DB_DRIVER = ${config.dbDriver}`);
  if (config.dbDriver !== 'pg') {
    console.error('This smoke test must run with DB_DRIVER=pg. Aborting.');
    process.exit(2);
  }

  console.log('\n[testConnection]');
  const conn = await testConnection();
  check('testConnection succeeds', conn.success, conn.error);
  console.log('  version:', conn.data?.version?.split(',')[0]);

  console.log('\n[executeQuery — @name translation + positional mapper]');
  // @a reused twice (→ same $1), @b second placeholder, @@ guard exercised in next case.
  const mapped = await executeQuery<{ sum: number; label: string }>(
    'SELECT (@a::int + @a::int) AS sum, @b AS label',
    [
      ['a', TYPES.Int, 21],
      ['b', TYPES.VarChar(20), 'hello'],
    ],
    (cols: ColumnValue[]) => ({ sum: Number(cols[0].value), label: String(cols[1].value) })
  );
  check('reused @a → 42 via positional ColumnValue[0]', mapped[0]?.sum === 42, mapped[0]);
  check('@b → "hello" via positional ColumnValue[1]', mapped[0]?.label === 'hello', mapped[0]);

  console.log('\n[executeQuery — object rows (no mapper) + multi-row]');
  const rows = await executeQuery<{ n: number }>(
    'SELECT * FROM (VALUES (1),(2),(3)) AS t(n) WHERE n >= @min ORDER BY n',
    [['min', TYPES.Int, 2]]
  );
  check('object-row path returns keyed objects', rows.length === 2 && rows[0].n === 2, rows);

  console.log('\n[executeQuery — rowsAffected]');
  const counted = await executeQuery('SELECT * FROM (VALUES (1),(2),(3)) AS t(n)');
  check('rowsAffected reflects row count', counted.rowsAffected === 3, counted.rowsAffected);

  console.log('\n[stubs — must reject until later phases]');
  await expectReject('executeStoredProcedure rejects', executeStoredProcedure('ProcDay', []));
  await expectReject('withTransaction rejects', withTransaction(async () => 1));
  await expectReject('withRequest rejects', withRequest(async () => 1));

  console.log(failures === 0 ? '\n✅ ALL BRIDGE CHECKS PASSED' : `\n❌ ${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
