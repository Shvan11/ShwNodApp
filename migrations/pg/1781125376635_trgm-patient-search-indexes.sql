-- Up Migration
--
-- Trigram (pg_trgm) indexes for patient search — 2026-06-11.
--
-- The patient-search predicates (staff search in routes/api/patient.routes.ts; aligner search in
-- services/database/queries/aligner-queries.ts#searchAlignerPatients) were `citext LIKE '%term%'`,
-- which NO index can serve (citext has no pattern-ops btree support, and citext's own LIKE operator
-- doesn't match a text trgm opclass) → every keystroke seq-scanned the patients table.
--
-- Fix ships in two coupled halves — DO NOT separate them:
--   1. these GIN gin_trgm_ops expression indexes on (col::text);
--   2. the query rewrite from `LIKE` to `col::text ILIKE` in the two files above (same change set).
-- Either half alone is inert: the old citext-LIKE queries ignore these indexes, and the rewritten
-- queries without the indexes just seq-scan via a different operator. Semantics are preserved:
-- citext LIKE was case-insensitive; ::text ILIKE is case-insensitive (accent-sensitive, as before).
--
-- pg_trgm is a TRUSTED extension (PG 13+), so shwan_app's CREATE on the database suffices — no
-- superuser needed; safe inside node-pg-migrate. Installed SCHEMA public to match citext.
--
-- ⚠️ DDL parity: apply the same DDL to the Supabase mirror
-- (migrations/supabase/trgm-search-2026-06-11.sql) — CDC replicates row data only.
-- No column/type change → `npm run db:codegen` output is unchanged.

CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public;

-- One index per searched column. The expression MUST stay `(column::text)` — the rewritten queries
-- compare `col::text ILIKE $1`, and expression indexes only match the exact expression.
CREATE INDEX ix_patients_patient_name_trgm ON patients USING gin ((patient_name::text) gin_trgm_ops);
CREATE INDEX ix_patients_first_name_trgm   ON patients USING gin ((first_name::text)   gin_trgm_ops);
CREATE INDEX ix_patients_last_name_trgm    ON patients USING gin ((last_name::text)    gin_trgm_ops);
CREATE INDEX ix_patients_phone_trgm        ON patients USING gin ((phone::text)        gin_trgm_ops);
CREATE INDEX ix_patients_phone2_trgm       ON patients USING gin ((phone2::text)       gin_trgm_ops);

-- The aligner search also matches against "first last" as one string; an OR is only fully
-- indexable (BitmapOr) if EVERY branch has an index, so the concat expression needs its own.
CREATE INDEX ix_patients_fullname_trgm ON patients
  USING gin ((first_name::text || ' ' || last_name::text) gin_trgm_ops);

-- Down Migration

DROP INDEX ix_patients_patient_name_trgm;
DROP INDEX ix_patients_first_name_trgm;
DROP INDEX ix_patients_last_name_trgm;
DROP INDEX ix_patients_phone_trgm;
DROP INDEX ix_patients_phone2_trgm;
DROP INDEX ix_patients_fullname_trgm;

DROP EXTENSION IF EXISTS pg_trgm;
