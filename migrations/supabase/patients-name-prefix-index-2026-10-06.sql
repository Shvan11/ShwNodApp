-- SUPABASE MIRROR half of migrations/pg/1791307000000_patients-name-prefix-index.sql
-- (DDL parity — CDC replicates row data only, so index DDL must exist on both sides).
-- Keep in lockstep with the local migration's Up section.
--
-- Apply (user-run):  ./scripts/psql.sh supa -1 -f migrations/supabase/patients-name-prefix-index-2026-10-06.sql
--
-- The index serves the staff app's patient typeahead, which reads the LOCAL database; nothing on
-- the mirror queries by it today. It is here so the two schemas stay identical, and it costs one
-- small btree. Order does not matter: apply before or after the local migration.

CREATE INDEX IF NOT EXISTS ix_patients_name_prefix
  ON public.patients USING btree (lower((patient_name)::text) text_pattern_ops);
