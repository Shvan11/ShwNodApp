/**
 * Aligner PATIENT database queries — the patient-facing lists behind the aligner
 * patients screen (all patients, by doctor, and the search box).
 *
 * Split out of aligner-queries.ts (S2/C4). These read `patients` + `works` +
 * `aligner_sets` together; the row shape is the shared `AlignerPatient` contract type.
 */
import { sql } from 'kysely';
import { getKysely } from '../kysely.js';
import { log } from '../../../utils/logger.js';
import type { AlignerPatient } from '../../../shared/contracts/aligner.contract.js';

// ==============================
// ALIGNER PATIENTS QUERIES
// ==============================

/**
 * Get all aligner patients (all doctors)
 */
export async function getAllAlignerPatients(): Promise<AlignerPatient[]> {
  try {
    const rows = await getKysely()
      .selectFrom('patients as p')
      .innerJoin('works as w', 'p.person_id', 'w.person_id')
      .innerJoin('work_types as wt', 'w.type_of_work', 'wt.id')
      .innerJoin('aligner_sets as s', 'w.work_id', 's.work_id')
      .where('wt.id', 'in', [19, 20, 21])
      .groupBy([
        'p.person_id',
        'p.first_name',
        'p.last_name',
        'p.patient_name',
        'p.phone',
        'w.work_id',
        'wt.work_type',
        'w.type_of_work',
      ])
      .select((eb) => [
        'p.person_id',
        'p.first_name',
        'p.last_name',
        'p.patient_name',
        'p.phone',
        'w.work_id',
        'wt.work_type',
        'w.type_of_work as WorkTypeID',
        eb.fn.count('s.aligner_set_id').distinct().as('TotalSets'),
        eb.fn
          .sum(sql<number>`case when "s"."is_active" = true then 1 else 0 end`)
          .as('ActiveSets'),
      ])
      .orderBy('p.patient_name')
      .orderBy('p.first_name')
      .orderBy('p.last_name')
      .distinct()
      .execute();

    return rows.map((r) => ({
      person_id: r.person_id,
      first_name: r.first_name,
      last_name: r.last_name,
      patient_name: r.patient_name,
      phone: r.phone,
      workid: r.work_id,
      work_type: r.work_type,
      WorkTypeID: r.WorkTypeID,
      TotalSets: Number(r.TotalSets) || 0,
      ActiveSets: Number(r.ActiveSets) || 0,
    }));
  } catch (err) {
    log.error('Failed to get all aligner patients', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Get aligner patients by doctor id
 */
export async function getAlignerPatientsByDoctor(doctorId: number): Promise<AlignerPatient[]> {
  try {
    const rows = await getKysely()
      .selectFrom('patients as p')
      .innerJoin('works as w', 'p.person_id', 'w.person_id')
      .innerJoin('work_types as wt', 'w.type_of_work', 'wt.id')
      .innerJoin('aligner_sets as s', 'w.work_id', 's.work_id')
      .where('wt.id', 'in', [19, 20, 21])
      .where('s.aligner_dr_id', '=', doctorId)
      .groupBy([
        'p.person_id',
        'p.first_name',
        'p.last_name',
        'p.patient_name',
        'p.phone',
        'w.work_id',
        'wt.work_type',
        'w.type_of_work',
      ])
      .select((eb) => [
        'p.person_id',
        'p.first_name',
        'p.last_name',
        'p.patient_name',
        'p.phone',
        'w.work_id',
        'wt.work_type',
        'w.type_of_work as WorkTypeID',
        eb.fn.count('s.aligner_set_id').distinct().as('TotalSets'),
        eb.fn
          .sum(sql<number>`case when "s"."is_active" = true then 1 else 0 end`)
          .as('ActiveSets'),
        eb
          .selectFrom('aligner_notes as n')
          .innerJoin('aligner_sets as sets', 'n.aligner_set_id', 'sets.aligner_set_id')
          .whereRef('sets.work_id', '=', 'w.work_id')
          .where('n.note_type', '=', 'Doctor')
          .where('n.is_read', '=', false)
          .select((e) => e.fn.countAll().as('cnt'))
          .as('UnreadDoctorNotes'),
      ])
      .orderBy('p.patient_name')
      .orderBy('p.first_name')
      .orderBy('p.last_name')
      .distinct()
      .execute();

    return rows.map((r) => ({
      person_id: r.person_id,
      first_name: r.first_name,
      last_name: r.last_name,
      patient_name: r.patient_name,
      phone: r.phone,
      workid: r.work_id,
      work_type: r.work_type,
      WorkTypeID: r.WorkTypeID,
      TotalSets: Number(r.TotalSets) || 0,
      ActiveSets: Number(r.ActiveSets) || 0,
      UnreadDoctorNotes: Number(r.UnreadDoctorNotes) || 0,
    }));
  } catch (err) {
    log.error('Failed to get aligner patients by doctor', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Search for aligner patients
 */
export async function searchAlignerPatients(
  searchTerm: string,
  doctorId: number | null = null
): Promise<AlignerPatient[]> {
  try {
    const like = `%${searchTerm}%`;

    let q = getKysely()
      .selectFrom('patients as p')
      .innerJoin('works as w', 'p.person_id', 'w.person_id')
      .innerJoin('work_types as wt', 'w.type_of_work', 'wt.id')
      .innerJoin('aligner_sets as s', 'w.work_id', 's.work_id')
      .where('wt.id', 'in', [19, 20, 21])
      .where((eb) =>
        eb.or([
          // `::text ILIKE` (not citext LIKE): same case-insensitive semantics as Arabic_CI_AS,
          // but it matches the gin_trgm_ops expression indexes ix_patients_*_trgm — citext's own
          // LIKE operator can't use them. Every OR branch must stay indexable (BitmapOr), so the
          // concat branch has its own index (ix_patients_fullname_trgm) on this exact expression.
          eb(sql<string>`${eb.ref('p.first_name')}::text`, 'ilike', like),
          eb(sql<string>`${eb.ref('p.last_name')}::text`, 'ilike', like),
          eb(sql<string>`${eb.ref('p.patient_name')}::text`, 'ilike', like),
          eb(sql<string>`${eb.ref('p.phone')}::text`, 'ilike', like),
          eb(sql<string>`${eb.ref('p.first_name')}::text || ' ' || ${eb.ref('p.last_name')}::text`, 'ilike', like),
        ])
      );

    if (doctorId && !isNaN(doctorId)) {
      q = q.where('s.aligner_dr_id', '=', doctorId);
    }

    const rows = await q
      .select([
        'p.person_id',
        'p.first_name',
        'p.last_name',
        'p.patient_name',
        'p.phone',
        'w.work_id as workid',
        'wt.work_type',
        'w.type_of_work as WorkTypeID',
      ])
      .distinct()
      .orderBy('p.first_name')
      .orderBy('p.last_name')
      .execute();

    return rows as AlignerPatient[];
  } catch (err) {
    log.error('Failed to search aligner patients', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
