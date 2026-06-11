-- SUPABASE MIRROR half of migrations/pg/1781183972151_add-employee-active-status.sql
-- (DDL parity — CDC replicates row DATA only, so column DDL must exist on both
-- sides). Keep in lockstep with the local migration's Up section.
--
-- Apply (user-run, single txn):
--   ./scripts/psql.sh supa -1 -f migrations/supabase/employees-active-status-2026-06-11.sql
--
-- Run this back-to-back with the local migration during a maintenance window with
-- BOTH sinks kill-switched off (failover on local, reverse on Supabase). The
-- `SET LOCAL app.cdc_origin='failover'` makes the mirror's reverse-capture trigger
-- (cdc_capture_remote) skip any DML; this migration is pure additive DDL so there
-- is no DML, but the guard is kept for symmetry/safety. `-1` wraps everything in
-- one transaction, so SET LOCAL stays scoped to it. The DEFAULT backfills existing
-- mirror rows to `true` — the same value the local side backfills — so the two
-- copies stay consistent.

SET LOCAL app.cdc_origin = 'failover';

ALTER TABLE employees
  ADD COLUMN is_active boolean NOT NULL DEFAULT true;
