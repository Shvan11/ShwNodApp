/**
 * Portal-activity queries — the staff "Portal activity" header bell.
 *
 * Reads `aligner_activity_flags` filtered to `source='portal'`: rows the doctor
 * portal INSERTed on the Supabase mirror (RLS pins source/type/own-set — see
 * aligner-portal-external/sql/phase3-announcements.sql) that reverse-sync home.
 * Staff-side flag writes (`source='staff'`, the in-page badges written by
 * aligner-queries.ts) are deliberately invisible here.
 *
 * Mark-read flips `is_read`/`read_at` locally; the BEFORE-UPDATE
 * `trg_set_updated_at` bumps `updated_at`, so the read state forward-syncs to
 * the mirror (LWW keeps it there).
 *
 * Row types are `type` aliases (not `interface`) — sendData sources must satisfy
 * the contract looseObject's index signature.
 */
import { sql } from 'kysely';
import { getKysely } from '../kysely.js';
import { log } from '../../../utils/logger.js';
import type { PortalActivityType } from '../../../shared/contracts/portal-activity.contract.js';

// Matches portalActivityContract.portalActivityRow (timestamps are Date on the
// server; the contract's timestampString serializes them).
type PortalActivityFeedRow = {
  activity_id: number;
  aligner_set_id: number;
  activity_type: PortalActivityType;
  activity_description: string;
  created_at: Date | null;
  is_read: boolean | null;
  read_at: Date | null;
  related_record_id: number | null;
  work_id: number | null;
  set_sequence: number | null;
  person_id: number | null;
  patient_name: string | null;
  dr_id: number | null;
  doctor_name: string | null;
};

const DEFAULT_FEED_LIMIT = 200;

/**
 * The bell feed: portal-originated flags, newest first, joined to the set →
 * work → patient chain + the owning aligner doctor (left joins — a flag must
 * still surface if its set was deleted out from under it).
 */
export async function getPortalActivityFeed(
  opts: { unreadOnly?: boolean; limit?: number } = {}
): Promise<PortalActivityFeedRow[]> {
  try {
    const rows = await getKysely()
      .selectFrom('aligner_activity_flags as f')
      .leftJoin('aligner_sets as s', 's.aligner_set_id', 'f.aligner_set_id')
      .leftJoin('works as w', 'w.work_id', 's.work_id')
      .leftJoin('patients as p', 'p.person_id', 'w.person_id')
      .leftJoin('aligner_doctors as ad', 'ad.dr_id', 's.aligner_dr_id')
      .where('f.source', '=', 'portal')
      .$if(opts.unreadOnly === true, (qb) => qb.where('f.is_read', '=', false))
      .select([
        'f.activity_id',
        'f.aligner_set_id',
        'f.activity_type',
        'f.activity_description',
        'f.created_at',
        'f.is_read',
        'f.read_at',
        'f.related_record_id',
        's.work_id',
        's.set_sequence',
        'w.person_id',
        'p.patient_name',
        'ad.dr_id',
        'ad.doctor_name',
      ])
      .orderBy('f.created_at', 'desc')
      .limit(opts.limit ?? DEFAULT_FEED_LIMIT)
      .execute();

    return rows.map((r) => ({
      activity_id: r.activity_id,
      aligner_set_id: r.aligner_set_id,
      activity_type: r.activity_type as PortalActivityType,
      activity_description: r.activity_description,
      created_at: r.created_at,
      is_read: r.is_read,
      read_at: r.read_at,
      related_record_id: r.related_record_id,
      work_id: r.work_id,
      set_sequence: r.set_sequence,
      person_id: r.person_id,
      patient_name: r.patient_name,
      dr_id: r.dr_id,
      doctor_name: r.doctor_name,
    }));
  } catch (err) {
    log.error('Failed to get portal activity feed', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Mark a batch of feed rows read. Scoped to unread portal rows so replays /
 * staff-flag ids are no-ops; returns the number actually flipped.
 */
export async function markActivityRead(activityIds: number[]): Promise<number> {
  if (activityIds.length === 0) return 0;
  const result = await getKysely()
    .updateTable('aligner_activity_flags')
    .set({ is_read: true, read_at: sql<Date>`LOCALTIMESTAMP` })
    .where('activity_id', 'in', activityIds)
    .where('source', '=', 'portal')
    .where('is_read', '=', false)
    .executeTakeFirst();
  return Number(result.numUpdatedRows);
}

/** Mark every unread portal row read (the bell's "mark all" action). */
export async function markAllActivityRead(): Promise<number> {
  const result = await getKysely()
    .updateTable('aligner_activity_flags')
    .set({ is_read: true, read_at: sql<Date>`LOCALTIMESTAMP` })
    .where('source', '=', 'portal')
    .where('is_read', '=', false)
    .executeTakeFirst();
  return Number(result.numUpdatedRows);
}
