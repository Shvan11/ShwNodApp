-- Supabase mirror of migrations/pg/1788812700000_expenses-created-at.sql — applied via
-- SUPABASE_FAILOVER_DB_URL, BEFORE the local migration. Additive DDL goes on the mirror first
-- (docs/db-migrations.md): the failover sink builds its column list from the LOCAL row, so the
-- first expense written after the local migration would upsert a `created_at` the mirror did not
-- have yet.
--
-- Mirror parity rules (docs/sync-cdc.md): identical type, default and nullability to local. The
-- `LOCALTIMESTAMP` default evaluates in each server's own TimeZone (Asia/Baghdad locally, UTC
-- here) — the same asymmetry every other LOCALTIMESTAMP default in the schema already carries.
-- It is only ever reached by a row INSERTed directly on the mirror; a replicated row brings the
-- local value with it.
--
-- The backfill is the identical `expense_date::timestamp` expression the local half uses, so
-- both sides land on the same value for all 4,290 pre-existing rows without a single row of
-- replication traffic. `app.cdc_origin = 'failover'` makes cdc_capture_remote and
-- set_updated_at_remote no-ops for it, so the backfill neither echoes back through reverse sync
-- nor stamps `updated_at = now()` on every expense.

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS created_at timestamp without time zone;

SET app.cdc_origin = 'failover';
UPDATE public.expenses SET created_at = expense_date::timestamp WHERE created_at IS NULL;
RESET app.cdc_origin;

ALTER TABLE public.expenses
  ALTER COLUMN created_at SET DEFAULT LOCALTIMESTAMP,
  ALTER COLUMN created_at SET NOT NULL;

COMMENT ON COLUMN public.expenses.created_at IS
  'Row insert time (wall clock). The record-age authorization guard reads THIS, never the '
  'user-entered expense_date. Backfilled to expense_date::timestamp for rows predating it.';
