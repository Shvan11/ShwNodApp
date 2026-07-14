-- Supabase mirror half of migrations/pg/1782900000000_portal-case-submissions.sql —
-- applied via scripts/psql.sh supa (small additive DDL), BEFORE the local migration,
-- so a portal-submitted 'CaseSubmitted' flag has a widened check constraint to land in
-- when it reverse-syncs home (and so the mirror itself accepts the service-role insert).
--
-- Doctor-portal "New Case" submission (Part B of the welcome-hero + new-case feature):
-- a doctor submits patient name/age/sex/note + photos/scans; a service-role Pages/Edge
-- function auto-creates patients → works → aligner_sets (+ optional note) on the mirror
-- and drops ONE aligner_activity_flags row of the NEW type 'CaseSubmitted' (source='portal')
-- that reverse-syncs to the staff "Portal activity" header bell.
--
-- This migration widens ck_activitytype ONLY — no new tables, no new grants, no RLS change:
--   * patients / works / aligner_sets / aligner_notes / aligner_activity_flags are all
--     already reverse-sync-capable (updated_at + single-col PK + remote triggers). The
--     case rows ride the existing reverse path home; no schema change is needed for them.
--   * 'CaseSubmitted' is written ONLY by the service-role cases function. The portal's
--     authenticated INSERT policy (aligner-portal-external/sql/phase3-announcements.sql)
--     deliberately stays capped at the first four types — a browser client cannot forge a
--     case submission. So this touches the table-level CHECK, not the RLS WITH CHECK.
--
-- Apply order: THIS FILE → migrations/pg/1782900000000_portal-case-submissions.sql.
-- Then regenerate types: npm run db:codegen. Safe to re-run.

BEGIN;

-- Widen ck_activitytype: + 'CaseSubmitted' (the four prior types are unchanged).
ALTER TABLE public.aligner_activity_flags
  DROP CONSTRAINT IF EXISTS ck_activitytype;
ALTER TABLE public.aligner_activity_flags
  ADD CONSTRAINT ck_activitytype CHECK (activity_type IN
    ('DaysChanged', 'DoctorNote', 'PhotoUploaded', 'FileUploaded', 'CaseSubmitted'));

COMMIT;

-- Down:
-- ALTER TABLE public.aligner_activity_flags DROP CONSTRAINT IF EXISTS ck_activitytype;
-- ALTER TABLE public.aligner_activity_flags ADD CONSTRAINT ck_activitytype CHECK (activity_type IN
--   ('DaysChanged', 'DoctorNote', 'PhotoUploaded', 'FileUploaded'));
