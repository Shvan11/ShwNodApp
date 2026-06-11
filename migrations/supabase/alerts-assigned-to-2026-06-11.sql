-- SUPABASE MIRROR half of migrations/pg/1781180019662_alerts-assigned-to.sql
-- (DDL parity — CDC replicates row DATA only, so column/constraint/index DDL must
-- exist on both sides). Keep in lockstep with the local migration's Up section.
--
-- Apply (user-run, single txn):
--   ./scripts/psql.sh supa -1 -f migrations/supabase/alerts-assigned-to-2026-06-11.sql
--
-- Run this back-to-back with the local migration during a maintenance window with
-- BOTH sinks kill-switched off (failover on local, reverse on Supabase). The
-- `SET LOCAL app.cdc_origin='failover'` makes the mirror's reverse-capture trigger
-- (cdc_capture_remote) skip any DML; this migration is pure additive DDL so there
-- is no DML, but the guard is kept for symmetry/safety. `-1` wraps everything in
-- one transaction, so SET LOCAL stays scoped to it.
--
-- `employees` is already mirrored (captured + fully loaded), so the FK's parent
-- rows exist here and the constraint is satisfiable.

SET LOCAL app.cdc_origin = 'failover';

ALTER TABLE alerts
  ADD COLUMN assigned_to integer
    CONSTRAINT fk_alerts_assigned_to REFERENCES employees(id) ON DELETE SET NULL;

CREATE INDEX idx_alerts_assigned_to ON alerts (assigned_to) WHERE assigned_to IS NOT NULL;
