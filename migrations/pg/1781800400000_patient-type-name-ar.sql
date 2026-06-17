-- Bilingual lookup display: nullable Arabic-name column on the patient_types lookup.
--
-- Applied directly via psql on 2026-06-17 (LOCAL + Supabase mirror), NOT via
-- `node-pg-migrate up` (squashed-baseline state — see the expense-lookup-name-ar
-- migration). Plain `ADD COLUMN ... NULL` is metadata-only (instant, no table
-- rewrite), so no lock/rewrite concern.
--
-- Why (COMMERCIAL multi-center product — see CLAUDE.md "Product direction" + the
-- i18n / RTL section): lookup VALUES (patient-type names like New / Consult) are
-- clinic-owned data edited per-deployment via the generic Lookups admin, so they
-- can't live in build-time i18n catalogs. Additive, fallback-friendly: a nullable
-- `patient_type_name_ar` beside the base `patient_type`; the read layer returns BOTH
-- columns and the client picks `name_ar` when the UI language is Arabic, else falls
-- back to the base name (resolved client-side via useLocalizedName — server stays
-- language-agnostic, zero extra queries, no per-language cache split). citext to
-- match the base column. NULL by default → untranslated rows (e.g. the OPG acronym)
-- fall back cleanly. Second instance of the lookup-by-lookup pattern after the
-- expense lookups; see docs/i18n-translation-playbook.md "DB-stored lookup values".
--
-- CDC: patient_types carries a `cdc_capture('id', 'failover')` trigger (forward-only,
-- local→Supabase — no updated_at, so not reverse-synced). The Supabase mirror MUST
-- have the same column or the failover upsert silently drops the field — applied
-- there first (migrations/supabase/patient-type-name-ar-2026-06-17.sql). Controlled-
-- vocabulary rows seeded via migrations/supabase/seed-patient-types-ar.sql.

-- Up Migration
ALTER TABLE public.patient_types ADD COLUMN IF NOT EXISTS patient_type_name_ar citext;

-- Down Migration
ALTER TABLE public.patient_types DROP COLUMN IF EXISTS patient_type_name_ar;
