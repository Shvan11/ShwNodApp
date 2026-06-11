-- Up Migration
--
-- Employee employment status: distinguish a CURRENTLY-EMPLOYED staff member from
-- one who has QUIT/left. Until now the only way to "remove" someone was to delete
-- the row, which also dropped their mirrored expense subcategory and orphaned any
-- historical references — destructive for someone who simply stopped working here.
--
--   is_active  → boolean, NOT NULL DEFAULT true. Every existing employee is
--                backfilled to active; unchecking it in Settings marks them as
--                having quit (the row, its history and its calendar colour all
--                survive). Read-only flag for now — it does NOT yet filter the
--                appointment/email-recipient queries (that is a deliberate
--                follow-up so existing reports don't silently change).
--
-- SYNC PARITY: the identical DDL is applied to the Supabase mirror in the same
-- maintenance window — see migrations/supabase/employees-active-status-2026-06-11.sql.
-- CDC replicates row DATA only, never DDL: until the mirror has `is_active`, a
-- drained `employees` upsert carrying the new column would error and wedge the
-- failover sink, so BOTH sinks (failover on local, reverse on Supabase) are
-- kill-switched off for the window and both sides are migrated directly. The
-- DEFAULT backfills existing rows to the SAME value (true) on each side
-- independently, so the mirror stays byte-consistent. `employees` keeps its
-- `updated_at` column, so it stays in the reverse-sync LWW set unchanged.

ALTER TABLE employees
  ADD COLUMN is_active boolean NOT NULL DEFAULT true;


-- Down Migration

ALTER TABLE employees DROP COLUMN is_active;
