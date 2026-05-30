/**
 * Phase 7 — WRITE-PATH STATE parity (SQL Server ↔ PostgreSQL).
 *
 * For each case we run the SAME write on both backends and diff the RESULTING table STATE
 * (not just the return value) — this validates the reimplemented trigger/proc logic
 * (aligner sequence allocation, remaining-count maintenance, deliver-activation cascade,
 * computed expiry; appointment state-machine).
 *
 *   - SQL Server (`ShwanNew_Test`): the write runs inside `BEGIN TRAN … ROLLBACK`, capturing
 *     the touched-table state mid-transaction → the baseline DB stays PRISTINE.
 *   - PostgreSQL (`shwan_test`): the converted TS function commits its own transaction, so we
 *     capture the state and DO NOT restore per-case. ⚠️ This MUTATES shwan_test — RE-RUN THE
 *     ETL afterwards (`npx tsx scripts/etl-mssql-to-pg.ts`) to restore a faithful copy. The
 *     runner reminds you at the end. Each case targets an independent row, so no intra-run
 *     interference; both DBs start from the same ETL'd data.
 *
 * Run AGAINST A FRESHLY-ETL'd shwan_test:  npx tsx scripts/parity-write.ts [filter]
 */
import sql from 'mssql';
import { getPool } from '../services/database/pool.js';
import { getKysely, getPgPool } from '../services/database/kysely.js';
import * as alignerQ from '../services/database/queries/aligner-queries.js';
import * as apptQ from '../services/database/queries/appointment-queries.js';
import { diff } from './parity-lib.js';

const BATCH_COLS = [
  'BatchSequence', 'UpperAlignerCount', 'LowerAlignerCount',
  'ManufactureDate', 'DeliveredToPatientDate', 'IsActive', 'IsLast', 'BatchExpiryDate',
] as const;

interface WriteCase {
  group: string;
  name: string;
  /** Returns { ms, pg } captured states to diff. Picks its own target row. */
  run: () => Promise<{ ms: unknown; pg: unknown; info?: string }>;
}

