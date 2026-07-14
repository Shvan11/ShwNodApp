/**
 * API contract — the staff "Portal activity" header bell (the read side of
 * `aligner_activity_flags`, filtered to `source='portal'`).
 *
 * Portal-originated rows are INSERTed on the Supabase mirror by the doctor
 * portal (RLS pins source='portal' + own set — see
 * aligner-portal-external/sql/phase3-announcements.sql) and reverse-synced
 * home; the staff app only ever READS them and flips `is_read`. Staff-side
 * flag writes (`source='staff'`, the legacy in-page badges) never surface here.
 *
 * Imported by BOTH the Express routes (relative `.js`) and the React app
 * (`@shared` alias). One `export const <action> = { … } as const` per endpoint;
 * types via `z.infer`.
 */
import { z } from 'zod';
import { intId, timestampString, optionalPositiveIntQuery } from '../validation.js';

// The widened ck_activitytype set (migrations/pg/1782800000000_… + the
// portal-case-submissions migration that adds 'CaseSubmitted'). 'CaseSubmitted'
// is written ONLY by the service-role cases function (the portal's authenticated
// INSERT policy deliberately still caps at the first four — a browser client
// cannot forge a case submission); the staff bell only ever reads these rows.
export const PORTAL_ACTIVITY_TYPES = ['DaysChanged', 'DoctorNote', 'PhotoUploaded', 'FileUploaded', 'CaseSubmitted'] as const;
export type PortalActivityType = (typeof PORTAL_ACTIVITY_TYPES)[number];

// A feed row: the flag + server-joined context (set → work → patient, doctor).
// Left joins, so every joined field is nullable; a fully modeled join → closed
// z.object. The headline the bell shows is composed CLIENT-side from these
// joined names — the portal-authored activity_description is secondary text
// (a doctor could write anything there).
export const portalActivityRow = z.object({
  activity_id: z.number(),
  aligner_set_id: z.number(),
  activity_type: z.enum(PORTAL_ACTIVITY_TYPES),
  activity_description: z.string(),
  created_at: timestampString.nullable(),
  is_read: z.boolean().nullable(),
  read_at: timestampString.nullable(),
  related_record_id: z.number().nullable(),
  work_id: z.number().nullable(),
  set_sequence: z.number().nullable(),
  person_id: z.number().nullable(),
  patient_name: z.string().nullable(),
  dr_id: z.number().nullable(),
  doctor_name: z.string().nullable(),
});
export type PortalActivityRow = z.infer<typeof portalActivityRow>;

// GET /api/portal-activity — newest first; ?unreadOnly=true for the badge list,
// ?limit caps the page (server defaults it).
export const portalActivityFeed = {
  query: z.object({
    unreadOnly: z.enum(['true', 'false']).optional(),
    limit: optionalPositiveIntQuery,
  }),
  response: z.array(portalActivityRow),
} as const;
export type PortalActivityFeedQuery = z.infer<typeof portalActivityFeed.query>;
export type PortalActivityFeedResponse = z.infer<typeof portalActivityFeed.response>;

// PATCH /api/portal-activity/read — mark a batch of rows read (the bell groups
// uploads by set/type/day, so one click sends the whole group's ids). Only
// unread source='portal' rows are touched; `updated` = rows actually flipped.
export const markActivityRead = {
  body: z.object({ activityIds: z.array(intId).min(1) }),
  response: z.object({ updated: z.number() }),
} as const;
export type MarkActivityReadBody = z.infer<typeof markActivityRead.body>;

// PATCH /api/portal-activity/read-all — flip every unread portal row.
export const markAllActivityRead = {
  response: z.object({ updated: z.number() }),
} as const;
