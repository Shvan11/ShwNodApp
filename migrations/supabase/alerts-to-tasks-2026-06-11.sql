-- SUPABASE MIRROR half of migrations/pg/1781175771537_alerts-to-tasks.sql
-- (DDL parity — CDC replicates row DATA only, so column/constraint DDL must exist
-- on both sides). Keep in lockstep with the local migration's Up section.
--
-- Apply (user-run, single txn):
--   ./scripts/psql.sh supa -1 -f migrations/supabase/alerts-to-tasks-2026-06-11.sql
--
-- Run this back-to-back with the local migration during a maintenance window with
-- BOTH sinks kill-switched off (failover on local, reverse on Supabase). The
-- `SET LOCAL app.cdc_origin='failover'` makes the mirror's reverse-capture trigger
-- (cdc_capture_remote) skip the DML below, so re-enabling reverse afterward sees no
-- echo. `-1` wraps everything in one transaction, so SET LOCAL stays scoped to it.

SET LOCAL app.cdc_origin = 'failover';

ALTER TABLE alerts
  ALTER COLUMN person_id     DROP NOT NULL,
  ALTER COLUMN alert_type_id DROP NOT NULL,
  ADD COLUMN surface_mode text NOT NULL DEFAULT 'context'
    CONSTRAINT chk_alerts_surface_mode CHECK (surface_mode IN ('context', 'push')),
  ADD COLUMN status text NOT NULL DEFAULT 'active'
    CONSTRAINT chk_alerts_status CHECK (status IN ('active', 'done', 'dismissed')),
  ADD COLUMN snoozed_until date,
  ADD COLUMN expires_at    date,
  ADD COLUMN escalate_at   date,
  ADD COLUMN completed_at  timestamp,
  ADD COLUMN completed_by  text,
  ADD CONSTRAINT chk_alerts_context_has_person
    CHECK (surface_mode = 'push' OR person_id IS NOT NULL);

UPDATE alerts SET status = 'dismissed' WHERE is_active = false;
ALTER TABLE alerts DROP COLUMN is_active;
