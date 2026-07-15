/**
 * Backfill — reclassify every patient's DERIVED patient_type_id from their works using
 * the code SSoT (classifyPatient, shared/treatment-taxonomy.ts), then retire the legacy
 * patient_types rows 6/7/8 (OPG / Missing / Finisjed / No Photos) once nothing references
 * them. Run on LOCAL — the CDC failover sink forwards the row updates + deletes to Supabase.
 *
 * Run AFTER deploying the classifier code (so no legacy writer resurrects an old value).
 * Idempotent — a 2nd run makes 0 changes.
 *
 *   node --import tsx scripts/backfill-patient-types.mts            # DRY RUN (no writes)
 *   node --import tsx scripts/backfill-patient-types.mts --apply    # write the reclassification + retire 6/7/8
 *
 * .mts (not .mjs like the rest of scripts/) so tsx can import the TypeScript SSoT
 * directly instead of duplicating the classifier in SQL. dotenv/config loads .env
 * BEFORE getKysely() pulls in config/config.ts (which validates env at import).
 */
import 'dotenv/config';
import { sql } from 'kysely';
import { getKysely } from '../services/database/kysely.js';
import {
  classifyPatient,
  PATIENT_TYPE_IDS,
  type ClassifiableWork,
} from '../shared/treatment-taxonomy.js';

const APPLY = process.argv.includes('--apply');
const LEGACY_IDS = [6, 7, 8];

const TYPE_LABEL: Record<number, string> = {
  [PATIENT_TYPE_IDS.ACTIVE_ORTHO]: 'Active Ortho',
  [PATIENT_TYPE_IDS.FORMER_PATIENT]: 'Former Patient',
  [PATIENT_TYPE_IDS.NEW_NO_WORKS]: 'New / No Works',
  [PATIENT_TYPE_IDS.CONSULT]: 'Consult',
  [PATIENT_TYPE_IDS.ACTIVE_NON_ORTHO]: 'Active Non-Ortho',
  [PATIENT_TYPE_IDS.ALIGNER_LAB]: 'Aligner Lab',
  [PATIENT_TYPE_IDS.XRAY]: 'X-ray',
};

function label(id: number | null): string {
  if (id == null) return '(null)';
  return TYPE_LABEL[id] ?? `id ${id}`;
}

async function printDistribution(db: ReturnType<typeof getKysely>, title: string): Promise<void> {
  const rows = await db
    .selectFrom('patients')
    .select(['patient_type_id', (eb) => eb.fn.countAll<number>().as('n')])
    .groupBy('patient_type_id')
    .orderBy('patient_type_id')
    .execute();
  console.log(`\n${title}`);
  for (const r of rows) {
    console.log(`  ${String(r.patient_type_id ?? 'null').padStart(4)}  ${label(r.patient_type_id).padEnd(18)} ${Number(r.n)}`);
  }
}

async function main(): Promise<void> {
  const db = getKysely();
  console.log(`patient-type backfill — ${APPLY ? 'APPLY (writing)' : 'DRY RUN (no writes)'}`);

  await printDistribution(db, 'BEFORE:');

  // Every patient id (so zero-works patients are classified NEW_NO_WORKS too).
  const patients = await db.selectFrom('patients').select('person_id').execute();

  // All works, grouped by patient in JS (one scan, no per-patient query).
  const works = await db
    .selectFrom('works')
    .select(['person_id', 'type_of_work', 'status'])
    .execute();
  const byPatient = new Map<number, ClassifiableWork[]>();
  for (const w of works) {
    const list = byPatient.get(w.person_id) ?? [];
    list.push({ type_of_work: w.type_of_work, status: w.status });
    byPatient.set(w.person_id, list);
  }

  // Bucket patient ids by their computed target type.
  const targetToIds = new Map<number, number[]>();
  for (const p of patients) {
    const target = classifyPatient(byPatient.get(p.person_id) ?? []);
    const bucket = targetToIds.get(target) ?? [];
    bucket.push(p.person_id);
    targetToIds.set(target, bucket);
  }

  // One UPDATE per target type, guarded by IS DISTINCT FROM so unchanged rows are skipped.
  let totalChanged = 0;
  for (const [target, ids] of [...targetToIds.entries()].sort((a, b) => a[0] - b[0])) {
    if (APPLY) {
      const res = await sql`
        UPDATE patients SET patient_type_id = ${target}
        WHERE person_id = ANY(${ids}::int[]) AND patient_type_id IS DISTINCT FROM ${target}
      `.execute(db);
      const changed = Number(res.numAffectedRows ?? 0n);
      totalChanged += changed;
      console.log(`  → ${label(target).padEnd(18)} ${ids.length} patients (${changed} changed)`);
    } else {
      // Dry run: count how many WOULD change without writing.
      const row = await db
        .selectFrom('patients')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('person_id', 'in', ids)
        .where(sql<boolean>`"patient_type_id" IS DISTINCT FROM ${target}`)
        .executeTakeFirst();
      const changed = Number(row?.n ?? 0);
      totalChanged += changed;
      console.log(`  → ${label(target).padEnd(18)} ${ids.length} patients (${changed} would change)`);
    }
  }
  console.log(`\n${APPLY ? 'Changed' : 'Would change'}: ${totalChanged} patient(s).`);

  if (APPLY) await printDistribution(db, 'AFTER:');

  // Retire the legacy rows 6/7/8 once nothing references them. classifyPatient never
  // returns those ids, so after the backfill the reference count must be 0.
  const stillRef = await db
    .selectFrom('patients')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('patient_type_id', 'in', LEGACY_IDS)
    .executeTakeFirst();
  const refCount = Number(stillRef?.n ?? 0);
  if (refCount > 0) {
    console.log(`\nLegacy rows 6/7/8: still referenced by ${refCount} patient(s) — will NOT delete.`);
    if (!APPLY) console.log('  (Re-run with --apply so the reclassification clears them first.)');
  } else if (APPLY) {
    const del = await db.deleteFrom('patient_types').where('id', 'in', LEGACY_IDS).executeTakeFirst();
    console.log(`\nRetired legacy patient_types rows 6/7/8 (${Number(del.numDeletedRows)} deleted).`);
  } else {
    console.log('\nLegacy rows 6/7/8: 0 references — would be deleted on --apply.');
  }

  await db.destroy();
}

main().catch((err) => {
  console.error('backfill failed:', err);
  process.exit(1);
});
