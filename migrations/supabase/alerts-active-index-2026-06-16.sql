-- SUPABASE MIRROR half of migrations/pg/1781800000000_alerts-active-partial-index.sql
-- (DDL parity — CDC replicates row data only, so index DDL must be applied on both sides).
-- This is the local migration's Up section verbatim below; keep the two files in lockstep.
--
-- Apply (user-run):  ./scripts/psql.sh supa -1 -f migrations/supabase/alerts-active-index-2026-06-16.sql
--
-- Partial index on the active working set of alerts/tasks. Serves the
-- getDailyAppointments hasActiveAlert lookup (WHERE person_id = ? AND status =
-- 'active' …) and the app-wide header Tasks feed (WHERE status = 'active' …).
-- Partial-on-active keeps it tiny as done/dismissed history accumulates. Forward-
-- looking: the table is small today so the planner won't use it yet — this is
-- correct-access-path insurance for growth, with negligible write cost.

CREATE INDEX IF NOT EXISTS ix_alerts_active_person
  ON alerts USING btree (person_id)
  WHERE status = 'active';
