/**
 * Unified CDC — portal sink. Transformed projection: the 6 portal entities, mapped to the curated
 * snake_case Supabase schema the external aligner portal reads. Reuses the existing transform
 * (fetchRecordFromPg) and re-applies the portal's business filters that the old app-level enqueue
 * encoded — WITHOUT them, triggers would push all 6,518 patients (not just aligner ones) to the
 * portal, a data-exposure regression:
 *   - tblwork:        only if the work has an aligner set        (was enqueueWorkIfAligner)
 *   - tblpatients:    only if the patient owns aligner work      (was enqueuePatientIfAligner)
 *   - tblAlignerNotes only "Lab" notes (Doctor notes originate in the portal — this also breaks
 *                     the reverse→forward loop for doctor edits)
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getKysely } from '../../database/kysely.js';
import { fetchRecordFromPg, type SyncRecord } from '../sync-fetch.js';
import { log } from '../../../utils/logger.js';
import type { SyncSink } from './types.js';

/** local table → portal (Supabase) table + portal PK column. */
const PORTAL_MAP: Readonly<Record<string, { table: string; pk: string }>> = {
  tblpatients: { table: 'patients', pk: 'person_id' },
  tblwork: { table: 'work', pk: 'work_id' },
  AlignerDoctors: { table: 'aligner_doctors', pk: 'dr_id' },
  tblAlignerSets: { table: 'aligner_sets', pk: 'aligner_set_id' },
  tblAlignerBatches: { table: 'aligner_batches', pk: 'aligner_batch_id' },
  tblAlignerNotes: { table: 'aligner_notes', pk: 'note_id' },
};

async function isWorkAligner(workId: number): Promise<boolean> {
  const r = await getKysely()
    .selectFrom('tblAlignerSets')
    .select('AlignerSetID')
    .where('WorkID', '=', workId)
    .limit(1)
    .executeTakeFirst();
  return !!r;
}

async function isPatientAligner(personId: number): Promise<boolean> {
  const r = await getKysely()
    .selectFrom('tblwork as w')
    .innerJoin('tblAlignerSets as s', 's.WorkID', 'w.workid')
    .select('s.AlignerSetID')
    .where('w.PersonID', '=', personId)
    .limit(1)
    .executeTakeFirst();
  return !!r;
}

async function isLabNote(noteId: number): Promise<boolean> {
  const r = await getKysely()
    .selectFrom('tblAlignerNotes')
    .select('NoteType')
    .where('NoteID', '=', noteId)
    .executeTakeFirst();
  return r?.NoteType === 'Lab';
}

export class PortalSink implements SyncSink {
  readonly name = 'portal';
  private supabase: SupabaseClient | null = null;

  async init(): Promise<void> {
    const url = process.env.SUPABASE_URL ?? '';
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
    if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
    this.supabase = createClient(url, key);
  }

  async close(): Promise<void> {
    this.supabase = null;
  }

  async upsert(localTable: string, pk: string): Promise<void> {
    const map = PORTAL_MAP[localTable];
    if (!map) return; // not a portal entity
    const id = Number(pk);

    // Business filters (preserve old enqueue semantics; also damp reverse→forward loops).
    if (localTable === 'tblwork' && !(await isWorkAligner(id))) return;
    if (localTable === 'tblpatients' && !(await isPatientAligner(id))) return;
    if (localTable === 'tblAlignerNotes' && !(await isLabNote(id))) return;

    const record = await fetchRecordFromPg(map.table, id);
    if (!record) {
      await this.remove(localTable, pk);
      return;
    }

    await this.ensureRelatedRecordsExist(record, map.table);
    const { error } = await this.supabase!.from(map.table).upsert(record, { onConflict: map.pk });
    if (error) throw new Error(error.message);
  }

  async remove(localTable: string, pk: string): Promise<void> {
    const map = PORTAL_MAP[localTable];
    if (!map) return;
    const { error } = await this.supabase!.from(map.table).delete().eq(map.pk, Number(pk));
    if (error) throw new Error(error.message);
  }

  /**
   * Ensure parent rows exist in the portal before upserting a child (FK chain
   * aligner_batches → aligner_sets → work → patients). Fetches a missing parent from PG and
   * upserts it. Non-fatal — logs and continues. (Moved from the retired queue-processor.)
   */
  private async ensureRelatedRecordsExist(data: SyncRecord, portalTable: string): Promise<void> {
    const sb = this.supabase!;
    try {
      if (portalTable === 'aligner_sets' && 'work_id' in data) {
        const workId = data.work_id;
        const { error } = await sb.from('work').select('work_id').eq('work_id', workId).single();
        if (error && error.code === 'PGRST116') {
          const workData = await fetchRecordFromPg('work', workId as number);
          if (workData) {
            await this.ensureRelatedRecordsExist(workData, 'work');
            await sb.from('work').upsert(workData, { onConflict: 'work_id' });
          }
        }
      }

      if (portalTable === 'work' && 'person_id' in data) {
        const personId = data.person_id;
        const { error } = await sb.from('patients').select('person_id').eq('person_id', personId).single();
        if (error && error.code === 'PGRST116') {
          const patientData = await fetchRecordFromPg('patients', personId as number);
          if (patientData) await sb.from('patients').upsert(patientData, { onConflict: 'person_id' });
        }
      }

      if (portalTable === 'aligner_batches' && 'aligner_set_id' in data) {
        const setId = data.aligner_set_id;
        const { error } = await sb.from('aligner_sets').select('aligner_set_id').eq('aligner_set_id', setId).single();
        if (error && error.code === 'PGRST116') {
          const setData = await fetchRecordFromPg('aligner_sets', setId as number);
          if (setData) {
            await this.ensureRelatedRecordsExist(setData, 'aligner_sets');
            await sb.from('aligner_sets').upsert(setData, { onConflict: 'aligner_set_id' });
          }
        }
      }
    } catch (error) {
      log.warn(`[cdc:portal] ensuring related records failed (continuing)`, { error: (error as Error).message });
    }
  }
}
