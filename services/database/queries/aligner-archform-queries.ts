/**
 * Archform-matching queries — the `aligner_sets.archform_patient_id` link between an
 * aligner set and a patient in Archform's own SQLite database.
 *
 * Split out of aligner-queries.ts (S2/C4). The Archform side is read by
 * services/archform/archform-db.ts (better-sqlite3, third-party file); this module
 * owns only the PG column that records the match.
 */
import { sql } from 'kysely';
import { getKysely, withPgTransaction } from '../kysely.js';
import { log } from '../../../utils/logger.js';
import { CLOSED_WORK_STATUSES } from '../../../shared/contracts/aligner.contract.js';

// ==============================
// ARCHFORM MATCHING QUERIES
// ==============================

export type AlignerSetForMatch = {
  aligner_set_id: number;
  work_id: number;
  person_id: number;
  archform_id: number | null;
  patient_name: string;
  first_name: string | null;
  last_name: string | null;
  set_sequence: number | null;
  doctor_name: string;
  /** The set's work is finished or discontinued — the picker lists those last (FE-F18-13). */
  work_closed: boolean;
};

/**
 * Get all aligner sets with patient context for Archform matching
 */
export async function getSetsWithArchformIds(): Promise<AlignerSetForMatch[]> {
  try {
    const rows = await getKysely()
      .selectFrom('aligner_sets as s')
      .innerJoin('works as w', 's.work_id', 'w.work_id')
      .innerJoin('patients as p', 'w.person_id', 'p.person_id')
      .leftJoin('aligner_doctors as ad', 's.aligner_dr_id', 'ad.dr_id')
      .select((eb) => [
        's.aligner_set_id',
        's.work_id',
        'p.person_id',
        's.archform_id',
        'p.patient_name',
        'p.first_name',
        'p.last_name',
        's.set_sequence',
        eb.fn.coalesce('ad.doctor_name', sql<string>`''`).as('doctor_name'),
        sql<boolean>`${eb.ref('w.status')} in (${sql.join([...CLOSED_WORK_STATUSES])})`.as('work_closed'),
      ])
      .orderBy('p.patient_name')
      .execute();

    return rows;
  } catch (err) {
    log.error('Failed to get sets with archform ids', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/** Why a link was refused: the set already points elsewhere, or the id is already linked. */
export type ArchformLinkConflict =
  | { kind: 'set_already_linked'; currentArchformId: number }
  | { kind: 'id_already_linked'; otherSetId: number };

/**
 * Save or clear a set's `archform_id`. Returns the conflict instead of writing when
 * linking would overwrite another link (FE-F18-3):
 *  - the set is already linked to a DIFFERENT Archform patient — a page loaded
 *    before a colleague's match used to replace that match silently; unmatch first;
 *  - the Archform patient is already linked to ANOTHER set — two sets carrying one
 *    id left one of them unreachable from the matcher.
 * Clearing (null) always succeeds. Both checks run under a row lock on the set.
 */
export async function updateArchformId(
  setId: number,
  archformId: number | null
): Promise<ArchformLinkConflict | null> {
  try {
    return await withPgTransaction(async (trx) => {
      if (archformId !== null) {
        const current = await trx
          .selectFrom('aligner_sets')
          .select('archform_id')
          .where('aligner_set_id', '=', setId)
          .forUpdate()
          .executeTakeFirst();
        if (current?.archform_id != null && current.archform_id !== archformId) {
          return { kind: 'set_already_linked', currentArchformId: current.archform_id } as const;
        }
        const other = await trx
          .selectFrom('aligner_sets')
          .select('aligner_set_id')
          .where('archform_id', '=', archformId)
          .where('aligner_set_id', '<>', setId)
          .executeTakeFirst();
        if (other) return { kind: 'id_already_linked', otherSetId: other.aligner_set_id } as const;
      }
      await trx.updateTable('aligner_sets').set({ archform_id: archformId }).where('aligner_set_id', '=', setId).execute();
      return null;
    });
  } catch (err) {
    log.error('Failed to update archform id', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Clear archform_id from all aligner sets that reference a given Archform patient.
 * Used before deleting an Archform patient to prevent orphaned references.
 */
export async function clearArchformIdByPatientId(archformPatientId: number): Promise<void> {
  try {
    await getKysely()
      .updateTable('aligner_sets')
      .set({ archform_id: null })
      .where('archform_id', '=', archformPatientId)
      .execute();
  } catch (err) {
    log.error('Failed to clear archform id by patient id', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

