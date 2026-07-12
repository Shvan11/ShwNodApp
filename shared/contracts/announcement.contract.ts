/**
 * API contract — doctor announcements (`doctor_announcements`, staff-authored,
 * forward-synced to the Supabase mirror where the aligner portal reads it under
 * RLS; `doctor_announcement_reads` receipts are portal-written on the mirror and
 * reverse-synced home — see migrations/pg/1782800000000_….sql).
 *
 * Two flavors share the table: manual staff-composed announcements
 * (`auto_event` NULL, targeted at one doctor or broadcast) and system-generated
 * batch events (`auto_event` = batch_manufactured|batch_delivered, written
 * inside updateBatchStatus and deleted again on UNDO).
 *
 * Imported by BOTH the Express routes (relative `.js`) and the React app
 * (`@shared` alias). One `export const <action> = { … } as const` per endpoint;
 * types via `z.infer`.
 */
import { z } from 'zod';
import { intId, idParams, timestampString, optionalDateString } from '../validation.js';

export const ANNOUNCEMENT_TYPES = ['success', 'info', 'warning', 'urgent'] as const;
export type AnnouncementType = (typeof ANNOUNCEMENT_TYPES)[number];

export const ANNOUNCEMENT_AUTO_EVENTS = ['batch_manufactured', 'batch_delivered'] as const;
export type AnnouncementAutoEvent = (typeof ANNOUNCEMENT_AUTO_EVENTS)[number];

// A management-list row: the table row + target_doctor_name (left-joined from
// aligner_doctors; null = broadcast) + read_count (receipts subquery). Fully
// modeled join → closed z.object.
export const announcementRow = z.object({
  announcement_id: z.number(),
  title: z.string(),
  message: z.string(),
  announcement_type: z.enum(ANNOUNCEMENT_TYPES),
  target_doctor_id: z.number().nullable(),
  is_dismissible: z.boolean(),
  link_url: z.string().nullable(),
  link_text: z.string().nullable(),
  expires_at: timestampString.nullable(),
  auto_event: z.enum(ANNOUNCEMENT_AUTO_EVENTS).nullable(),
  related_batch_id: z.number().nullable(),
  created_by: z.string().nullable(),
  created_at: timestampString,
  target_doctor_name: z.string().nullable(),
  read_count: z.number(),
});
export type AnnouncementRow = z.infer<typeof announcementRow>;

// GET /api/announcements — newest first. Default hides expired rows; the
// management screen opts back in with ?includeExpired=true (greyed there).
export const listAnnouncements = {
  query: z.object({ includeExpired: z.enum(['true', 'false']).optional() }),
  response: z.array(announcementRow),
} as const;
export type ListAnnouncementsQuery = z.infer<typeof listAnnouncements.query>;

// Shared create/update field set. targetDoctorId '' / null / absent = broadcast.
// expiresAt is date-only ('YYYY-MM-DD', stored as local midnight — the portal
// filters `expires_at > now`, so an announcement lives THROUGH the prior day);
// '' / absent = never expires.
const announcementFields = {
  title: z.string().trim().min(1),
  message: z.string().trim().min(1),
  announcementType: z.enum(ANNOUNCEMENT_TYPES).optional(),
  targetDoctorId: z.union([z.literal(''), intId]).nullish(),
  isDismissible: z.boolean().optional(),
  linkUrl: z.string().optional(),
  linkText: z.string().optional(),
  expiresAt: optionalDateString,
};

// POST /api/announcements — compose (created_by = session user, server-side).
export const createAnnouncement = {
  body: z.object(announcementFields),
  response: announcementRow,
} as const;
export type CreateAnnouncementBody = z.infer<typeof createAnnouncement.body>;

// PUT /api/announcements/:id — edit a manual announcement in place.
export const updateAnnouncement = {
  params: idParams('id'),
  body: z.object(announcementFields),
  response: announcementRow,
} as const;
export type UpdateAnnouncementBody = z.infer<typeof updateAnnouncement.body>;

// DELETE /api/announcements/:id — hard delete; receipts go with it (FK CASCADE
// on both DBs; the portal treats a dismiss racing this as success).
export const deleteAnnouncement = {
  params: idParams('id'),
  response: z.object({ announcement_id: z.number() }),
} as const;

// GET /api/announcements/:id/receipts — who has read/dismissed it (reverse-synced
// receipts joined to aligner_doctors for the name).
export const announcementReceipts = {
  params: idParams('id'),
  response: z.array(
    z.object({
      read_id: z.number(),
      dr_id: z.number(),
      doctor_name: z.string().nullable(),
      read_at: timestampString,
    })
  ),
} as const;
export type AnnouncementReceiptsResponse = z.infer<typeof announcementReceipts.response>;
