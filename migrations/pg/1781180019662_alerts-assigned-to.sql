-- Up Migration
--
-- Task assignment (feature #4): give a header "push" task an OWNER so it can be
-- directed at one staff member ("Dr. X: review this case") instead of sitting in a
-- shared clinic-wide pile. The column lives on `alerts` (the dual-surfaced table —
-- see …_alerts-to-tasks.sql); it is NULL for unassigned tasks and for every
-- patient-context alert (assignment is a task concept, but the column is harmless
-- on the context surface).
--
--   assigned_to  → FK to employees(id). ON DELETE SET NULL so removing a staff
--                  member UNASSIGNS their open tasks rather than blocking the
--                  delete or destroying the task. (Contrast `completed_by`, which
--                  is free `text` audit with no FK so history survives the delete.)
--
-- The FK column is indexed: the per-assignee header filter selects on it, and an
-- un-indexed FK forces a seq scan on every `employees` delete's SET NULL pass.
--
-- SYNC PARITY: the identical DDL is applied to the Supabase mirror in the same
-- maintenance window — see migrations/supabase/alerts-assigned-to-2026-06-11.sql.
-- CDC replicates row DATA only, never DDL: until the mirror has `assigned_to`, a
-- drained `alerts` upsert carrying the new column would error and wedge the
-- failover sink, so BOTH sinks (failover on local, reverse on Supabase) are
-- kill-switched off for the window and both sides are migrated directly. `employees`
-- is already a captured + fully-loaded table on the mirror, so the FK's parent rows
-- are present — the constraint is satisfiable there. `alerts` stays in the
-- reverse-sync LWW set (unchanged — `updated_at` already present).

ALTER TABLE alerts
  ADD COLUMN assigned_to integer
    CONSTRAINT fk_alerts_assigned_to REFERENCES employees(id) ON DELETE SET NULL;

CREATE INDEX idx_alerts_assigned_to ON alerts (assigned_to) WHERE assigned_to IS NOT NULL;


-- Down Migration

DROP INDEX IF EXISTS idx_alerts_assigned_to;
ALTER TABLE alerts DROP COLUMN assigned_to;
