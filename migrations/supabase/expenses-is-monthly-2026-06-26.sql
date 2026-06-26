-- Mirror of migrations/pg/1782200000000_expenses-is-monthly.sql
-- CDC replicates row data only, never DDL — this column must exist on the Supabase
-- mirror before any row with is_monthly=true is synced, or the failover upsert
-- will silently drop the field.

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS is_monthly boolean NOT NULL DEFAULT false;
