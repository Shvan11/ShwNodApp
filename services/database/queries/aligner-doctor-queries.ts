/**
 * Aligner DOCTOR database queries — the `aligner_doctors` table.
 *
 * Split out of aligner-queries.ts (S2/C4). An aligner doctor is an EXTERNAL
 * referring dentist who owns aligner sets and reads/writes notes through the
 * doctor portal; they are not `employees`.
 */
import { getKysely, withPgTransaction } from '../kysely.js';
import { log } from '../../../utils/logger.js';

type AlignerDoctor = {
  dr_id: number;
  doctor_name: string;
  doctor_email: string | null;
  logo_path: string | null;
};

type AlignerDoctorWithUnread = AlignerDoctor & {
  UnreadDoctorNotes: number;
  // Aliased properties for frontend compatibility
  id: number;
  name: string;
  logoPath: string | null;
};

interface DoctorData {
  doctor_name: string;
  doctor_email?: string | null;
  logo_path?: string | null;
}

// ==============================
// ALIGNER DOCTORS QUERIES
// ==============================

/**
 * Get all aligner doctors with unread notes count
 */
export async function getDoctorsWithUnreadCounts(): Promise<AlignerDoctorWithUnread[]> {
  try {
    const rows = await getKysely()
      .selectFrom('aligner_doctors as ad')
      .select((eb) => [
        'ad.dr_id',
        'ad.doctor_name',
        'ad.logo_path',
        eb
          .selectFrom('aligner_notes as n')
          .innerJoin('aligner_sets as s', 'n.aligner_set_id', 's.aligner_set_id')
          .whereRef('s.aligner_dr_id', '=', 'ad.dr_id')
          .where('n.note_type', '=', 'Doctor')
          .where('n.is_read', '=', false)
          .select((e) => e.fn.countAll().as('cnt'))
          .as('UnreadDoctorNotes'),
      ])
      .distinct()
      .orderBy('ad.doctor_name')
      .execute();

    return rows.map((r) => ({
      dr_id: r.dr_id,
      doctor_name: r.doctor_name,
      doctor_email: null,
      logo_path: r.logo_path,
      UnreadDoctorNotes: Number(r.UnreadDoctorNotes) || 0,
      // Aliased properties for frontend compatibility (PrintQueueContext expects these)
      id: r.dr_id,
      name: r.doctor_name,
      logoPath: r.logo_path,
    }));
  } catch (err) {
    log.error('Failed to get doctors with unread counts', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Get all aligner doctors (simple list)
 */
export async function getAllDoctors(): Promise<AlignerDoctor[]> {
  try {
    return (await getKysely()
      .selectFrom('aligner_doctors')
      .select(['dr_id', 'doctor_name', 'doctor_email', 'logo_path'])
      .orderBy('doctor_name')
      .execute()) as AlignerDoctor[];
  } catch (err) {
    log.error('Failed to get all doctors', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Check if doctor email exists (excluding specific doctor)
 */
export async function isDoctorEmailTaken(
  email: string,
  excludeDrID: number | null = null
): Promise<boolean> {
  if (!email || email.trim() === '') {
    return false;
  }

  try {
    let q = getKysely()
      .selectFrom('aligner_doctors')
      .select('dr_id')
      // doctor_email is citext → case-insensitive comparison, matching Arabic_CI_AS.
      .where('doctor_email', '=', email.trim());

    if (excludeDrID) {
      q = q.where('dr_id', '!=', excludeDrID);
    }

    const row = await q.executeTakeFirst();
    return !!row;
  } catch (err) {
    log.error('Failed to check if doctor email is taken', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Get count of aligner sets for a doctor
 */
export async function getDoctorSetCount(drID: number): Promise<number> {
  try {
    const row = await getKysely()
      .selectFrom('aligner_sets')
      .where('aligner_dr_id', '=', drID)
      .select((eb) => eb.fn.countAll().as('SetCount'))
      .executeTakeFirst();

    return Number(row?.SetCount) || 0;
  } catch (err) {
    log.error('Failed to get doctor set count', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Create a new aligner doctor
 */
export async function createDoctor(doctorData: DoctorData): Promise<number> {
  const { doctor_name, doctor_email, logo_path } = doctorData;

  try {
    return await withPgTransaction(async (trx) => {
      const row = await trx
        .insertInto('aligner_doctors')
        .values({
          doctor_name: doctor_name.trim(),
          doctor_email: doctor_email && doctor_email.trim() !== '' ? doctor_email.trim() : null,
          logo_path: logo_path && logo_path.trim() !== '' ? logo_path.trim() : null,
        })
        .returning('dr_id')
        .executeTakeFirstOrThrow();

      return row.dr_id;
    });
  } catch (err) {
    log.error('Failed to create doctor', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Update an aligner doctor
 */
export async function updateDoctor(drID: number, doctorData: DoctorData): Promise<void> {
  const { doctor_name, doctor_email, logo_path } = doctorData;

  try {
    await withPgTransaction(async (trx) => {
      await trx
        .updateTable('aligner_doctors')
        .set({
          doctor_name: doctor_name.trim(),
          doctor_email: doctor_email && doctor_email.trim() !== '' ? doctor_email.trim() : null,
          logo_path: logo_path && logo_path.trim() !== '' ? logo_path.trim() : null,
        })
        .where('dr_id', '=', drID)
        .execute();

    });
  } catch (err) {
    log.error('Failed to update doctor', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Delete an aligner doctor
 */
export async function deleteDoctor(drID: number): Promise<void> {
  try {
    await withPgTransaction(async (trx) => {
      await trx.deleteFrom('aligner_doctors').where('dr_id', '=', drID).execute();
    });
  } catch (err) {
    log.error('Failed to delete doctor', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
