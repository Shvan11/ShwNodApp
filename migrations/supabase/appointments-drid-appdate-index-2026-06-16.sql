-- SUPABASE MIRROR half of migrations/pg/1781800100000_appointments-drid-appdate-index.sql
-- (DDL parity — CDC replicates row data only, so index DDL must be applied on both sides).
--
-- Apply (user-run, NO -1 — CONCURRENTLY cannot run inside a transaction):
--   ./scripts/psql.sh supa -f migrations/supabase/appointments-drid-appdate-index-2026-06-16.sql
--
-- Partial composite index for per-doctor calendar views (date range × one doctor).
-- Self-sizing via WHERE dr_id IS NOT NULL: tiny where doctors are rarely assigned,
-- full at doctor-heavy centers (the ~2M-appointment ceiling) where it matters.

CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_appointments_drid_appdate
  ON appointments USING btree (dr_id, app_date)
  WHERE dr_id IS NOT NULL;
