/**
 * Aligner NOTE database queries — the `aligner_notes` table, the two-way Lab↔Doctor
 * message thread on an aligner set.
 *
 * Split out of aligner-queries.ts (S2/C4). The set-existence guard the writes call
 * lives with the sets it reads (`aligner-set-queries.ts#alignerSetExists`).
 *
 * Gotcha: `aligner_notes.is_read` DEFAULTs TRUE, so the doctor portal must send
 * `is_read: false` explicitly when it writes (RLS enforces it there).
 */
import { sql } from 'kysely';
import { getKysely, withPgTransaction } from '../kysely.js';
import { log } from '../../../utils/logger.js';

type AlignerNote = {
  note_id: number;
  aligner_set_id: number;
  note_type: 'Lab' | 'Doctor';
  note_text: string;
  created_at: Date;
  is_edited: boolean;
  updated_at: Date | null;
  is_read: boolean;
  doctor_name: string;
};

// ==============================
// ALIGNER NOTES QUERIES
// ==============================

/**
 * Get notes for an aligner set
 */
export async function getNotesBySetId(setId: number): Promise<AlignerNote[]> {
  try {
    const rows = await getKysely()
      .selectFrom('aligner_notes as n')
      .innerJoin('aligner_sets as s', 'n.aligner_set_id', 's.aligner_set_id')
      .innerJoin('aligner_doctors as d', 's.aligner_dr_id', 'd.dr_id')
      .where('n.aligner_set_id', '=', setId)
      .select((eb) => [
        'n.note_id',
        'n.aligner_set_id',
        'n.note_type',
        'n.note_text',
        eb.ref('n.created_at').$castTo<Date>().as('created_at'),
        'n.is_edited',
        eb.ref('n.updated_at').$castTo<Date | null>().as('updated_at'),
        'n.is_read',
        'd.doctor_name',
      ])
      .orderBy('n.created_at', 'desc')
      .execute();

    return rows.map((r) => ({
      note_id: r.note_id,
      aligner_set_id: r.aligner_set_id,
      note_type: r.note_type as 'Lab' | 'Doctor',
      note_text: r.note_text,
      created_at: r.created_at,
      is_edited: !!r.is_edited,
      updated_at: r.updated_at,
      is_read: r.is_read,
      doctor_name: r.doctor_name,
    }));
  } catch (err) {
    log.error('Failed to get notes by set id', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Check if aligner set exists
/**
 * Create a note
 *
 * NOTE (roll-up owned here, not by the DB): a doctor-activity trigger used to fire
 * on INSERT here to maintain doctor-activity flags. That trigger is absent in PG; this
 * statement is translated as the raw INSERT only.
 */
export async function createNote(
  setId: number,
  noteText: string,
  noteType: 'Lab' | 'Doctor' = 'Lab'
): Promise<number> {
  try {
    return await withPgTransaction(async (trx) => {
      const row = await trx
        .insertInto('aligner_notes')
        .values({
          aligner_set_id: setId,
          note_type: noteType,
          note_text: noteText.trim(),
        })
        .returning('note_id')
        .executeTakeFirstOrThrow();

      // trg_AlignerNotes_DoctorActivity: a Doctor note logs a "DoctorNote" activity flag.
      if (noteType === 'Doctor') {
        const doc = await trx
          .selectFrom('aligner_sets as s')
          .leftJoin('aligner_doctors as d', 'd.dr_id', 's.aligner_dr_id')
          .where('s.aligner_set_id', '=', setId)
          .select('d.doctor_name')
          .executeTakeFirst();
        await trx
          .insertInto('aligner_activity_flags')
          .values({
            aligner_set_id: setId,
            activity_type: 'DoctorNote',
            activity_description: `Dr. ${doc?.doctor_name ?? 'Unknown'} added a note`,
            related_record_id: row.note_id,
          })
          .execute();
      }

      return row.note_id;
    });
  } catch (err) {
    log.error('Failed to create note', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

interface NoteInfo {
  note_id: number;
  note_type: 'Lab' | 'Doctor';
}

/**
 * Check if note exists
 */
export async function getNoteById(noteId: number): Promise<NoteInfo | null> {
  try {
    const row = await getKysely()
      .selectFrom('aligner_notes')
      .select(['note_id', 'note_type'])
      .where('note_id', '=', noteId)
      .executeTakeFirst();

    if (!row) return null;
    return { note_id: row.note_id, note_type: row.note_type as 'Lab' | 'Doctor' };
  } catch (err) {
    log.error('Failed to get note by id', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Update a note
 */
export async function updateNote(noteId: number, noteText: string): Promise<void> {
  try {
    await withPgTransaction(async (trx) => {
      await trx
        .updateTable('aligner_notes')
        .set({ note_text: noteText.trim(), is_edited: true })
        .where('note_id', '=', noteId)
        .execute();
    });
  } catch (err) {
    log.error('Failed to update note', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Toggle note read status
 */
export async function toggleNoteReadStatus(noteId: number): Promise<void> {
  try {
    await withPgTransaction(async (trx) => {
      await trx
        .updateTable('aligner_notes')
        .set((eb) => ({
          is_read: sql<boolean>`case when ${eb.ref('is_read')} = true then false else true end`,
        }))
        .where('note_id', '=', noteId)
        .execute();
    });
  } catch (err) {
    log.error('Failed to toggle note read status', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Delete a note
 */
export async function deleteNote(noteId: number): Promise<void> {
  try {
    await withPgTransaction(async (trx) => {
      await trx.deleteFrom('aligner_notes').where('note_id', '=', noteId).execute();
    });
  } catch (err) {
    log.error('Failed to delete note', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Get note read status
 */
export async function getNoteReadStatus(noteId: number): Promise<boolean | null> {
  try {
    const row = await getKysely()
      .selectFrom('aligner_notes')
      .select('is_read')
      .where('note_id', '=', noteId)
      .executeTakeFirst();

    return row ? row.is_read : null;
  } catch (err) {
    log.error('Failed to get note read status', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
