-- Supabase mirror of migrations/pg/1785700253568_notnull-timepoint-and-visit-flags.sql —
-- applied via SUPABASE_FAILOVER_DB_URL, AFTER the local migration. A NOT NULL is
-- restrictive rather than additive, so it follows the drop ordering in
-- docs/db-migrations.md: constrain the source first, the mirror second, so the mirror
-- never rejects a row the source is still permitted to produce. (Both sides held 0 NULLs
-- in all seven columns when this was written, so either order was in fact safe.)
--
-- Mirror parity rules (docs/sync-cdc.md): identical nullability + defaults to local. The
-- `DEFAULT false` on the five visits flags is RETAINED on both sides.
--
-- Both tables are reverse-captured here (trg_cdc_capture_remote), so this constraint is
-- also what makes a Supabase-side NULL fail loudly at the write instead of replicating
-- into the local DB as silent corruption. No Supabase-side code writes either table today
-- (no Edge function references them; the write grants are postgres / service_role /
-- mirror_rw, none of whose consumers touch visits or time_points) — the failover sink is
-- the only practical writer, and it copies already-constrained local rows.

ALTER TABLE public.visits
  ALTER COLUMN opg               SET NOT NULL,
  ALTER COLUMN p_photo           SET NOT NULL,
  ALTER COLUMN i_photo           SET NOT NULL,
  ALTER COLUMN f_photo           SET NOT NULL,
  ALTER COLUMN appliance_removed SET NOT NULL;

ALTER TABLE public.time_points
  ALTER COLUMN tp_date_time   SET NOT NULL,
  ALTER COLUMN tp_description SET NOT NULL;
