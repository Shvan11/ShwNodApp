/**
 * Patient-type classifier plumbing — the ONE place that recomputes a patient's
 * DERIVED type (patients.patient_type_id) from their works and materializes it.
 *
 * Its own module (not patient-queries / work-queries) so it can be imported by
 * every works write path without creating a work↔patient query import cycle. The
 * pure classification rule lives in shared/treatment-taxonomy.ts (classifyPatient);
 * this module is just the works read + the guarded materializing write.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../kysely.js';
import { classifyPatient } from '../../../shared/treatment-taxonomy.js';

/**
 * Recompute + materialize a patient's derived type. Reads the patient's works,
 * classifies them, and UPDATEs patients.patient_type_id ONLY when the value
 * actually changes (`IS DISTINCT FROM`, NULL-safe) — the no-op guard stops an
 * unrelated work write from re-stamping updated_at / spamming change_log (and
 * therefore forward CDC) on every recompute.
 *
 * `Transaction<Database>` extends `Kysely<Database>`, so one signature serves both
 * a standalone call (`getKysely()`) and an in-transaction call — pass the trx to
 * keep the reclassification atomic with the work write that triggered it.
 */
export async function recomputePatientType(
  executor: Kysely<Database>,
  personId: number
): Promise<void> {
  const works = await executor
    .selectFrom('works')
    .select(['type_of_work', 'status'])
    .where('person_id', '=', personId)
    .execute();

  const newType = classifyPatient(works);

  await executor
    .updateTable('patients')
    .set({ patient_type_id: newType })
    .where('person_id', '=', personId)
    // NULL-safe change guard (Kysely 0.29 has no `is distinct from` operator).
    .where(sql<boolean>`"patient_type_id" IS DISTINCT FROM ${newType}`)
    .execute();
}

/**
 * Resolve a work's owning patient and recompute their type. No-op when the work
 * is already gone (e.g. a delete raced ahead). Used by the photo roll-up hooks,
 * which know the workId but not the person_id.
 */
export async function recomputePatientTypeForWork(
  executor: Kysely<Database>,
  workId: number
): Promise<void> {
  const row = await executor
    .selectFrom('works')
    .select('person_id')
    .where('work_id', '=', workId)
    .executeTakeFirst();
  if (!row) return;
  await recomputePatientType(executor, row.person_id);
}
