/**
 * Doctor-announcement queries (`doctor_announcements` + `doctor_announcement_reads`).
 *
 * Announcements are staff-authored here and FORWARD-synced to the Supabase
 * mirror, where the aligner portal reads them under RLS (broadcast or own
 * dr_id). Read receipts flow the OTHER way: the portal inserts them on the
 * mirror and reverse sync carries them home, so `getAnnouncementReceipts` /
 * the read_count subquery only ever read local rows.
 *
 * Two flavors share the table: manual staff-composed rows (auto_event NULL) and
 * system batch events written by `insertBatchAutoAnnouncement` inside
 * aligner-queries.ts#updateBatchStatus (deleted again on UNDO via
 * `deleteBatchAutoAnnouncement` — matched by (auto_event, related_batch_id)).
 *
 * Deletes rely on the local FK CASCADE for receipts; both the announcement and
 * the cascaded receipt deletes fire cdc_capture and forward-sync (the mirror's
 * own CASCADE makes the receipt half a no-op there).
 *
 * Row types are `type` aliases (not `interface`) — sendData sources must satisfy
 * the contract looseObject's index signature.
 */
import { sql, type Transaction } from 'kysely';
import { getKysely, type Database } from '../kysely.js';
import { log } from '../../../utils/logger.js';
import type {
  AnnouncementType,
  AnnouncementAutoEvent,
} from '../../../shared/contracts/announcement.contract.js';

type PgTransaction = Transaction<Database>;

// Matches announcementContract.announcementRow (timestamps are Date server-side).
type AnnouncementListRow = {
  announcement_id: number;
  title: string;
  message: string;
  announcement_type: AnnouncementType;
  target_doctor_id: number | null;
  is_dismissible: boolean;
  link_url: string | null;
  link_text: string | null;
  expires_at: Date | null;
  auto_event: AnnouncementAutoEvent | null;
  related_batch_id: number | null;
  created_by: string | null;
  created_at: Date;
  target_doctor_name: string | null;
  read_count: number;
};

type AnnouncementReceiptRow = {
  read_id: number;
  dr_id: number;
  doctor_name: string | null;
  read_at: Date;
};

/** Normalized create/update payload (route maps the contract body onto this). */
export type AnnouncementInput = {
  title: string;
  message: string;
  announcementType: AnnouncementType;
  targetDoctorId: number | null;
  isDismissible: boolean;
  linkUrl: string | null;
  linkText: string | null;
  /** 'YYYY-MM-DD' (stored as local midnight) or null = never expires. */
  expiresAt: string | null;
};

// The shared list/detail projection: row + target doctor name + receipt count.
function baseSelect() {
  return getKysely()
    .selectFrom('doctor_announcements as a')
    .leftJoin('aligner_doctors as ad', 'ad.dr_id', 'a.target_doctor_id')
    .select((eb) => [
      'a.announcement_id',
      'a.title',
      'a.message',
      'a.announcement_type',
      'a.target_doctor_id',
      'a.is_dismissible',
      'a.link_url',
      'a.link_text',
      'a.expires_at',
      'a.auto_event',
      'a.related_batch_id',
      'a.created_by',
      'a.created_at',
      'ad.doctor_name as target_doctor_name',
      eb
        .selectFrom('doctor_announcement_reads as r')
        .whereRef('r.announcement_id', '=', 'a.announcement_id')
        .select((e) => e.fn.countAll().as('cnt'))
        .as('read_count'),
    ]);
}

type BaseSelectRow = Awaited<ReturnType<ReturnType<typeof baseSelect>['execute']>>[number];

function toListRow(r: BaseSelectRow): AnnouncementListRow {
  return {
    announcement_id: r.announcement_id,
    title: r.title,
    message: r.message,
    announcement_type: r.announcement_type as AnnouncementType,
    target_doctor_id: r.target_doctor_id,
    is_dismissible: r.is_dismissible,
    link_url: r.link_url,
    link_text: r.link_text,
    expires_at: r.expires_at,
    auto_event: r.auto_event as AnnouncementAutoEvent | null,
    related_batch_id: r.related_batch_id,
    created_by: r.created_by,
    created_at: r.created_at,
    target_doctor_name: r.target_doctor_name,
    read_count: Number(r.read_count) || 0,
  };
}

/**
 * Management list, newest first. Default hides expired rows; the management
 * screen opts back in with includeExpired (rendered greyed there).
 */
