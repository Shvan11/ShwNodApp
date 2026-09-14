/**
 * Work TRANSFER queries — moving a work (and therefore everything hanging off it)
 * from one patient to another, plus the preview counts the confirm dialog shows.
 *
 * Split out of work-queries.ts: this is one self-contained feature whose only tie
 * to the core module is the `getWorkById` read it starts from.
 */
import { sql } from 'kysely';
import { getKysely, withPgTransaction } from '../kysely.js';
import { recomputePatientType } from './patient-type-classifier.js';
import { getWorkById } from './work-queries.js';

/**
 * Related record counts for work transfer preview
 */
// `type` (not interface) — feeds a looseObject `sendData` response (transfer-preview);
// imported only as a type by WorkService + re-exported, so the flip is safe.
export type WorkRelatedCounts = {
  visits: number;
  invoices: number;
  diagnoses: number;
  workItems: number;
  alignerSets: number;
  alignerBatches: number;
  wires: number;
  implants: number;
  screws: number;
};

/**
 * Work transfer result
 */
// `type` (not interface) — feeds a looseObject `sendData` response (transfer).
export type TransferWorkResult = {
  success: boolean;
  workId: number;
  sourcePatientId: number;
  targetPatientId: number;
  relatedCounts: WorkRelatedCounts;
};

/**
 * Get counts of all related records for a work
 * Used to show what will be transferred in the preview
 */
export async function getWorkRelatedCounts(workId: number): Promise<WorkRelatedCounts> {
  const db = getKysely();
  const row = await db
    .selectNoFrom((eb) => [
      eb
        .selectFrom('visits')
        .select(eb.fn.countAll<number>().as('c'))
        .where('work_id', '=', workId)
        .as('visits'),
      eb
        .selectFrom('invoices')
        .select(eb.fn.countAll<number>().as('c'))
        .where('work_id', '=', workId)
        .as('invoices'),
      eb
        .selectFrom('diagnoses')
        .select(eb.fn.countAll<number>().as('c'))
        .where('work_id', '=', workId)
        .as('diagnoses'),
      eb
        .selectFrom('work_items')
        .select(eb.fn.countAll<number>().as('c'))
        .where('work_id', '=', workId)
        .as('workItems'),
      eb
        .selectFrom('aligner_sets')
        .select(eb.fn.countAll<number>().as('c'))
        .where('work_id', '=', workId)
        .as('alignerSets'),
      eb
        .selectFrom('aligner_batches as ab')
        .innerJoin('aligner_sets as s', 's.aligner_set_id', 'ab.aligner_set_id')
        .select(eb.fn.countAll<number>().as('c'))
        .where('s.work_id', '=', workId)
        .as('alignerBatches'),
      // Distinct upper + lower wire ids referenced by this work's visits.
      sql<number>`(
        SELECT COUNT(DISTINCT "upper_wire_id") + COUNT(DISTINCT "lower_wire_id")
        FROM "visits"
        WHERE "work_id" = ${workId}
          AND ("upper_wire_id" IS NOT NULL OR "lower_wire_id" IS NOT NULL)
      )`.as('wires'),
      eb
        .selectFrom('implants')
        .select(eb.fn.countAll<number>().as('c'))
        .where('work_id', '=', workId)
        .as('implants'),
      eb
        .selectFrom('screws')
        .select(eb.fn.countAll<number>().as('c'))
        .where('work_id', '=', workId)
        .as('screws'),
    ])
    .executeTakeFirstOrThrow();

  return {
    visits: Number(row.visits),
    invoices: Number(row.invoices),
    diagnoses: Number(row.diagnoses),
    workItems: Number(row.workItems),
    alignerSets: Number(row.alignerSets),
    alignerBatches: Number(row.alignerBatches),
    wires: Number(row.wires),
    implants: Number(row.implants),
    screws: Number(row.screws),
  };
}

/**
 * Transfer a work to a new patient
 * All related records (visits, invoices, wires, etc.) automatically follow
 * because they link via work_id, not person_id
 */
export async function transferWork(
  workId: number,
  targetPatientId: number
): Promise<TransferWorkResult> {
  // Get source patient id and related counts before transfer
  const work = await getWorkById(workId);
  if (!work) {
    throw new Error(`Work ${workId} not found`);
  }

  const relatedCounts = await getWorkRelatedCounts(workId);
  const sourcePatientId = work.person_id;

  // Execute the transfer - simple UPDATE since all related tables link via work_id
  await withPgTransaction(async (trx) => {
    await trx
      .updateTable('works')
      .set({ person_id: targetPatientId })
      .where('work_id', '=', workId)
      .execute();

    // The work moved between two patients — both may cross a classification
    // boundary (source loses it, target gains it), so reclassify both in-trx.
    await recomputePatientType(trx, sourcePatientId);
    await recomputePatientType(trx, targetPatientId);
  });

  return {
    success: true,
    workId,
    sourcePatientId,
    targetPatientId,
    relatedCounts,
  };
}
