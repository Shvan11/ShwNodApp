-- Bilingual lookup display: nullable Arabic-name columns on the expense lookup tables.
--
-- Applied directly via psql on 2026-06-16 (LOCAL + Supabase mirror), NOT via
-- `node-pg-migrate up` (squashed-baseline state — see the alerts-active-index
-- migration). Plain `ADD COLUMN ... NULL` is metadata-only (instant, no table
-- rewrite), so no lock/rewrite concern on the hot path.
--
-- Why (COMMERCIAL multi-center product — see CLAUDE.md "Product direction" + the
-- i18n / RTL section): lookup VALUES (category names) are clinic-owned data edited
-- per-deployment via the generic Lookups admin, so they can't live in build-time
-- i18n catalogs. This is the additive, fallback-friendly path: a nullable
-- `*_name_ar` beside the base `*_name`; the read layer returns BOTH columns and the
-- client picks `name_ar` when the UI language is Arabic, else falls back to the base
-- name (COALESCE-style, but resolved client-side so the server stays language-
-- agnostic — zero extra queries, no per-language cache split). citext to match the
-- base name columns (case-insensitive, accent-sensitive). NULL by default →
-- untranslated rows (incl. the auto-synced employee subcategories under category 5,
-- whose value is a proper-noun name and should NOT be translated) fall back cleanly.
--
-- First instance of a pattern intended to roll out lookup-by-lookup; see
-- docs/i18n-translation-playbook.md "DB-stored lookup values".
--
-- CDC: both tables carry a `cdc_capture(..., 'failover')` trigger (forward-only,
-- local→Supabase — neither has updated_at, so neither is reverse-synced). The
-- Supabase mirror MUST have the same columns or the failover upsert silently drops
-- the field — applied there first (migrations/supabase/expense-lookup-name-ar-2026-06-16.sql).

-- Up Migration
ALTER TABLE public.expense_categories ADD COLUMN IF NOT EXISTS category_name_ar citext;
ALTER TABLE public.expense_subcategories ADD COLUMN IF NOT EXISTS subcategory_name_ar citext;

-- Down Migration
ALTER TABLE public.expense_subcategories DROP COLUMN IF EXISTS subcategory_name_ar;
ALTER TABLE public.expense_categories DROP COLUMN IF EXISTS category_name_ar;
