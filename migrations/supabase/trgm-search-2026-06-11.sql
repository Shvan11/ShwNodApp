-- SUPABASE MIRROR half of migrations/pg/1781125376635_trgm-patient-search-indexes.sql
-- (DDL parity — CDC replicates row data only, so extension + index DDL must exist on both sides).
-- Keep in lockstep with the local migration's Up section.
--
-- Apply (user-run):  ./scripts/psql.sh supa -1 -f migrations/supabase/trgm-search-2026-06-11.sql
--
-- pg_trgm: NOT installed on the mirror as of 2026-06-11 (verified via pg_extension); installed
-- SCHEMA public to match local, so gin_trgm_ops resolves identically on both sides.

CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public;

CREATE INDEX ix_patients_patient_name_trgm ON patients USING gin ((patient_name::text) gin_trgm_ops);
CREATE INDEX ix_patients_first_name_trgm   ON patients USING gin ((first_name::text)   gin_trgm_ops);
CREATE INDEX ix_patients_last_name_trgm    ON patients USING gin ((last_name::text)    gin_trgm_ops);
CREATE INDEX ix_patients_phone_trgm        ON patients USING gin ((phone::text)        gin_trgm_ops);
CREATE INDEX ix_patients_phone2_trgm       ON patients USING gin ((phone2::text)       gin_trgm_ops);

CREATE INDEX ix_patients_fullname_trgm ON patients
  USING gin ((first_name::text || ' ' || last_name::text) gin_trgm_ops);
