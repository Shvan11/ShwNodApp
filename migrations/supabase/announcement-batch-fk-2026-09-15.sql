-- Supabase MIRROR half of migrations/pg/1789460000000_announcement-batch-fk.sql (2026-09-15).
-- Apply with: scripts/psql.sh supa -f migrations/supabase/announcement-batch-fk-2026-09-15.sql
-- DDL is never replicated by CDC, so the mirror must be brought to parity by hand.
--
-- Give `doctor_announcements.related_batch_id` a real foreign key (audit finding F4).
--
-- WHY. The column has always pointed at `aligner_batches.aligner_batch_id` and has never been
-- constrained to it. Deleting a batch (or a whole set, whose batches go by CASCADE) therefore left
-- its auto-generated doctor-portal announcements behind: the portal kept showing
-- "Batch #N ready / delivered — <patient>" with a working "View case" link for a batch that no
-- longer exists, until `expires_at` 30 days later. Five such rows were live when this was found
-- (announcement_ids 9, 16, 52, 53, 67 → batches 691, 737, 747, all deleted).
--
-- WHY A CONSTRAINT AND NOT A CALL. `deleteBatchAutoAnnouncement()` already existed; it was simply
-- called from the two UNDO paths and not from either delete path. Adding a third call site fixes
-- today's bug and leaves the next writer free to reintroduce it. The FK cannot be forgotten, is
-- atomic with the delete, and covers paths that bypass the service layer entirely (a script, a
-- manual repair, the set-level cascade). ON DELETE CASCADE, not SET NULL: every one of these rows
-- is an auto announcement ABOUT a specific batch (115 of 115 live rows carry `auto_event`), so a
-- batch-less copy would be a message about nothing.
--
-- CDC: the cascade is a real per-row DELETE on `doctor_announcements`, so its own AFTER DELETE
-- trigger (`trg_cdc_capture`) fires and the deletion replicates to the mirror like any other.
-- The matching Supabase half is migrations/supabase/announcement-batch-fk-2026-09-15.sql — DDL is
-- NEVER replicated, so the mirror needs it applied by hand (CLAUDE.md §Sync).

-- Clear the existing orphans first: the constraint cannot be added while they exist, and each one
-- is by definition an announcement about a batch that is gone.
DELETE FROM public.doctor_announcements d
 WHERE d.related_batch_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.aligner_batches b WHERE b.aligner_batch_id = d.related_batch_id
   );

ALTER TABLE public.doctor_announcements
  ADD CONSTRAINT doctor_announcements_related_batch_id_fkey
  FOREIGN KEY (related_batch_id)
  REFERENCES public.aligner_batches (aligner_batch_id)
  ON DELETE CASCADE;

