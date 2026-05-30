/**
 * Phase 8 smoke test — app-level Supabase-sync enqueue + on-demand PG fetch.
 *
 * Safe: the enqueue is exercised inside a transaction that is ALWAYS rolled back, so the
 * live SyncQueue is never mutated. No Supabase calls are made (processors are not invoked).
 *
 * Run twice to cover both gate states:
 *   SYNC_ENABLED=true  DB_DRIVER=pg npx tsx scripts/check-pg-phase8.ts   → enqueue inserts
 *   SYNC_ENABLED=false DB_DRIVER=pg npx tsx scripts/check-pg-phase8.ts   → enqueue no-ops
 */
import config from '../config/config.js';
import { getKysely, getPgPool } from '../services/database/kysely.js';
import { enqueueSync } from '../services/sync/sync-queue.js';
import {
  fetchWorkFromPg,
  fetchPatientFromPg,
  fetchAlignerSetFromPg,
  fetchAlignerBatchFromPg,
  fetchDoctorFromPg,
  fetchNoteFromPg,
} from '../services/sync/sync-fetch.js';

const SENTINEL = 999_999_999; // a RecordID that cannot collide with real data

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function firstId(table: 'tblwork' | 'tblpatients' | 'tblAlignerSets' | 'tblAlignerBatches' | 'AlignerDoctors' | 'tblAlignerNotes', col: string): Promise<number | null> {
  const row = await getKysely()
    .selectFrom(table as never)
    .select(col as never)
    .limit(1)
    .executeTakeFirst();
  return row ? (row as Record<string, number>)[col] : null;
}

async function main(): Promise<void> {
  console.log(`\n=== Phase 8 smoke — sync.enabled = ${config.sync.enabled} ===\n`);

  // 1) enqueue gate behaviour, inside an always-rolled-back transaction.
  try {
    await getKysely()
      .transaction()
      .execute(async (trx) => {
        await enqueueSync(trx, 'work', SENTINEL, 'UPDATE');
        const row = await trx
          .selectFrom('SyncQueue')
          .select((eb) => eb.fn.countAll<number>().as('n'))
          .where('RecordID', '=', SENTINEL)
          .executeTakeFirst();
        const count = Number(row?.n ?? 0);
        const expected = config.sync.enabled ? 1 : 0;
        check(
          `enqueueSync ${config.sync.enabled ? 'inserts when enabled' : 'no-ops when disabled'}`,
          count === expected,
          `rows=${count} expected=${expected}`
        );
        throw new Error('__rollback__'); // never commit the sentinel
      });
  } catch (err) {
    if ((err as Error).message !== '__rollback__') throw err;
  }

  // Confirm nothing leaked outside the rolled-back txn.
  const leaked = await getKysely()
    .selectFrom('SyncQueue')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('RecordID', '=', SENTINEL)
    .executeTakeFirst();
  check('no sentinel row leaked after rollback', Number(leaked?.n ?? 0) === 0);

  // 2) on-demand fetch shapes (read-only) for every synced table type.
  const workId = await firstId('tblwork', 'workid');
  const personId = await firstId('tblpatients', 'PersonID');
  const setId = await firstId('tblAlignerSets', 'AlignerSetID');
  const batchId = await firstId('tblAlignerBatches', 'AlignerBatchID');
  const drId = await firstId('AlignerDoctors', 'DrID');
  const noteId = await firstId('tblAlignerNotes', 'NoteID');

  if (workId != null) {
    const r = await fetchWorkFromPg(workId);
    check('fetchWorkFromPg', !!r && r.work_id === workId && 'person_id' in r);
  }
  if (personId != null) {
    const r = await fetchPatientFromPg(personId);
    check('fetchPatientFromPg', !!r && r.person_id === personId && 'patient_name' in r);
  }
  if (setId != null) {
    const r = await fetchAlignerSetFromPg(setId);
    check('fetchAlignerSetFromPg', !!r && r.aligner_set_id === setId && 'remaining_upper_aligners' in r);
  }
  if (batchId != null) {
    const r = await fetchAlignerBatchFromPg(batchId);
    check('fetchAlignerBatchFromPg', !!r && r.aligner_batch_id === batchId && 'has_upper_template' in r);
  }
  if (drId != null) {
    const r = await fetchDoctorFromPg(drId);
    check('fetchDoctorFromPg', !!r && r.dr_id === drId && 'doctor_name' in r);
  }
  if (noteId != null) {
    const r = await fetchNoteFromPg(noteId);
    check('fetchNoteFromPg', !!r && r.note_id === noteId && 'note_type' in r);
  } else {
    console.log('ℹ️  no rows in tblAlignerNotes — skipping fetchNoteFromPg');
  }

  console.log(`\n${failures === 0 ? '✅ ALL PASS' : `❌ ${failures} FAILURE(S)`}\n`);
  await getPgPool().end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Smoke crashed:', err);
  process.exit(1);
});
