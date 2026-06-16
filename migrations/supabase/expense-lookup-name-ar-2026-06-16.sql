-- SUPABASE MIRROR half of migrations/pg/1781800300000_expense-lookup-name-ar.sql
-- (DDL parity — CDC replicates row DATA only, so column DDL must exist on both sides
-- or the failover upsert silently drops the new field). Both expense lookup tables
-- are forward-only failover-captured (no updated_at → not reverse-synced), so this
-- side only needs the columns to exist for the inbound upsert.
--
-- Apply (user-run):
--   ./scripts/psql.sh supa -f migrations/supabase/expense-lookup-name-ar-2026-06-16.sql
--
-- Nullable Arabic-name columns for bilingual lookup display; client-side fallback to
-- the base name. citext to match the base columns. Metadata-only ADD COLUMN.

ALTER TABLE public.expense_categories ADD COLUMN IF NOT EXISTS category_name_ar citext;
ALTER TABLE public.expense_subcategories ADD COLUMN IF NOT EXISTS subcategory_name_ar citext;
