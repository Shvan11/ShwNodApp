-- Doctor-portal "New Case" submission — widen ck_activitytype only (local half).
--
-- Pairs with migrations/supabase/portal-cases-2026-07-13.sql (the MIRROR half, applied
-- FIRST — CDC replicates row DATA, never DDL, so the mirror must accept a 'CaseSubmitted'
-- flag before the portal writes one; the local constraint must be widened before that row
-- reverse-syncs home, or the reverse sink defer-loops that ONE row on the local CHECK until
-- this lands). Same body as the mirror file.
--
-- The doctor portal's "New Case" flow (Part B) has a service-role Pages/Edge function
-- auto-create patients → works → aligner_sets (+ optional aligner_notes) on the Supabase
-- mirror and drop ONE aligner_activity_flags row of type 'CaseSubmitted' (source='portal').
-- All five tables are already reverse-sync-capable (updated_at + single-col PK + remote
-- triggers), so the new records ride the existing reverse path home to this local DB with
-- no schema change — only the flag's activity_type is new, hence this single CHECK widen.
--
-- NO RLS change: 'CaseSubmitted' is written only by the service-role cases function; the
-- portal's authenticated INSERT policy (aligner-portal-external/sql/phase3-announcements.sql)
-- deliberately stays at the first four types so a browser client cannot forge a submission.
--
-- Apply (squashed-baseline state — `node-pg-migrate up` would replay the baseline; run
-- directly instead). Mirror FIRST, then this:
--   scripts/psql.sh supa  -f migrations/supabase/portal-cases-2026-07-13.sql
--   scripts/psql.sh local -f migrations/pg/1782900000000_portal-case-submissions.sql
-- Then regenerate types: npm run db:codegen. This file is the node-pg-migrate record.

-- Up Migration

ALTER TABLE public.aligner_activity_flags
  DROP CONSTRAINT IF EXISTS ck_activitytype;
ALTER TABLE public.aligner_activity_flags
  ADD CONSTRAINT ck_activitytype CHECK (activity_type IN
    ('DaysChanged', 'DoctorNote', 'PhotoUploaded', 'FileUploaded', 'CaseSubmitted'));

-- Down Migration
-- ALTER TABLE public.aligner_activity_flags DROP CONSTRAINT IF EXISTS ck_activitytype;
-- ALTER TABLE public.aligner_activity_flags ADD CONSTRAINT ck_activitytype CHECK (activity_type IN
--   ('DaysChanged', 'DoctorNote', 'PhotoUploaded', 'FileUploaded'));