const CASES: WriteCase[] = [
  // ── Aligner create → manufacture → deliver: diff resulting set + batch STATE ──
  {
    group: 'aligner-write',
    name: 'createBatch → MANUFACTURE → DELIVER (set+batches state)',
    run: async () => {
      const db = getKysely();
      // pick a set with spare capacity (same predicate the Phase-5 smoke uses), lowest id for determinism
      const cap = await db
        .selectFrom('tblAlignerSets')
        .select('AlignerSetID')
        .where('RemainingUpperAligners', '>', 1)
        .where('RemainingLowerAligners', '>', 1)
        .orderBy('AlignerSetID')
        .limit(1)
        .executeTakeFirstOrThrow();
      const setId = cap.AlignerSetID;

      // ── SQL Server: run the original procs in a rolled-back transaction ──
      const pool = await getPool();
      const msRes = await pool.request().input('sid', sql.Int, setId).query(`
        BEGIN TRAN;
          DECLARE @nb INT;
          EXEC dbo.usp_CreateAlignerBatch @AlignerSetID=@sid, @UpperAlignerCount=1, @LowerAlignerCount=1, @Days=7, @NewBatchID=@nb OUTPUT;
          EXEC dbo.usp_UpdateBatchStatus @AlignerBatchID=@nb, @Action='MANUFACTURE';
          EXEC dbo.usp_UpdateBatchStatus @AlignerBatchID=@nb, @Action='DELIVER';
          SELECT RemainingUpperAligners, RemainingLowerAligners FROM dbo.tblAlignerSets WHERE AlignerSetID=@sid;
          SELECT BatchSequence, UpperAlignerCount, LowerAlignerCount,
                 CONVERT(varchar, ManufactureDate, 23)        AS ManufactureDate,
                 CONVERT(varchar, DeliveredToPatientDate, 23) AS DeliveredToPatientDate,
                 IsActive, IsLast,
                 CONVERT(varchar, BatchExpiryDate, 23)        AS BatchExpiryDate
          FROM dbo.tblAlignerBatches WHERE AlignerSetID=@sid ORDER BY BatchSequence;
        ROLLBACK;
      `);
      // The EXEC'd procs emit their own status result sets, so our two SELECTs are the LAST two.
      const rs = msRes.recordsets as unknown as Record<string, unknown>[][];
      const msState = { set: rs[rs.length - 2][0], batches: rs[rs.length - 1] };

      // ── PostgreSQL: run the converted functions (commits; restored by re-ETL) ──
      const nb = await alignerQ.createBatch({ AlignerSetID: setId, UpperAlignerCount: 1, LowerAlignerCount: 1, Days: 7 });
      await alignerQ.updateBatchStatus(nb!, 'MANUFACTURE');
      await alignerQ.updateBatchStatus(nb!, 'DELIVER');
      const pgSet = await db
        .selectFrom('tblAlignerSets')
        .select(['RemainingUpperAligners', 'RemainingLowerAligners'])
        .where('AlignerSetID', '=', setId)
        .executeTakeFirst();
      const pgBatches = await db
        .selectFrom('tblAlignerBatches')
        .select([...BATCH_COLS])
        .where('AlignerSetID', '=', setId)
        .orderBy('BatchSequence')
        .execute();
      const pgState = { set: pgSet, batches: pgBatches };

      return { ms: msState, pg: pgState, info: `set ${setId}, ${pgBatches.length} batches after` };
    },
  },

  // ── Appointment state-machine: UpdatePresent → diff appointment row state ──
  {
    group: 'appt-write',
    name: 'updatePresent(Present) — appointment state',
    run: async () => {
      const db = getKysely();
      const appt = await db
        .selectFrom('tblappointments')
        .select('appointmentID')
        .where('Present', 'is', null)
        .where('Seated', 'is', null)
        .where('Dismissed', 'is', null)
        .orderBy('appointmentID')
        .limit(1)
        .executeTakeFirstOrThrow();
      const aid = appt.appointmentID;
      const TIM = '10:00';

      const pool = await getPool();
      const msRes = await pool
        .request()
        .input('aid', sql.Int, aid)
        .input('tim', sql.VarChar, TIM)
        .query(`
          BEGIN TRAN;
            EXEC dbo.UpdatePresent @Aid=@aid, @state='Present', @Tim=@tim;
            SELECT Present, Seated, Dismissed FROM dbo.tblappointments WHERE appointmentID=@aid;
          ROLLBACK;
        `);
      const msState = msRes.recordsets[0][0];

      await apptQ.updatePresent(aid, 'Present', TIM);
      const pgState = await db
        .selectFrom('tblappointments')
        .select(['Present', 'Seated', 'Dismissed'])
        .where('appointmentID', '=', aid)
        .executeTakeFirst();

      return { ms: msState, pg: pgState, info: `appointment ${aid}` };
    },
  },
];

async function main(): Promise<void> {
  const filter = process.argv[2]?.toLowerCase();
  const cases = filter ? CASES.filter((c) => (c.group + ' ' + c.name).toLowerCase().includes(filter)) : CASES;

  let pass = 0;
  let fail = 0;
  console.log(`\nPhase-7 WRITE-PATH parity — ${cases.length} case(s)${filter ? ` (filter: ${filter})` : ''}\n`);

  for (const c of cases) {
    try {
      const { ms, pg, info } = await c.run();
      const d = diff(ms, pg);
      if (d.length === 0) {
        console.log(`  ✅ [${c.group}] ${c.name}${info ? `  (${info})` : ''}`);
        pass++;
      } else {
        console.log(`  ❌ [${c.group}] ${c.name}${info ? `  (${info})` : ''}`);
        for (const line of d) console.log(`       • ${line}`);
        fail++;
      }
    } catch (err) {
      console.log(`  ⚠️  [${c.group}] ${c.name} — ERROR: ${(err as Error).message}`);
      fail++;
    }
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'} write-path parity: ${pass} passed, ${fail} failed.`);
  console.log(`⚠️  shwan_test was MUTATED — restore it:  npx tsx scripts/etl-mssql-to-pg.ts\n`);
  await getPgPool().end();
  const msPool = await getPool();
  await msPool.close();
  process.exit(fail === 0 ? 0 : 1);
}

void main();