export async function listAnnouncements(includeExpired: boolean): Promise<AnnouncementListRow[]> {
  try {
    const rows = await baseSelect()
      .$if(!includeExpired, (qb) =>
        qb.where((eb) =>
          eb.or([eb('a.expires_at', 'is', null), eb('a.expires_at', '>', sql<Date>`LOCALTIMESTAMP`)])
        )
      )
      .orderBy('a.created_at', 'desc')
      .execute();
    return rows.map(toListRow);
  } catch (err) {
    log.error('Failed to list announcements', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export async function getAnnouncementById(
  announcementId: number
): Promise<AnnouncementListRow | undefined> {
  const row = await baseSelect().where('a.announcement_id', '=', announcementId).executeTakeFirst();
  return row ? toListRow(row) : undefined;
}

// 'YYYY-MM-DD' → a PG-side `::timestamp` cast (local midnight). Never `new
// Date('YYYY-MM-DD')` — JS parses that as UTC midnight and shifts the wall day.
function expiryTimestamp(expiresAt: string | null) {
  return expiresAt === null ? null : sql<Date>`${expiresAt}::timestamp`;
}

/** Compose a manual announcement (auto_event stays NULL). */
export async function createAnnouncement(
  input: AnnouncementInput,
  createdBy: string
): Promise<AnnouncementListRow> {
  const inserted = await getKysely()
    .insertInto('doctor_announcements')
    .values({
      title: input.title,
      message: input.message,
      announcement_type: input.announcementType,
      target_doctor_id: input.targetDoctorId,
      is_dismissible: input.isDismissible,
      link_url: input.linkUrl,
      link_text: input.linkText,
      expires_at: expiryTimestamp(input.expiresAt),
      created_by: createdBy,
    })
    .returning('announcement_id')
    .executeTakeFirstOrThrow();
  return (await getAnnouncementById(inserted.announcement_id))!;
}

/** Full-replace edit (PUT semantics). Returns undefined when the id is gone. */
export async function updateAnnouncement(
  announcementId: number,
  input: AnnouncementInput
): Promise<AnnouncementListRow | undefined> {
  const updated = await getKysely()
    .updateTable('doctor_announcements')
    .set({
      title: input.title,
      message: input.message,
      announcement_type: input.announcementType,
      target_doctor_id: input.targetDoctorId,
      is_dismissible: input.isDismissible,
      link_url: input.linkUrl,
      link_text: input.linkText,
      expires_at: expiryTimestamp(input.expiresAt),
    })
    .where('announcement_id', '=', announcementId)
    .returning('announcement_id')
    .executeTakeFirst();
  if (!updated) return undefined;
  return getAnnouncementById(announcementId);
}

/** Hard delete; local FK CASCADE removes receipts. False when the id is gone. */
export async function deleteAnnouncement(announcementId: number): Promise<boolean> {
  const deleted = await getKysely()
    .deleteFrom('doctor_announcements')
    .where('announcement_id', '=', announcementId)
    .returning('announcement_id')
    .executeTakeFirst();
  return !!deleted;
}

/** Who has read/dismissed it (reverse-synced receipts), newest first. */
export async function getAnnouncementReceipts(
  announcementId: number
): Promise<AnnouncementReceiptRow[]> {
  return getKysely()
    .selectFrom('doctor_announcement_reads as r')
    .leftJoin('aligner_doctors as ad', 'ad.dr_id', 'r.dr_id')
    .select(['r.read_id', 'r.dr_id', 'ad.doctor_name', 'r.read_at'])
    .where('r.announcement_id', '=', announcementId)
    .orderBy('r.read_at', 'desc')
    .execute();
}

// ── Auto events (called inside updateBatchStatus's transaction) ───────────────

/**
 * System announcement for a first-time MANUFACTURE / DELIVER. No-op when the
 * set's doctor has no portal access: `aligner_sets.aligner_dr_id` is NOT NULL
 * (every set has a doctor row), so "in-house set" here means the doctor has no
 * `doctor_email` — portal access is Cloudflare-Access-gated by that email, so an
 * email-less doctor can never see the banner and the row would be pure noise.
 */
export async function insertBatchAutoAnnouncement(
  trx: PgTransaction,
  opts: { batchId: number; setId: number; batchSequence: number; event: AnnouncementAutoEvent }
): Promise<void> {
  const ctx = await trx
    .selectFrom('aligner_sets as s')
    .innerJoin('works as w', 'w.work_id', 's.work_id')
    .innerJoin('patients as p', 'p.person_id', 'w.person_id')
    .innerJoin('aligner_doctors as ad', 'ad.dr_id', 's.aligner_dr_id')
    .select(['s.set_sequence', 's.work_id', 'p.patient_name', 'ad.dr_id', 'ad.doctor_email'])
    .where('s.aligner_set_id', '=', opts.setId)
    .executeTakeFirst();
  if (!ctx || !ctx.doctor_email) return;

  const patient = ctx.patient_name ?? 'your patient';
  const setLabel = ctx.set_sequence != null ? `set ${ctx.set_sequence}` : 'their aligner set';
  const manufactured = opts.event === 'batch_manufactured';
  const expires = new Date();
  expires.setDate(expires.getDate() + 30);

  await trx
    .insertInto('doctor_announcements')
    .values({
      title: manufactured ? `Batch ready — ${patient}` : `Batch delivered — ${patient}`,
      message: manufactured
        ? `Batch #${opts.batchSequence} of ${setLabel} for ${patient} has been manufactured and is ready.`
        : `Batch #${opts.batchSequence} of ${setLabel} for ${patient} has been delivered to the patient.`,
      announcement_type: manufactured ? 'info' : 'success',
      target_doctor_id: ctx.dr_id,
      is_dismissible: true,
      link_url: `/case/${ctx.work_id}`,
      link_text: 'View case',
      expires_at: expires,
      auto_event: opts.event,
      related_batch_id: opts.batchId,
      created_by: 'system',
    })
    .execute();
}

/**
 * UNDO_MANUFACTURE / UNDO_DELIVERY: retract the matching auto announcement.
 * Keyed by (auto_event, related_batch_id) so a re-do announces fresh.
 */
export async function deleteBatchAutoAnnouncement(
  trx: PgTransaction,
  batchId: number,
  event: AnnouncementAutoEvent
): Promise<void> {
  await trx
    .deleteFrom('doctor_announcements')
    .where('related_batch_id', '=', batchId)
    .where('auto_event', '=', event)
    .execute();
}
