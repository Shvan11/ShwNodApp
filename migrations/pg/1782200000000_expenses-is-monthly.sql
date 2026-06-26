-- Add is_monthly flag to expenses table.
-- Monthly expenses appear in all expense totals and net-profit calculations but are
-- excluded from the per-day Expected Cash formula so they don't distort the
-- cash-drawer reconciliation with charges that were not paid out on any specific day
-- (e.g. rent, subscriptions, utilities logged once a month).
--
-- Apply LOCAL:
--   scripts/psql.sh local -f migrations/pg/1782200000000_expenses-is-monthly.sql
-- Apply SUPABASE (same DDL):
--   psql $SUPABASE_FAILOVER_DB_URL -f migrations/supabase/expenses-is-monthly-2026-06-26.sql
-- Then regenerate types: npm run db:codegen

-- Up Migration
ALTER TABLE public.expenses
  ADD COLUMN is_monthly boolean NOT NULL DEFAULT false;

-- Down Migration
-- ALTER TABLE public.expenses DROP COLUMN is_monthly;
