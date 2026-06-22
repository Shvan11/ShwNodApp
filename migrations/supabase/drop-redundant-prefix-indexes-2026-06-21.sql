-- SUPABASE MIRROR half of migrations/pg/1781900100000_drop-redundant-prefix-indexes.sql
-- (DDL parity — CDC replicates row data only, so index DDL must be applied on both sides).
--
-- Drops the four structurally redundant non-unique indexes whose key columns are an exact
-- leading prefix of an existing UNIQUE index. Verified 2026-06-21 that both the four
-- redundant indexes AND their four covering unique indexes exist on the mirror, so the same
-- subsumption holds here and the aligner-portal read paths keep an equivalent index.
--
-- Apply (NO -1 — CONCURRENTLY cannot run inside a transaction):
--   ./scripts/psql.sh supa -f migrations/supabase/drop-redundant-prefix-indexes-2026-06-21.sql

DROP INDEX CONCURRENTLY IF EXISTS ix_tbltpimages_tp;
DROP INDEX CONCURRENTLY IF EXISTS ix_tbltimepoints_person;
DROP INDEX CONCURRENTLY IF EXISTS ix_workitemteeth_workitemid;
DROP INDEX CONCURRENTLY IF EXISTS ix_privatephotos_patient_tp;
